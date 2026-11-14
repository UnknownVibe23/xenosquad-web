/*
 * scoring/scoring.js — the squad planning pipeline (pure functions only).
 *
 * WHY PURE: every function here takes its inputs (roster, settings, seats) and
 * returns plain data. No DOM, no localStorage, no globals mutated between
 * calls — the same save + same settings always produce the same squad, which
 * is the app's determinism contract and what makes the test suite meaningful.
 *
 * PIPELINE (mirrors the spec, in order):
 *   1. exclusions      — wounded soldiers (below the HP-fraction threshold)
 *                        are ineligible for any seat;
 *   2. normalization   — min-max each stat across the ELIGIBLE roster so picks
 *                        stay sensible as the team's average climbs;
 *   3. per-role score  — weighted sum of normalized stats, only for candidates
 *                        passing the role's floors, the encumbrance check and
 *                        (psi era + frontline) the BRV floor;
 *   4. assignment      — one global assignment problem over the soldier x seat
 *                        score matrix, solved by the Hungarian algorithm
 *                        (scoring/hungarian.js). Milestone 3 uses a clearly
 *                        marked provisional greedy; milestone 4 replaces it.
 *   5. tie-breakers    — higher rank first, then training fit of the seat;
 *   6. training seat   — optionally reserve one seat for the lowest-composite
 *                        healthy soldier so rookies ride along;
 *   7. encumbrance     — kit_weight must stay at/below encumbranceLimit x
 *                        capacity to avoid the TU penalty, where capacity =
 *                        strCapacityBase + strCapacityCoef x STR kg (the
 *                        game's own formula from gameconfig.xml). Roles with
 *                        strength_training invert the check against
 *                        strTrainThreshold (0.8 in the game): load past 80% of
 *                        capacity on purpose to train STR while moving.
 *
 * Tie-breakers are folded into the matrix as tiny epsilon additions
 * (rank * 1e-6, then training fit * 1e-9): normalized stat gaps are orders of
 * magnitude larger than 1e-6, so real score differences always win, and exact
 * ties resolve deterministically by rank, then training fit.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  XS.scoring = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (XS) {
  "use strict";

  const domain = () => XS.domain;

  /* Cell value for "this soldier cannot take this seat". */
  const FORBIDDEN = -1e9;
  const RANK_EPS = 1e-6; // rank tie-breaker weight
  const TRAIN_EPS = 1e-9; // training-fit tie-breaker weight

  /* ---------- 1. exclusions ---------- */

  /*
   * A soldier is ineligible for any seat when their HP fraction (current HP /
   * HP stat) is below the wounded threshold. If HP data is missing entirely
   * the check is skipped (the parser surfaces a notice instead).
   */
  function computeEligibility(soldiers, settings) {
    const threshold = settings.global ? settings.global.woundedThreshold : 0.5;
    return soldiers.map((soldier) => {
      const reasons = [];
      /*
       * Recruits (inTeam === false) never deploy, so they are never wounded —
       * skip the HP check for them entirely, even if a current-HP value was
       * mapped (the parser already nulls the float for them; this guard also
       * covers slot-based HP calibration).
       */
      if (soldier.inTeam !== false) {
        const frac = domain().hpFraction(soldier);
        if (frac != null && frac < threshold) {
          reasons.push("wounded (" + Math.round(frac * 100) + "% HP < " + Math.round(threshold * 100) + "% threshold)");
        }
      }
      return { soldier, eligible: reasons.length === 0, reasons };
    });
  }

  /* ---------- 2. normalization ---------- */

  /*
   * Min-max normalize each stat across the eligible roster.
   * Returns { mins, maxs, norm } where norm(soldier) -> { stat: 0..1 }.
   * A stat that is missing on a soldier normalizes to 0; a stat where every
   * eligible soldier is equal normalizes to 0 for all (it cannot differentiate
   * anyone, so it contributes nothing).
   */
  function normalizeRoster(eligibleSoldiers) {
    const STATS = domain().STATS;
    const mins = {};
    const maxs = {};
    for (const st of STATS) {
      let min = Infinity;
      let max = -Infinity;
      for (const s of eligibleSoldiers) {
        const v = s.stats[st];
        if (typeof v === "number") {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (min === Infinity) { min = 0; max = 0; }
      mins[st] = min;
      maxs[st] = max;
    }
    function norm(soldier) {
      const out = {};
      for (const st of STATS) {
        const v = soldier.stats[st];
        const range = maxs[st] - mins[st];
        out[st] = typeof v === "number" && range > 0 ? (v - mins[st]) / range : 0;
      }
      return out;
    }
    return { mins, maxs, norm };
  }

  /* Composite score used for the bench order and the training-seat pick. */
  function composite(normOf, soldier) {
    const n = normOf(soldier);
    let sum = 0;
    for (const st of domain().STATS) sum += n[st];
    return sum;
  }

  /* ---------- 3 + 7. role eligibility and score ---------- */

  /*
   * Can this soldier take this role at all? Checks, in order:
   *   - stat floors (raw stats, e.g. ACC >= 55);
   *   - encumbrance: role kit_weight vs the encumbrance-limit fraction of
   *     carrying capacity (STR x strCapacityFactor). strength_training
   *     inverts the check on purpose (load above the limit to train STR);
   *   - psi era + frontline role: BRV floor.
   */
  function roleEligibility(soldier, role, settings) {
    const g = settings.global || {};
    const reasons = [];
    for (const st of Object.keys(role.floors || {})) {
      const floor = role.floors[st];
      const v = soldier.stats[st];
      if (typeof v !== "number" || v < floor) {
        reasons.push(st + " " + (typeof v === "number" ? v : "?") + " < floor " + floor);
      }
    }
    const str = soldier.stats.STR;
    const kit = typeof role.kitWeight === "number" ? role.kitWeight : 0;
    if (typeof str === "number" && kit > 0) {
      // gameconfig.xml: capacity(kg) = 8 + 0.3 * STR
      const base = typeof g.strCapacityBase === "number" ? g.strCapacityBase : 8;
      const coef = typeof g.strCapacityCoef === "number" ? g.strCapacityCoef : 0.3;
      const capacity = base + coef * str;
      if (role.strengthTraining) {
        // inverted on purpose: load past the STR-training threshold (game: 80%)
        const trainAt = (typeof g.strTrainThreshold === "number" ? g.strTrainThreshold : 0.8) * capacity;
        if (!(kit > trainAt)) reasons.push("kit " + kit + " not above " + trainAt.toFixed(1) + " kg (" + Math.round((typeof g.strTrainThreshold === "number" ? g.strTrainThreshold : 0.8) * 100) + "% of capacity " + capacity.toFixed(1) + " kg); strength_training wants overload to train STR");
      } else {
        // avoid the TU penalty: load must stay at/below the limit fraction of capacity
        const limit = (typeof g.encumbranceLimit === "number" ? g.encumbranceLimit : 1.0) * capacity;
        if (kit > limit) {
          reasons.push("kit " + kit + " kg > " + limit.toFixed(1) + " kg (" + Math.round((typeof g.encumbranceLimit === "number" ? g.encumbranceLimit : 1.0) * 100) + "% of capacity " + capacity.toFixed(1) + " kg): TU penalty");
        }
      }
    } else if (kit > 0) {
      reasons.push("STR unknown, cannot verify encumbrance");
    }
    if (g.psiEra && role.frontline) {
      const brvFloor = typeof g.psiBrvFloor === "number" ? g.psiBrvFloor : 50;
      const brv = soldier.stats.BRV;
      if (typeof brv !== "number" || brv < brvFloor) {
        reasons.push("psi era: BRV " + (typeof brv === "number" ? brv : "?") + " < frontline floor " + brvFloor);
      }
    }
    return { ok: reasons.length === 0, reasons };
  }

  /* Weighted sum of normalized stats for a role. Assumes eligibility passed. */
  function roleScore(soldier, role, normOf) {
    const n = normOf(soldier);
    let score = 0;
    for (const st of Object.keys(role.weights || {})) {
      const w = role.weights[st];
      if (typeof w === "number" && domain().STATS.indexOf(st) !== -1) score += w * (n[st] || 0);
    }
    return score;
  }

  /*
   * Training fit of a seat for a soldier: how much room the soldier has left
   * in the stats the role trains (sum of 1 - normalized). Used only as the
   * second tie-breaker.
   */
  function trainingFit(soldier, role, normOf) {
    const n = normOf(soldier);
    let fit = 0;
    for (const st of role.trains || []) if (domain().STATS.indexOf(st) !== -1) fit += 1 - (n[st] || 0);
    return fit;
  }

  /* ---------- 4. score matrix ---------- */

  /*
   * Build the square soldier x seat score matrix, padded with dummy rows/cols
   * (score 0) when one side is larger, so the solver always gets n x n.
   * Forbidden (ineligible) cells get FORBIDDEN.
   */
  function buildScoreMatrix(eligible, seatRoleIds, rolesById, settings, normOf) {
    const rows = eligible.length;
    const cols = seatRoleIds.length;
    const n = Math.max(rows, cols, 1);
    const matrix = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let j = 0; j < n; j++) {
        const soldier = i < rows ? eligible[i] : null; // dummy soldier row
        const roleId = j < cols ? seatRoleIds[j] : null; // dummy seat col
        if (!soldier || !roleId) { row.push(0); continue; }
        const role = rolesById[roleId];
        if (!role) { row.push(FORBIDDEN); continue; }
        const elig = roleEligibility(soldier, role, settings);
        if (!elig.ok) { row.push(FORBIDDEN); continue; }
        const base = roleScore(soldier, role, normOf);
        // tie-breakers as epsilon additions (see module docstring)
        row.push(base + (soldier.rank || 0) * RANK_EPS + trainingFit(soldier, role, normOf) * TRAIN_EPS);
      }
      matrix.push(row);
    }
    return matrix;
  }

  /* ---------- 4a. PROVISIONAL greedy assignment (milestone 3) ---------- */
  /*
   * Greedy per-seat picking: for each seat in order, take the best remaining
   * soldier. KNOWN TO BE SUBOPTIMAL — the best sniper is often also the best
   * scout, and greedy steals him for the first seat. Replaced by the Hungarian
   * solver in milestone 4; kept here only so the pipeline runs end to end.
   * Returns rowCol: row i is assigned to column rowCol[i] (-1 = unassigned).
   */
  function greedyAssign(matrix) {
    const n = matrix.length;
    const used = new Array(n).fill(false);
    const rowCol = new Array(n).fill(-1);
    for (let j = 0; j < n; j++) {
      let best = -1;
      let bestV = -Infinity;
      for (let i = 0; i < n; i++) {
        if (!used[i] && matrix[i][j] > bestV) {
          bestV = matrix[i][j];
          best = i;
        }
      }
      if (best >= 0) {
        used[best] = true;
        rowCol[best] = j;
      }
    }
    return rowCol;
  }

  /* ---------- full pipeline ---------- */

  /*
   * planSquad(soldiers, settings, options) -> {
   *   picks: [{ seatIndex, roleId, role, soldier|null, score, why: [..], training: bool }],
   *   bench: [{ soldier, composite }], ineligible: [{ soldier, reasons }], notices: []
   * }
   * options: { seats: [roleId..] (default settings.seats), solver: fn(matrix)->rowCol
   *           (default greedyAssign; milestone 4 passes the Hungarian solver) }
   */
  function planSquad(soldiers, settings, options) {
    const opts = options || {};
    const seats = opts.seats || settings.seats || [];
    const solver = opts.solver || greedyAssign;
    const g = settings.global || {};
    const rolesById = {};
    for (const r of settings.roles || []) rolesById[r.id] = r;
    const notices = [];

    /*
     * Recruit mode (settings.global.includeRecruits, tri-state):
     *   false   "off"   — plan with the active team only (default);
     *   "empty" "empty" — team first; recruits may fill ONLY seats that ended
     *                     up with no eligible team soldier;
     *   true    "all"   — recruits compete for every seat like team soldiers.
     * Recruitment-pool soldiers are the ones with inTeam === false (detected
     * via the teamStringPrefix format setting). They always show in the
     * Soldiers tab; they are just not fielded unless the mode says so.
     * Any other value falls back to "off", so old or hand-edited settings and
     * exports from earlier versions stay safe.
     */
    const recruitMode = g.includeRecruits === true ? "all" : g.includeRecruits === "empty" ? "empty" : "off";
    const planningRoster = recruitMode === "all" ? soldiers : soldiers.filter((s) => s.inTeam !== false);
    const recruitPoolAll = soldiers.filter((s) => s.inTeam === false);
    const recruitCount = soldiers.length - planningRoster.length;
    if (recruitCount > 0 && recruitMode === "off") {
      notices.push(recruitCount + " recruitable soldier(s) are not in the active team and were excluded from planning (Settings → Recruits to change this).");
    }

    const eligibility = computeEligibility(planningRoster, settings);
    const eligible = eligibility.filter((e) => e.eligible).map((e) => e.soldier);
    const ineligible = eligibility.filter((e) => !e.eligible);

    const norms = normalizeRoster(eligible);
    const normOf = norms.norm;

    const picks = new Array(seats.length).fill(null);
    let pool = eligible.slice();
    let seatIdxs = seats.map((_, j) => j);

    /*
     * 6. training seat: reserve one seat for the lowest-composite healthy
     * soldier — but only among soldiers ELIGIBLE for that seat's role (floors,
     * encumbrance). If nobody eligible fits, the seat is not reserved and
     * goes through the normal global assignment.
     */
    if (g.trainingSeat && seats.length > 0 && eligible.length > 0) {
      const seatIdx = typeof g.trainingSeatIndex === "number" && g.trainingSeatIndex >= 0 && g.trainingSeatIndex < seats.length ? g.trainingSeatIndex : 0;
      const trainRole = rolesById[seats[seatIdx]];
      const candidates = [];
      for (let i = 0; i < pool.length; i++) {
        if (!trainRole || roleEligibility(pool[i], trainRole, settings).ok) candidates.push(i);
      }
      if (candidates.length > 0) {
        let bestI = candidates[0];
        let bestC = composite(normOf, pool[bestI]);
        for (const i of candidates) {
          const c = composite(normOf, pool[i]);
          if (c < bestC) { bestC = c; bestI = i; }
        }
        const trainee = pool[bestI];
        picks[seatIdx] = { seatIndex: seatIdx, roleId: seats[seatIdx], role: trainRole, soldier: trainee, score: null, why: ["training seat: lowest composite eligible for this seat"], training: true };
        pool = pool.filter((_, i) => i !== bestI);
        seatIdxs = seatIdxs.filter((j) => j !== seatIdx);
        notices.push("Training seat: " + trainee.name + " rides along in seat " + (seatIdx + 1) + " (" + (trainRole || {}).name + ").");
      }
    }

    /*
     * One global assignment over a subset of seats. Shared by the team pass
     * and the "empty seats" recruit pass below: build the score matrix of
     * `poolArg` x those seats, solve it ONCE (never greedy per-seat), write
     * the picks with their "why" lines. Seats whose solver cell is FORBIDDEN
     * (or that map to a dummy pad row) stay empty; their notice is emitted by
     * the final sweep after all passes, so wording can account for recruits.
     */
    function assignSeats(poolArg, seatIdxsArg) {
      const subSeats = seatIdxsArg.map((j) => seats[j]);
      const matrix = buildScoreMatrix(poolArg, subSeats, rolesById, settings, normOf);
      const rowCol = solver(matrix);
      const colRow = new Array(matrix.length).fill(-1);
      for (let i = 0; i < rowCol.length; i++) if (rowCol[i] >= 0) colRow[rowCol[i]] = i;

      for (let jj = 0; jj < seatIdxsArg.length; jj++) {
        const seatIndex = seatIdxsArg[jj];
        const roleId = seats[seatIndex];
        const role = rolesById[roleId];
        if (!role) continue;
        const i = colRow[jj];
        const soldier = i >= 0 && i < poolArg.length ? poolArg[i] : null; // dummy row -> unfilled
        const cell = soldier ? matrix[i][jj] : FORBIDDEN;
        if (!soldier || cell <= FORBIDDEN / 2) {
          picks[seatIndex] = { seatIndex, roleId, role, soldier: null, score: null, why: ["no eligible soldier for this seat"], training: false };
          continue;
        }
        // why: top contributing stats (weight x normalized value)
        const n = normOf(soldier);
        const contribs = Object.keys(role.weights || {})
          .map((st) => ({ st, c: (role.weights[st] || 0) * (n[st] || 0), w: role.weights[st] || 0, v: n[st] || 0 }))
          .filter((x) => x.w > 0)
          .sort((a, b) => (b.c - a.c) || (a.st < b.st ? -1 : 1))
          .slice(0, 3)
          .map((x) => x.st + " " + x.v.toFixed(2) + "×" + x.w);
        picks[seatIndex] = { seatIndex, roleId, role, soldier, score: cell, why: contribs.length ? ["top stats: " + contribs.join(", ")] : ["no weighted stats"], training: false };
      }
    }

    // 4. one global assignment over the remaining (non-training) seats
    assignSeats(pool, seatIdxs);

    /*
     * "empty" recruit mode: run a SECOND assignment with the recruit pool
     * over ONLY the seats the team pass left empty — a recruit can never
     * displace a soldier the active team could field. Recruits are scored
     * against the SAME normalization as the team (norms over the eligible
     * team roster), so their scores stay on the team's scale; floors and the
     * encumbrance check still apply on raw stats, so an ineligible recruit
     * just gets a FORBIDDEN cell and the seat stays empty.
     */
    if (recruitMode === "empty" && recruitPoolAll.length > 0) {
      const emptySeatIdxs = seatIdxs.filter((j) => picks[j] && !picks[j].soldier);
      if (emptySeatIdxs.length === 0) {
        notices.push("Recruits held back: every seat had an eligible active-team soldier.");
      } else {
        const recElig = computeEligibility(recruitPoolAll, settings);
        for (const e of recElig) if (!e.eligible) ineligible.push(e);
        const recEligible = recElig.filter((e) => e.eligible).map((e) => e.soldier);
        if (recEligible.length > 0) {
          assignSeats(recEligible, emptySeatIdxs);
          const filled = emptySeatIdxs.filter((j) => picks[j] && picks[j].soldier);
          if (filled.length > 0) {
            notices.push("Recruits used only for seat(s) " + filled.map((j) => (j + 1) + " (" + (rolesById[seats[j]] || {}).name + ")").join(", ") + ": no active-team soldier was eligible for " + (filled.length === 1 ? "this seat" : "these seats") + ".");
          }
        }
      }
    }

    /*
     * Seats that stayed empty after all passes are shown on their own seat
     * card in the UI (pick.why), not as extra notice lines - the card already
     * says "Seat N - Role" + the reason, so a separate notice per seat would
     * just duplicate it.
     */
    for (let j = 0; j < seats.length; j++) {
      const p = picks[j];
      if (p && !p.soldier) {
        p.why = ["no eligible soldier for this seat" + (recruitMode === "empty" ? " (active team or recruit pool)" : "")];
      }
    }

    // flag recruitable picks so the UI can mark them ("hire first")
    const recruitPicks = picks.filter((p) => p && p.soldier && p.soldier.inTeam === false);
    if (recruitPicks.length > 0) {
      notices.push(recruitPicks.length + " suggested pick(s) are recruitable soldiers; hire them in-game before the mission (marked on their pick card).");
    }

    // bench: eligible soldiers not picked, best first
    const pickedIds = new Set(picks.filter((p) => p && p.soldier).map((p) => p.soldier.id));
    const bench = pool
      .filter((s) => !pickedIds.has(s.id))
      .map((s) => ({ soldier: s, composite: composite(normOf, s) }))
      .sort((a, b) => b.composite - a.composite || (a.soldier.id < b.soldier.id ? -1 : 1));

    return { picks, bench, ineligible, notices };
  }

  /* ---------- dismiss list (hired soldiers not worth the upkeep) ---------- */

  /*
   * dismissList(soldiers, settings) -> { entries, threshold, median, teamSize, upkeep }.
   *
   * The "dismiss" idea: in vanilla Xenonauts 1 every hired soldier costs a flat
   * $10,000/month salary (Xenonauts wiki; NOT rank-dependent), so a hired
   * soldier whose stats are far below the rest of the team is not worth the
   * upkeep. We reuse the planning pipeline's min-max normalization + composite
   * (same scale as the bench order), take the active team's MEDIAN composite,
   * and flag every in-team soldier below settings.dismiss.belowFraction x
   * median. Recruits are never listed (they cost nothing until hired).
   * Pure and deterministic: same roster + same settings -> same list.
   */
  function dismissList(soldiers, settings) {
    const d = (settings && settings.dismiss) || {};
    const belowFraction = typeof d.belowFraction === "number" && Number.isFinite(d.belowFraction) ? d.belowFraction : 0.7;
    const upkeep = typeof d.soldierUpkeep === "number" && Number.isFinite(d.soldierUpkeep) ? d.soldierUpkeep : 10000;
    const maxListed = Number.isInteger(d.maxListed) && d.maxListed > 0 ? d.maxListed : 0;
    const team = (soldiers || []).filter((s) => s.inTeam !== false);
    if (team.length === 0) return { entries: [], threshold: 0, median: 0, teamSize: 0, upkeep };
    const norms = normalizeRoster(team);
    const withC = team.map((s) => ({ soldier: s, composite: composite(norms.norm, s) }));
    const asc = withC.slice().sort((a, b) => a.composite - b.composite);
    const median = asc[Math.floor(asc.length / 2)].composite; // upper median, deterministic
    const threshold = belowFraction * median;
    let entries = withC
      .filter((x) => x.composite < threshold)
      .sort((a, b) => a.composite - b.composite || (a.soldier.id < b.soldier.id ? -1 : 1))
      .map((x) => ({
        soldier: x.soldier,
        composite: x.composite,
        median,
        fraction: median > 0 ? x.composite / median : 0,
        rankLabel: domain().rankLabel(x.soldier.rank),
        upkeep,
        hpFraction: domain().hpFraction(x.soldier),
      }));
    if (maxListed > 0) entries = entries.slice(0, maxListed);
    return { entries, threshold, median, teamSize: team.length, upkeep };
  }

  /*
   * hireList(soldiers, settings) -> { entries, threshold, median, recruitCount, hireCost, upkeep }.
   *
   * The inverse of the dismiss list: which RECRUITS (inTeam === false) are
   * worth hiring. Recruits are scored with the SAME normalization as the
   * active team (norms over the team roster, like the "empty seats" recruit
   * pass in planSquad), so composites are directly comparable with the
   * dismiss list's scale. A recruit is worth hiring when its composite is at
   * least settings.dismiss.hireFraction x the team median composite (default
   * 1.0: at least as good as the median team soldier). Entries are best-first.
   * In vanilla X1 hiring costs a flat $10,000 plus the $10,000/month salary
   * (wiki). Pure and deterministic.
   */
  function hireList(soldiers, settings) {
    const d = (settings && settings.dismiss) || {};
    const hireFraction = typeof d.hireFraction === "number" && Number.isFinite(d.hireFraction) ? d.hireFraction : 1.0;
    const hireMaxListed = Number.isInteger(d.hireMaxListed) && d.hireMaxListed > 0 ? d.hireMaxListed : 0;
    const upkeep = typeof d.soldierUpkeep === "number" && Number.isFinite(d.soldierUpkeep) ? d.soldierUpkeep : 10000;
    const hireCost = typeof d.hireCost === "number" && Number.isFinite(d.hireCost) ? d.hireCost : 10000;
    const team = (soldiers || []).filter((s) => s.inTeam !== false);
    const recruits = (soldiers || []).filter((s) => s.inTeam === false);
    if (team.length === 0 || recruits.length === 0) {
      return { entries: [], threshold: 0, median: 0, recruitCount: recruits.length, hireCost, upkeep };
    }
    const norms = normalizeRoster(team);
    const asc = team.map((s) => composite(norms.norm, s)).sort((a, b) => a - b);
    const median = asc[Math.floor(asc.length / 2)];
    const threshold = hireFraction * median;
    let entries = recruits
      .map((s) => ({ soldier: s, composite: composite(norms.norm, s) }))
      .filter((x) => x.composite >= threshold)
      .sort((a, b) => b.composite - a.composite || (a.soldier.id < b.soldier.id ? -1 : 1))
      .map((x) => ({
        soldier: x.soldier,
        composite: x.composite,
        median,
        fraction: median > 0 ? x.composite / median : 0,
        rankLabel: domain().rankLabel(x.soldier.rank),
        hireCost,
        upkeep,
        hpFraction: null, // recruits are at full HP in-game
      }));
    if (hireMaxListed > 0) entries = entries.slice(0, hireMaxListed);
    return { entries, threshold, median, recruitCount: recruits.length, hireCost, upkeep };
  }

  return {
    FORBIDDEN,
    RANK_EPS,
    TRAIN_EPS,
    computeEligibility,
    normalizeRoster,
    composite,
    roleEligibility,
    roleScore,
    trainingFit,
    buildScoreMatrix,
    greedyAssign,
    planSquad,
    dismissList,
    hireList,
  };
});
