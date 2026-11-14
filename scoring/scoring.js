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
 *   7. encumbrance     — kit_weight must stay at/below the limit fraction of
 *                        STR capacity (inverted on purpose if the role sets
 *                        strength_training).
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
      const frac = domain().hpFraction(soldier);
      if (frac != null && frac < threshold) {
        reasons.push("wounded (" + Math.round(frac * 100) + "% HP < " + Math.round(threshold * 100) + "% threshold)");
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
      const capacity = str * (typeof g.strCapacityFactor === "number" ? g.strCapacityFactor : 1);
      const limit = (typeof g.encumbranceLimit === "number" ? g.encumbranceLimit : 0.8) * capacity;
      if (role.strengthTraining) {
        if (!(kit > limit)) reasons.push("kit " + kit + " not above " + Math.round(limit) + " (strength_training wants overload)");
      } else if (kit > limit) {
        reasons.push("kit " + kit + " > " + Math.round(limit) + " (" + Math.round((typeof g.encumbranceLimit === "number" ? g.encumbranceLimit : 0.8) * 100) + "% of STR capacity " + Math.round(capacity) + ")");
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
     * Team membership filter: recruitment-pool soldiers (inTeam === false,
     * detected via the teamStringPrefix format setting) are excluded from
     * planning unless the global "include recruitable soldiers" setting is on.
     * They are still shown in the Soldiers tab — just not fielded.
     */
    const includeRecruits = !!(settings.global && settings.global.includeRecruits);
    const planningRoster = includeRecruits ? soldiers : soldiers.filter((s) => s.inTeam !== false);
    const recruitCount = soldiers.length - planningRoster.length;
    if (recruitCount > 0) {
      notices.push(recruitCount + " recruitable soldier(s) are not in the active team and were excluded from planning (Settings → include recruitable soldiers to change this).");
    }

    const eligibility = computeEligibility(planningRoster, settings);
    const eligible = eligibility.filter((e) => e.eligible).map((e) => e.soldier);
    const ineligible = eligibility.filter((e) => !e.eligible);

    const norms = normalizeRoster(eligible);
    const normOf = norms.norm;

    const picks = new Array(seats.length).fill(null);
    let pool = eligible.slice();
    let seatIdxs = seats.map((_, j) => j);

    // 6. training seat: reserve one seat for the lowest-composite healthy soldier
    if (g.trainingSeat && seats.length > 0 && eligible.length > 0) {
      let seatIdx = typeof g.trainingSeatIndex === "number" && g.trainingSeatIndex >= 0 && g.trainingSeatIndex < seats.length ? g.trainingSeatIndex : 0;
      let bestI = 0;
      let bestC = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const c = composite(normOf, pool[i]);
        if (c < bestC) { bestC = c; bestI = i; }
      }
      const trainee = pool[bestI];
      picks[seatIdx] = { seatIndex: seatIdx, roleId: seats[seatIdx], role: rolesById[seats[seatIdx]], soldier: trainee, score: null, why: ["training seat — lowest composite in the eligible roster"], training: true };
      pool = pool.filter((_, i) => i !== bestI);
      seatIdxs = seatIdxs.filter((j) => j !== seatIdx);
      notices.push("Training seat: " + trainee.name + " rides along in seat " + (seatIdx + 1) + " (" + (rolesById[seats[seatIdx]] || {}).name + ").");
    }

    // 4. one global assignment over the remaining seats
    const subSeats = seatIdxs.map((j) => seats[j]);
    const matrix = buildScoreMatrix(pool, subSeats, rolesById, settings, normOf);
    const rowCol = solver(matrix);
    const colRow = new Array(matrix.length).fill(-1);
    for (let i = 0; i < rowCol.length; i++) if (rowCol[i] >= 0) colRow[rowCol[i]] = i;

    for (let jj = 0; jj < seatIdxs.length; jj++) {
      const seatIndex = seatIdxs[jj];
      const roleId = seats[seatIndex];
      const role = rolesById[roleId];
      if (!role) continue;
      const i = colRow[jj];
      const soldier = i >= 0 && i < pool.length ? pool[i] : null; // dummy row -> unfilled
      const cell = soldier ? matrix[i][jj] : FORBIDDEN;
      if (!soldier || cell <= FORBIDDEN / 2) {
        picks[seatIndex] = { seatIndex, roleId, role, soldier: null, score: null, why: ["no eligible soldier for this seat"], training: false };
        notices.push("Seat " + (seatIndex + 1) + " (" + role.name + "): no eligible soldier — left empty.");
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

    // bench: eligible soldiers not picked, best first
    const pickedIds = new Set(picks.filter((p) => p && p.soldier).map((p) => p.soldier.id));
    const bench = pool
      .filter((s) => !pickedIds.has(s.id))
      .map((s) => ({ soldier: s, composite: composite(normOf, s) }))
      .sort((a, b) => b.composite - a.composite || (a.soldier.id < b.soldier.id ? -1 : 1));

    return { picks, bench, ineligible, notices };
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
  };
});
