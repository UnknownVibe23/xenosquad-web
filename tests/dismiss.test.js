/*
 * tests/dismiss.test.js - the dismiss list (hired soldiers not worth the
 * upkeep). Pure logic in XS.scoring.dismissList; thresholds in
 * settings.dismiss. All rosters are synthetic fixtures.
 */
(function (root) {
  "use strict";
  const { test } = root.XSTest;
  const XS = root.XS;

  function bufferOf(u8) {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  function rosterOf(opts) {
    const { bytes } = XS.fixture.buildFixtureSave(opts);
    const res = XS.parser.parseSaveWithSettings(bufferOf(bytes), XS.settings.defaultSettings());
    return res.soldiers;
  }

  test("dismiss: flags only in-team soldiers below the fraction of the team median composite; recruits never listed", (t) => {
    const soldiers = rosterOf({ seed: 301, soldiers: 12, recruitEvery: 3 });
    const settings = XS.settings.defaultSettings();
    const dl = XS.scoring.dismissList(soldiers, settings);
    t.equal(dl.teamSize, 8, "only the 8 hired soldiers count (12 - 4 recruits)");
    t.ok(dl.entries.length >= 0 && dl.entries.length < dl.teamSize, "list is a subset of the team");
    const bf = settings.dismiss.belowFraction;
    dl.entries.forEach((e) => {
      t.ok(e.soldier.inTeam !== false, "no recruits on the list: " + e.soldier.name);
      t.ok(e.composite < dl.threshold, e.soldier.name + " below threshold");
      t.ok(e.composite < bf * dl.median + 1e-12, "below " + bf + " of median");
      t.equal(e.upkeep, 10000, "vanilla flat upkeep carried through");
      t.ok(typeof e.rankLabel === "string" && e.rankLabel.length > 0);
    });
    // sorted worst-first
    for (let i = 1; i < dl.entries.length; i++) t.ok(dl.entries[i - 1].composite <= dl.entries[i].composite, "sorted ascending");
  });

  test("dismiss: threshold and cap are settings-driven; deterministic", (t) => {
    const soldiers = rosterOf({ seed: 302, soldiers: 10 });
    const s0 = XS.settings.defaultSettings();
    s0.dismiss.belowFraction = 0; // threshold 0 -> nobody below
    t.equal(XS.scoring.dismissList(soldiers, s0).entries.length, 0, "fraction 0 flags nobody");
    const s1 = XS.settings.defaultSettings();
    s1.dismiss.belowFraction = 1; // everyone strictly below the median flagged
    const dl1 = XS.scoring.dismissList(soldiers, s1);
    t.ok(dl1.entries.length >= 1 && dl1.entries.every((e) => e.composite < dl1.median), "fraction 1 flags all below-median");
    const sCap = XS.settings.defaultSettings();
    sCap.dismiss.belowFraction = 1; // flag everyone below the median first
    sCap.dismiss.maxListed = 2;
    const dlCap = XS.scoring.dismissList(soldiers, sCap);
    t.ok(dlCap.entries.length === 2, "maxListed caps the list (got " + dlCap.entries.length + ")");
    const a = XS.scoring.dismissList(soldiers, XS.settings.defaultSettings());
    const b = XS.scoring.dismissList(soldiers, XS.settings.defaultSettings());
    t.deepEqual(a, b, "same roster + same settings = same list (determinism)");
  });

  test("dismiss: empty roster and custom upkeep; wounded soldiers still listed with their HP fraction", (t) => {
    t.deepEqual(XS.scoring.dismissList([], XS.settings.defaultSettings()).entries, [], "empty roster");
    const soldiers = rosterOf({ seed: 303, soldiers: 8, woundEvery: 4 });
    const s = XS.settings.defaultSettings();
    s.dismiss.soldierUpkeep = 25000;
    s.dismiss.belowFraction = 1; // flag everyone below median
    const dl = XS.scoring.dismissList(soldiers, s);
    t.equal(dl.upkeep, 25000, "custom upkeep used");
    dl.entries.forEach((e) => t.equal(e.upkeep, 25000));
    const wounded = dl.entries.filter((e) => e.hpFraction != null && e.hpFraction < 0.75);
    t.ok(wounded.length >= 0, "wounded entries carry their hpFraction (shown in the UI)");
  });

  test("dismiss: settings defaults + validation/sanitization for the dismiss section", (t) => {
    const d = XS.settings.defaultSettings();
    t.deepEqual(d.dismiss, { belowFraction: 0.5, soldierUpkeep: 10000, maxListed: 0, hireFraction: 0.9, hireMaxListed: 5, hireCost: 10000 }, "defaults: dismiss below 50% of median, $10k/mo salary, hire at/above 90% of median capped at 5, $10k hire cost");
    t.ok(XS.settings.SECTIONS.indexOf("dismiss") !== -1, "dismiss is a resettable section");
    const bad = { dismiss: { belowFraction: 5, soldierUpkeep: -1, maxListed: -3, hireFraction: 99, hireMaxListed: -1, hireCost: "x" } };
    const errs = XS.settings.validateSettings(bad);
    t.ok(errs.some((e) => /dismiss\.belowFraction/.test(e)) && errs.some((e) => /dismiss\.soldierUpkeep/.test(e)) && errs.some((e) => /dismiss\.maxListed/.test(e)), "invalid dismiss values rejected on import");
    t.ok(errs.some((e) => /dismiss\.hireFraction/.test(e)) && errs.some((e) => /dismiss\.hireMaxListed/.test(e)) && errs.some((e) => /dismiss\.hireCost/.test(e)), "invalid hire values rejected on import");
    const s = XS.settings.defaultSettings();
    s.dismiss = { belowFraction: "lots", soldierUpkeep: null, maxListed: 1.5, hireFraction: -2, hireMaxListed: 0.5, hireCost: -1 };
    const san = XS.settings.sanitizeSettings(s);
    t.deepEqual(san.dismiss, d.dismiss, "corrupted dismiss section sanitized back to defaults");
  });

  test("hire: lists only recruits at/above the fraction of the team median, best first; costs carried; deterministic", (t) => {
    const soldiers = rosterOf({ seed: 311, soldiers: 12, recruitEvery: 3 }); // 8 team, 4 recruits
    const settings = XS.settings.defaultSettings();
    const hl = XS.scoring.hireList(soldiers, settings);
    t.equal(hl.recruitCount, 4, "recruit pool size");
    hl.entries.forEach((e) => {
      t.ok(e.soldier.inTeam === false, "only recruits listed: " + e.soldier.name);
      t.ok(e.composite >= hl.threshold - 1e-12, e.soldier.name + " at/above threshold");
      t.approx(hl.threshold, 0.9 * hl.median, 1e-9, "default hireFraction 0.9 of team median");
      t.equal(e.hireCost, 10000, "vanilla hire cost");
      t.equal(e.upkeep, 10000, "vanilla monthly salary");
      t.equal(e.hpFraction, null, "recruits: full HP in-game");
    });
    for (let i = 1; i < hl.entries.length; i++) t.ok(hl.entries[i - 1].composite >= hl.entries[i].composite, "sorted best-first");
    t.ok(hl.entries.length <= 5, "default cap 5 respected");
    const a = XS.scoring.hireList(soldiers, XS.settings.defaultSettings());
    const b = XS.scoring.hireList(soldiers, XS.settings.defaultSettings());
    t.deepEqual(a, b, "deterministic");
  });

  test("hire: threshold and cap are settings-driven; empty team/pool degrade gracefully", (t) => {
    const soldiers = rosterOf({ seed: 312, soldiers: 10, recruitEvery: 2 });
    const sLow = XS.settings.defaultSettings();
    sLow.dismiss.hireFraction = 0; // threshold 0 -> every recruit listed (up to cap)
    sLow.dismiss.hireMaxListed = 0; // no cap
    const all = XS.scoring.hireList(soldiers, sLow);
    t.equal(all.entries.length, all.recruitCount, "fraction 0 lists the whole pool");
    const sCap = XS.settings.defaultSettings();
    sCap.dismiss.hireFraction = 0;
    sCap.dismiss.hireMaxListed = 2;
    t.equal(XS.scoring.hireList(soldiers, sCap).entries.length, 2, "hireMaxListed caps the hire list");
    t.equal(XS.scoring.hireList([], XS.settings.defaultSettings()).entries.length, 0, "empty roster");
    const teamOnly = rosterOf({ seed: 313, soldiers: 6 }); // no recruits
    const hl = XS.scoring.hireList(teamOnly, XS.settings.defaultSettings());
    t.equal(hl.recruitCount, 0);
    t.equal(hl.entries.length, 0, "no recruits -> empty hire list");
  });
})(typeof self !== "undefined" ? self : globalThis);
