/*
 * tests/scoring.test.js — scoring pipeline tests: exclusions, normalization,
 * role eligibility (floors / encumbrance / psi BRV floor), role scoring,
 * matrix building + padding, the provisional greedy, and planSquad end to
 * end (determinism, bench, unfilled seats, training seat).
 */
(function (root) {
  "use strict";
  const { test } = root.XSTest;
  const XS = root.XS;

  function mkSoldier(name, stats, currentHP, rank) {
    return XS.domain.makeSoldier({
      id: name,
      name,
      stats: Object.assign({ TU: 50, ACC: 50, RFL: 50, BRV: 50, STR: 50, HP: 50 }, stats),
      currentHP: currentHP == null ? 50 : currentHP,
      rank: rank || 0,
    });
  }

  function settingsWith(overrides) {
    const s = XS.settings.defaultSettings();
    Object.assign(s.global, overrides || {});
    return s;
  }

  test("exclusions: below the wounded HP threshold is ineligible, at/above is eligible", (t) => {
    const s = settingsWith({ woundedThreshold: 0.5 });
    const roster = [mkSoldier("a", {}, 50), mkSoldier("b", {}, 25), mkSoldier("c", {}, 24.9), mkSoldier("d", { HP: 50 }, null)];
    const elig = XS.scoring.computeEligibility(roster, s);
    t.ok(elig[0].eligible, "full HP eligible");
    t.ok(elig[1].eligible, "exactly 50% eligible (below threshold means strictly below)");
    t.notOk(elig[2].eligible, "24.9% < 50% ineligible");
    t.ok(/wounded/.test(elig[2].reasons[0]));
    t.ok(elig[3].eligible, "missing HP -> check skipped, eligible");
  });

  test("exclusions: recruitable soldiers (inTeam false) are never wounded-excluded", (t) => {
    const s = settingsWith({ woundedThreshold: 0.5 });
    const recruit = mkSoldier("rookie", { HP: 50 }, 5); // 10% HP — would be wounded if the check applied
    recruit.inTeam = false;
    const team = mkSoldier("vet", { HP: 50 }, 5);
    team.inTeam = true;
    const elig = XS.scoring.computeEligibility([recruit, team], s);
    t.ok(elig[0].eligible, "recruit at 10% HP is still eligible (recruits never deploy, so never wounded)");
    t.notOk(elig[1].eligible, "team soldier at 10% HP is wounded");
    t.ok(/wounded/.test(elig[1].reasons[0]));
  });

  test("normalization: min-max across the eligible roster; equal stats normalize to 0", (t) => {
    const roster = [mkSoldier("a", { ACC: 40 }), mkSoldier("b", { ACC: 60 }), mkSoldier("c", { ACC: 50 })];
    const n = XS.scoring.normalizeRoster(roster).norm;
    t.equal(n(roster[0]).ACC, 0);
    t.equal(n(roster[1]).ACC, 1);
    t.equal(n(roster[2]).ACC, 0.5);
    const eq = XS.scoring.normalizeRoster([mkSoldier("x", { TU: 50 }), mkSoldier("y", { TU: 50 })]).norm;
    t.equal(eq(roster[0]).TU, 0, "all-equal stat contributes nothing");
  });

  test("role eligibility: stat floors on raw stats", (t) => {
    const s = settingsWith({});
    const role = XS.domain.makeRole({ id: "sniper", weights: { ACC: 4 }, floors: { ACC: 55 } });
    t.ok(XS.scoring.roleEligibility(mkSoldier("a", { ACC: 55 }), role, s).ok);
    t.notOk(XS.scoring.roleEligibility(mkSoldier("b", { ACC: 54 }), role, s).ok);
  });

  test("role eligibility: encumbrance check (game formula: capacity = 8 + 0.3×STR kg) and strength_training inversion", (t) => {
    // defaults: base 8, coef 0.3, limit 1.0, train threshold 0.8
    const s = settingsWith({});
    // STR 50 -> capacity 8 + 15 = 23 kg; limit 1.0 -> 23 kg: kit 23 passes, 24 fails
    const role = XS.domain.makeRole({ id: "mg", weights: {}, kitWeight: 23 });
    t.ok(XS.scoring.roleEligibility(mkSoldier("a", { STR: 50 }), role, s).ok, "kit == capacity passes (no TU penalty up to 100%)");
    const heavy = XS.domain.makeRole({ id: "mg2", weights: {}, kitWeight: 24 });
    t.notOk(XS.scoring.roleEligibility(mkSoldier("a", { STR: 50 }), heavy, s).ok, "24 > 23 kg -> TU penalty");
    t.ok(XS.scoring.roleEligibility(mkSoldier("b", { STR: 60 }), heavy, s).ok, "STR 60 -> capacity 26 kg >= 24");
    // strength_training inverts against the 0.8 training threshold:
    // STR 50 -> train at 0.8 x 23 = 18.4 kg: kit 19+ overloads (trains STR), kit 18 does not
    const trainer = XS.domain.makeRole({ id: "mg3", weights: {}, kitWeight: 19, strengthTraining: true });
    t.ok(XS.scoring.roleEligibility(mkSoldier("a", { STR: 50 }), trainer, s).ok, "19 > 18.4 -> above STR-training threshold on purpose");
    const light = XS.domain.makeRole({ id: "mg4", weights: {}, kitWeight: 18, strengthTraining: true });
    t.notOk(XS.scoring.roleEligibility(mkSoldier("a", { STR: 50 }), light, s).ok, "18 <= 18.4 -> below threshold, fails");
    // custom limit: encumbranceLimit 0.5 halves the no-penalty load
    const s2 = settingsWith({ encumbranceLimit: 0.5 });
    t.notOk(XS.scoring.roleEligibility(mkSoldier("a", { STR: 50 }), role, s2).ok, "23 > 0.5 x 23 = 11.5 -> fails at limit 0.5");
  });

  test("role eligibility: psi era applies the BRV floor only to frontline roles", (t) => {
    const s = settingsWith({ psiEra: true, psiBrvFloor: 50 });
    const front = XS.domain.makeRole({ id: "breacher", weights: {}, frontline: true });
    const back = XS.domain.makeRole({ id: "sniper", weights: {}, frontline: false });
    t.notOk(XS.scoring.roleEligibility(mkSoldier("a", { BRV: 49 }), front, s).ok);
    t.ok(XS.scoring.roleEligibility(mkSoldier("a", { BRV: 50 }), front, s).ok);
    t.ok(XS.scoring.roleEligibility(mkSoldier("a", { BRV: 10 }), back, s).ok, "non-frontline unaffected");
    const off = settingsWith({ psiEra: false, psiBrvFloor: 50 });
    t.ok(XS.scoring.roleEligibility(mkSoldier("a", { BRV: 10 }), front, off).ok, "psi era off -> no floor");
  });

  test("roleScore: weighted sum of normalized stats", (t) => {
    const roster = [mkSoldier("a", { ACC: 40, RFL: 60 }), mkSoldier("b", { ACC: 60, RFL: 40 })];
    const norm = XS.scoring.normalizeRoster(roster).norm;
    const role = XS.domain.makeRole({ id: "x", weights: { ACC: 3, RFL: 2 } });
    // a: ACC norm 0, RFL norm 1 -> 3*0 + 2*1 = 2 ; b: 3*1 + 2*0 = 3
    t.equal(XS.scoring.roleScore(roster[0], role, norm), 2);
    t.equal(XS.scoring.roleScore(roster[1], role, norm), 3);
  });

  test("matrix: square with padding, forbidden cells for ineligible candidates", (t) => {
    const s = settingsWith({});
    const role = XS.domain.makeRole({ id: "sniper", weights: { ACC: 4 }, floors: { ACC: 55 } });
    s.roles = [role];
    const a = mkSoldier("a", { ACC: 60 });
    const b = mkSoldier("b", { ACC: 50 }); // fails floor
    const c = mkSoldier("c", { ACC: 70 });
    // more seats than soldiers -> dummy ROW; more soldiers than seats -> dummy COL
    const norm = XS.scoring.normalizeRoster([a, b]).norm;
    const m = XS.scoring.buildScoreMatrix([a, b], ["sniper", "sniper", "sniper", "sniper"], { sniper: role }, s, norm);
    t.equal(m.length, 4, "4 seats x 2 soldiers pads to 4x4");
    t.ok(m[0][0] > 0, "eligible soldier has positive score");
    t.equal(m[1][0], XS.scoring.FORBIDDEN, "floor-failing soldier is forbidden");
    t.equal(m[2][0], 0, "dummy row scores 0");
    t.equal(m[3][3], 0, "dummy row x dummy col scores 0");
    const norm3 = XS.scoring.normalizeRoster([a, b, c]).norm;
    const m2 = XS.scoring.buildScoreMatrix([a, b, c], ["sniper", "sniper"], { sniper: role }, s, norm3);
    t.equal(m2.length, 3, "3 soldiers x 2 seats pads to 3x3");
    t.equal(m2[0][2], 0, "dummy seat col scores 0");
    t.equal(m2[2][2], 0, "dummy seat col scores 0 for every row");
    t.ok(m2[2][0] > 0, "real row x real col has a real score");
  });

  test("matrix: rank tie-breaker orders equal scores by rank (epsilon)", (t) => {
    const s = settingsWith({});
    const role = XS.domain.makeRole({ id: "r", weights: { ACC: 1 } });
    s.roles = [role];
    const low = mkSoldier("low", { ACC: 50 }, 50, 1);
    const high = mkSoldier("high", { ACC: 50 }, 50, 9);
    const norm = XS.scoring.normalizeRoster([low, high]).norm;
    const m = XS.scoring.buildScoreMatrix([low, high], ["r"], { r: role }, s, norm);
    t.ok(m[1][0] > m[0][0], "equal base score, higher rank wins via epsilon");
  });

  test("greedy (provisional): assigns one soldier per seat, leaves none double-booked", (t) => {
    const m = [
      [10, 9],
      [8, 1],
    ];
    const rowCol = XS.scoring.greedyAssign(m);
    t.equal(rowCol.filter((x) => x >= 0).length, 2);
    t.notEqual(rowCol[0], rowCol[1]);
    // and it is demonstrably suboptimal here: greedy takes seat0->row0 (10),
    // leaving row1->seat1 (1) = 11 total, while the optimum is 9+8 = 17
    const total = rowCol.reduce((sum, j, i) => sum + (j >= 0 ? m[i][j] : 0), 0);
    t.equal(total, 11, "greedy is the known-suboptimal placeholder (optimum is 17)");
  });

  function fixtureRoster(seed, n) {
    const { bytes } = XS.fixture.buildFixtureSave({ seed, soldiers: n });
    const res = XS.parser.parseSaveWithSettings(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), XS.settings.defaultSettings());
    return res.soldiers;
  }

  test("planSquad: end-to-end on the fixture roster — all seats filled, soldiers distinct, bench correct", (t) => {
    const roster = fixtureRoster(101, 12);
    const settings = XS.settings.defaultSettings();
    settings.global.woundedThreshold = 0; // keep all 12 eligible for this test
    const result = XS.scoring.planSquad(roster, settings, { seats: settings.seats });
    t.equal(result.picks.length, 8, "default 8 seats");
    const picked = result.picks.filter((p) => p && p.soldier);
    const empty = result.picks.filter((p) => p && !p.soldier);
    t.equal(picked.length + empty.length, 8, "every seat gets an entry (filled or empty)");
    t.ok(picked.length >= 6, "greedy fills most seats (floors can starve a late seat — the known greedy weakness)");
    t.equal(new Set(picked.map((p) => p.soldier.id)).size, picked.length, "no soldier double-booked");
    t.equal(result.bench.length, 12 - picked.length, "bench = eligible minus picked");
    t.ok(result.picks.every((p) => p && p.why.length > 0), "every pick has a why line");
  });

  test("planSquad: deterministic — same roster + settings give identical results", (t) => {
    const roster = fixtureRoster(102, 10);
    const settings = XS.settings.defaultSettings();
    const r1 = XS.scoring.planSquad(roster, settings, {});
    const r2 = XS.scoring.planSquad(roster, settings, {});
    t.deepEqual(r1, r2);
  });

  test("planSquad: fewer eligible soldiers than seats pads and leaves seats empty (reason on the card)", (t) => {
    const roster = [mkSoldier("a", { ACC: 60 }), mkSoldier("b", { ACC: 70 }), mkSoldier("wounded", { ACC: 80 }, 10)];
    const settings = settingsWith({ woundedThreshold: 0.5 });
    settings.roles = [XS.domain.makeRole({ id: "rifleman", name: "Rifleman", weights: { ACC: 3 } })];
    settings.seats = ["rifleman", "rifleman", "rifleman", "rifleman"];
    const result = XS.scoring.planSquad(roster, settings, {});
    t.equal(result.ineligible.length, 1, "wounded soldier excluded");
    const filled = result.picks.filter((p) => p && p.soldier);
    t.equal(filled.length, 2, "only 2 eligible soldiers -> 2 seats filled");
    const empty = result.picks.filter((p) => p && !p.soldier);
    t.equal(empty.length, 2, "2 seats left empty");
    t.ok(empty.every((p) => /no eligible soldier/.test(p.why[0])), "empty seats carry the reason in why (rendered on their card)");
    t.notOk(result.notices.some((n) => /left empty/.test(n)), "no per-seat notices");
  });

  test("planSquad: training seat reserves one seat for the lowest-composite healthy soldier", (t) => {
    const roster = fixtureRoster(103, 10);
    const settings = XS.settings.defaultSettings();
    settings.global.trainingSeat = true;
    settings.global.trainingSeatIndex = 0;
    const eligible = XS.scoring.computeEligibility(roster, settings).filter((e) => e.eligible).map((e) => e.soldier);
    const norms = XS.scoring.normalizeRoster(eligible);
    const composites = eligible.map((s) => XS.scoring.composite(norms.norm, s));
    const minIdx = composites.indexOf(Math.min.apply(null, composites));
    const result = XS.scoring.planSquad(roster, settings, {});
    const trainingPick = result.picks[0];
    t.ok(trainingPick.training, "seat 0 is the training seat");
    t.equal(trainingPick.soldier.id, eligible[minIdx].id, "lowest-composite eligible soldier rides along");
    const others = result.picks.slice(1).filter((p) => p && p.soldier);
    t.ok(others.every((p) => p.soldier.id !== trainingPick.soldier.id), "trainee not double-booked");
  });
})(typeof self !== "undefined" ? self : globalThis);
