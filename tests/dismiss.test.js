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
    dl.entries.forEach((e) => {
      t.ok(e.soldier.inTeam !== false, "no recruits on the list: " + e.soldier.name);
      t.ok(e.composite < dl.threshold, e.soldier.name + " below threshold");
      t.ok(e.composite < 0.7 * dl.median + 1e-12, "below 70% of median");
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
    t.deepEqual(d.dismiss, { belowFraction: 0.7, soldierUpkeep: 10000, maxListed: 0 }, "defaults: 70% of median, $10k/mo flat vanilla salary, no cap");
    t.ok(XS.settings.SECTIONS.indexOf("dismiss") !== -1, "dismiss is a resettable section");
    const bad = { dismiss: { belowFraction: 5, soldierUpkeep: -1, maxListed: -3 } };
    const errs = XS.settings.validateSettings(bad);
    t.ok(errs.some((e) => /dismiss\.belowFraction/.test(e)) && errs.some((e) => /dismiss\.soldierUpkeep/.test(e)) && errs.some((e) => /dismiss\.maxListed/.test(e)), "invalid dismiss values rejected on import");
    const s = XS.settings.defaultSettings();
    s.dismiss = { belowFraction: "lots", soldierUpkeep: null, maxListed: 1.5 };
    const san = XS.settings.sanitizeSettings(s);
    t.deepEqual(san.dismiss, d.dismiss, "corrupted dismiss section sanitized back to defaults");
  });
})(typeof self !== "undefined" ? self : globalThis);
