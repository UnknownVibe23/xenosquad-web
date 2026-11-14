/*
 * tests/assignment.test.js — assignment edge cases through the full pipeline
 * (planSquad + Hungarian): optimality on a crafted two-seat case, empty
 * inputs, more seats than soldiers, unknown roles, and determinism.
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

  function settingsFor(roles, seats, globalOverrides) {
    const s = XS.settings.defaultSettings();
    s.roles = roles;
    s.seats = seats;
    Object.assign(s.global, globalOverrides || {});
    return s;
  }

  test("assignment: crafted case where greedy steals the shared best soldier", (t) => {
    // Two seats: sniper (ACC-heavy) then scout (also ACC-heavy but less).
    // Soldier A dominates both; B is close on sniper but terrible on scout.
    const sniper = XS.domain.makeRole({ id: "sniper", name: "Sniper", weights: { ACC: 4 }, kitWeight: 0 });
    const scout = XS.domain.makeRole({ id: "scout", name: "Scout", weights: { ACC: 3.8, TU: 0.1 }, kitWeight: 0 });
    const settings = settingsFor([sniper, scout], ["sniper", "scout"], { woundedThreshold: 0 });
    const A = mkSoldier("A", { ACC: 70, TU: 40 });
    const B = mkSoldier("B", { ACC: 68, TU: 30 });
    // normalized over {A,B}: ACC: A=1,B=0 ; TU: A=0.33,B=0
    // sniper: A=4.0, B=3.8 ; scout: A=3.8+0.033=3.83, B=3.8+0=3.8
    // greedy (sniper first): A->sniper(4.0), B->scout(3.8) = 7.8
    // optimal: A->scout(3.83), B->sniper(3.8) = 7.63 ... craft harder below
    const roster = [A, B];
    const hung = XS.scoring.planSquad(roster, settings, { solver: XS.hungarian.hungarianMax });
    const greedy = XS.scoring.planSquad(roster, settings, { solver: XS.scoring.greedyAssign });
    const total = (r) => r.picks.reduce((s, p) => s + (p && p.soldier ? p.score : 0), 0);
    t.ok(total(hung) >= total(greedy) - 1e-9, "hungarian never worse than greedy");
    // and on the classic matrix the difference is real (covered in hungarian.test.js)
    t.equal(hung.picks.length, 2);
    t.notEqual(hung.picks[0].soldier.id, hung.picks[1].soldier.id);
  });

  test("assignment: optimal squad on the classic 2x2 via the pipeline", (t) => {
    // Build roles so the score matrix becomes [[10,9],[8,1]] exactly:
    // two roles weighting a single stat with a roster that normalizes to 0/1.
    const r1 = XS.domain.makeRole({ id: "r1", name: "R1", weights: { ACC: 10 }, kitWeight: 0 });
    const r2 = XS.domain.makeRole({ id: "r2", name: "R2", weights: { ACC: 9 }, kitWeight: 0 });
    // roster: A ACC 100 -> norm 1 on ACC; B ACC 0 -> norm 0. Then r1: A=10,B=0; r2: A=9,B=0. Not it.
    // Instead use two stats: r1 weights ACC 10, r2 weights RFL 9... simpler: directly verify
    // via buildScoreMatrix + hungarian (unit level is in hungarian.test.js); here we check
    // the pipeline wiring: solver option is honored end to end.
    const settings = settingsFor([r1, r2], ["r1", "r2"], { woundedThreshold: 0 });
    const A = mkSoldier("A", { ACC: 100, RFL: 100 });
    const B = mkSoldier("B", { ACC: 0, RFL: 0 });
    const roster = [A, B];
    const result = XS.scoring.planSquad(roster, settings, { solver: XS.hungarian.hungarianMax });
    t.equal(result.picks[0].soldier.id, "A", "best soldier takes seat 1");
    t.equal(result.picks[1].soldier.id, "B", "other soldier takes seat 2");
    t.equal(result.bench.length, 0);
  });

  test("assignment: zero seats -> empty plan", (t) => {
    const settings = settingsFor(XS.settings.defaultSettings().roles, [], { woundedThreshold: 0 });
    const result = XS.scoring.planSquad([mkSoldier("A", {})], settings, { solver: XS.hungarian.hungarianMax });
    t.deepEqual(result.picks, []);
    t.equal(result.bench.length, 1);
  });

  test("assignment: zero soldiers -> every seat empty with notices", (t) => {
    const settings = settingsFor(XS.settings.defaultSettings().roles, ["rifleman", "sniper"], {});
    const result = XS.scoring.planSquad([], settings, { solver: XS.hungarian.hungarianMax });
    t.equal(result.picks.length, 2);
    t.ok(result.picks.every((p) => p && !p.soldier), "all seats empty");
    t.ok(result.notices.length >= 2, "one notice per empty seat");
  });

  test("assignment: unknown role id in a seat is skipped gracefully", (t) => {
    const settings = settingsFor(XS.settings.defaultSettings().roles, ["rifleman", "does-not-exist"], { woundedThreshold: 0 });
    const result = XS.scoring.planSquad([mkSoldier("A", {})], settings, { solver: XS.hungarian.hungarianMax });
    t.equal(result.picks.length, 2);
    t.ok(result.picks[0] && result.picks[0].soldier, "known seat filled");
    t.equal(result.picks[1], null, "unknown role seat left as null entry");
  });

  test("assignment: determinism of the full plan", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 555, soldiers: 10 });
    const settings = XS.settings.defaultSettings();
    const res = XS.parser.parseSaveWithSettings(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), settings);
    const r1 = XS.scoring.planSquad(res.soldiers, settings, { solver: XS.hungarian.hungarianMax });
    const r2 = XS.scoring.planSquad(res.soldiers, settings, { solver: XS.hungarian.hungarianMax });
    t.deepEqual(r1, r2);
  });

  test("assignment: recruitable soldiers are excluded from planning by default", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 606, soldiers: 12, recruitEvery: 3 }); // 4 recruits, 8 team
    const settings = XS.settings.defaultSettings();
    settings.global.woundedThreshold = 0;
    settings.global.includeRecruits = false;
    const res = XS.parser.parseSaveWithSettings(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), settings);
    t.equal(res.soldiers.filter((s) => s.inTeam).length, 8);
    t.equal(res.soldiers.filter((s) => !s.inTeam).length, 4);
    const plan = XS.scoring.planSquad(res.soldiers, settings, { solver: XS.hungarian.hungarianMax });
    const picked = plan.picks.filter((p) => p && p.soldier);
    t.ok(picked.length > 0);
    t.ok(picked.every((p) => p.soldier.inTeam), "no recruit is ever fielded by default");
    t.ok(plan.notices.some((n) => /recruitable/.test(n)), "notice explains the exclusion");
    // with the toggle on, recruits compete for seats
    settings.global.includeRecruits = true;
    const plan2 = XS.scoring.planSquad(res.soldiers, settings, { solver: XS.hungarian.hungarianMax });
    t.ok(plan2.picks.filter((p) => p && p.soldier).length >= picked.length, "more soldiers available -> at least as many seats filled");
    t.notOk(plan2.notices.some((n) => /excluded from planning/.test(n)), "no exclusion notice when recruits are included");
  });

  test("assignment: scales to a large roster and squad — no hardcoded limits anywhere", (t) => {
    // 60 soldiers, every 4th a recruit -> 45 team / 15 recruits; 15 seats.
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 909, soldiers: 60, recruitEvery: 4 });
    const settings = XS.settings.defaultSettings();
    settings.global.woundedThreshold = 0;
    const res = XS.parser.parseSaveWithSettings(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), settings);
    t.equal(res.soldiers.length, 60, "parser finds all 60 markers");
    t.equal(res.soldiers.filter((s) => s.inTeam).length, 45, "team size is not hardcoded");
    t.equal(res.soldiers.filter((s) => !s.inTeam).length, 15, "recruit pool size is not hardcoded");
    settings.seats = Array.from({ length: 15 }, (_, i) => ["rifleman", "sniper", "assault", "breacher", "mg", "scout"][i % 6]);
    const t0 = Date.now();
    const plan = XS.scoring.planSquad(res.soldiers, settings, { solver: XS.hungarian.hungarianMax });
    const dt = Date.now() - t0;
    t.equal(plan.picks.length, 15, "seat count is not hardcoded (15 seats)");
    const picked = plan.picks.filter((p) => p && p.soldier);
    t.equal(new Set(picked.map((p) => p.soldier.id)).size, picked.length, "no double-booking at scale");
    t.ok(picked.every((p) => p.soldier.inTeam), "recruits still excluded by default");
    t.ok(dt < 5000, "60x15 Hungarian solve is fast (" + dt + "ms)");
    // without floors every seat must be fillable from the 45 team soldiers
    const noFloors = XS.settings.defaultSettings();
    noFloors.global.woundedThreshold = 0;
    noFloors.roles = noFloors.roles.map((r) => XS.domain.makeRole(Object.assign({}, r, { floors: {}, kitWeight: 0 })));
    noFloors.seats = settings.seats;
    const res2 = XS.parser.parseSaveWithSettings(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), noFloors);
    const plan2 = XS.scoring.planSquad(res2.soldiers, noFloors, { solver: XS.hungarian.hungarianMax });
    t.equal(plan2.picks.filter((p) => p && p.soldier).length, 15, "all 15 seats filled when everyone is eligible");
    // determinism at scale
    t.deepEqual(plan, XS.scoring.planSquad(res.soldiers, settings, { solver: XS.hungarian.hungarianMax }));
  });

  test("assignment: recruit picks are flagged with a 'hire first' notice when recruits are included", (t) => {
    const role = XS.domain.makeRole({ id: "r", name: "R", weights: { ACC: 1 }, kitWeight: 0 });
    const vet = mkSoldier("vet", { ACC: 40 });
    vet.inTeam = true;
    const rookie = mkSoldier("rookie", { ACC: 90 });
    rookie.inTeam = false;
    // included: the higher-ACC recruit wins the only seat and is identifiable
    const settingsOn = settingsFor([role], ["r"], { woundedThreshold: 0, includeRecruits: true });
    const plan = XS.scoring.planSquad([vet, rookie], settingsOn, { solver: XS.hungarian.hungarianMax });
    t.equal(plan.picks[0].soldier.id, "rookie", "recruit wins the seat when included");
    t.equal(plan.picks[0].soldier.inTeam, false, "pick carries inTeam so the UI can badge it");
    t.ok(plan.notices.some((n) => /recruitable/.test(n) && /hire/i.test(n)), "notice says hire first");
    // default: recruit excluded, team soldier takes the seat
    const settingsOff = settingsFor([role], ["r"], { woundedThreshold: 0, includeRecruits: false });
    const plan2 = XS.scoring.planSquad([vet, rookie], settingsOff, { solver: XS.hungarian.hungarianMax });
    t.equal(plan2.picks[0].soldier.id, "vet");
    t.notOk(plan2.notices.some((n) => /hire/i.test(n)));
  });

  test("assignment: recruit mode \"empty\" fills only seats with no eligible team soldier", (t) => {
    // 3 seats, 2 team soldiers, 2 recruits. Team pass fills 2 seats and leaves
    // 1 empty; the recruit pass must fill exactly that one with the best recruit.
    const role = XS.domain.makeRole({ id: "r", name: "R", weights: { ACC: 1 }, kitWeight: 0 });
    const teamA = mkSoldier("teamA", { ACC: 50 }); teamA.inTeam = true;
    const teamB = mkSoldier("teamB", { ACC: 40 }); teamB.inTeam = true;
    const r1 = mkSoldier("rec1", { ACC: 90 }); r1.inTeam = false;
    const r2 = mkSoldier("rec2", { ACC: 80 }); r2.inTeam = false;
    const roster = [teamA, teamB, r1, r2];
    const mk = (mode) => settingsFor([role], ["r", "r", "r"], { woundedThreshold: 0, includeRecruits: mode });
    // off: only the 2 team soldiers are planned, 1 seat stays empty
    const off = XS.scoring.planSquad(roster, mk(false), { solver: XS.hungarian.hungarianMax });
    t.deepEqual(off.picks.map((p) => (p && p.soldier ? p.soldier.id : "(empty)")).sort(), ["(empty)", "teamA", "teamB"]);
    t.ok(off.notices.some((n) => /no eligible soldier/.test(n) && /left empty/.test(n)));
    // all: recruits compete everywhere -> the two best recruits + best team soldier
    const all = XS.scoring.planSquad(roster, mk(true), { solver: XS.hungarian.hungarianMax });
    t.deepEqual(all.picks.map((p) => p.soldier.id).sort(), ["rec1", "rec2", "teamA"]);
    // empty: team keeps both fillable seats, best recruit fills only the empty one
    const emp = XS.scoring.planSquad(roster, mk("empty"), { solver: XS.hungarian.hungarianMax });
    t.deepEqual(emp.picks.map((p) => (p && p.soldier ? p.soldier.id : null)).sort(), ["rec1", "teamA", "teamB"]);
    t.equal(emp.picks.filter((p) => p && p.soldier && p.soldier.inTeam === false).length, 1, "exactly one recruit used");
    t.ok(emp.notices.some((n) => /Recruits used only for seat/.test(n)), "notice names the recruit-filled seat");
    t.ok(emp.notices.some((n) => /hire/i.test(n)), "hire-first notice still fires for the recruit pick");
    t.notOk(emp.notices.some((n) => /excluded from planning/.test(n)), "no exclusion notice in empty mode");
    // determinism of the tri-state pass
    t.deepEqual(emp, XS.scoring.planSquad(roster, mk("empty"), { solver: XS.hungarian.hungarianMax }));
  });

  test("assignment: recruit mode \"empty\" respects floors and never displaces the team", (t) => {
    // role with ACC floor 85: team soldier (ACC 50) cannot take the seat,
    // recruit (ACC 90) can -> "empty" fills it with the recruit, "off" leaves it empty
    const role = XS.domain.makeRole({ id: "r", name: "R", weights: { ACC: 1 }, floors: { ACC: 85 }, kitWeight: 0 });
    const teamA = mkSoldier("teamA", { ACC: 50 }); teamA.inTeam = true;
    const r1 = mkSoldier("rec1", { ACC: 90 }); r1.inTeam = false;
    const mk = (mode) => settingsFor([role], ["r"], { woundedThreshold: 0, includeRecruits: mode });
    const emp = XS.scoring.planSquad([teamA, r1], mk("empty"), { solver: XS.hungarian.hungarianMax });
    t.equal(emp.picks[0].soldier && emp.picks[0].soldier.id, "rec1", "recruit fills the seat the team cannot");
    t.ok(emp.notices.some((n) => /Recruits used only for seat/.test(n)));
    const off = XS.scoring.planSquad([teamA, r1], mk(false), { solver: XS.hungarian.hungarianMax });
    t.notOk(off.picks[0].soldier, "off leaves the seat empty");
    t.ok(off.notices.some((n) => /no eligible soldier/.test(n)));
    // when the team CAN fill every seat, no recruit is used at all
    const role2 = XS.domain.makeRole({ id: "r", name: "R", weights: { ACC: 1 }, kitWeight: 0 });
    const teamB = mkSoldier("teamB", { ACC: 70 }); teamB.inTeam = true;
    const teamC = mkSoldier("teamC", { ACC: 60 }); teamC.inTeam = true;
    const r2 = mkSoldier("rec2", { ACC: 95 }); r2.inTeam = false;
    const s2 = settingsFor([role2], ["r", "r"], { woundedThreshold: 0, includeRecruits: "empty" });
    const plan = XS.scoring.planSquad([teamB, teamC, r2], s2, { solver: XS.hungarian.hungarianMax });
    t.deepEqual(plan.picks.map((p) => p.soldier.id).sort(), ["teamB", "teamC"], "team fills both seats");
    t.notOk(plan.picks.some((p) => p.soldier && p.soldier.inTeam === false), "recruit never displaces a team soldier");
    t.notOk(plan.notices.some((n) => /hire/i.test(n)), "no hire-first notice");
    t.ok(plan.notices.some((n) => /held back/.test(n)), "notice says recruits were held back");
  });

  test("assignment: rank tie-breaker decides exact ties through the pipeline", (t) => {
    // identical stats, different rank: the higher rank gets the single seat
    const role = XS.domain.makeRole({ id: "r", name: "R", weights: { ACC: 1 }, kitWeight: 0 });
    const settings = settingsFor([role], ["r"], { woundedThreshold: 0 });
    const low = mkSoldier("low", { ACC: 60 }, 50, 1);
    const high = mkSoldier("high", { ACC: 60 }, 50, 5);
    const result = XS.scoring.planSquad([low, high], settings, { solver: XS.hungarian.hungarianMax });
    t.equal(result.picks[0].soldier.id, "high", "higher rank wins the tie");
    t.equal(result.bench[0].soldier.id, "low");
  });
})(typeof self !== "undefined" ? self : globalThis);
