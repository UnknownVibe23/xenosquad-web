/*
 * tests/settings.test.js — settings store tests: defaults, merge, validation,
 * export/import round-trip (export -> clear -> import -> identical behavior),
 * and namespaced localStorage persistence with a fake Storage (no DOM).
 */
(function (root) {
  "use strict";
  const { test } = root.XSTest;
  const XS = root.XS;

  /* Minimal Storage-like fake for Node (localStorage has the same shape). */
  function fakeStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      key: (i) => Array.from(m.keys())[i] || null,
      get length() {
        return m.size;
      },
      _map: m,
    };
  }

  test("settings: defaults have the expected shape", (t) => {
    const d = XS.settings.defaultSettings();
    t.equal(d.format.marker, "SoldierFlags");
    t.equal(d.format.statCount, 12);
    t.equal(d.format.hpFloatOffset, 40);
    t.equal(d.format.teamStringPrefix, "weapon.");
    t.deepEqual(d.calibration.statSlots, { TU: 0, HP: 1, STR: 2, ACC: 3, RFL: 4, BRV: 5 });
    t.equal(d.global.woundedThreshold, 0.5);
    t.equal(d.global.encumbranceLimit, 0.8);
    t.equal(d.global.psiEra, false);
    t.equal(d.global.trainingSeat, false);
    t.equal(d.global.includeRecruits, false);
    t.equal(d.roles.length, 8);
    t.equal(d.templates.length, 5);
    t.equal(d.seats.length, 8, "seat builder defaults to 8 seats");
    t.ok(d.roles.every((r) => r.id && r.name && r.weights));
  });

  test("settings: deepMerge fills missing keys from defaults, keeps saved values", (t) => {
    const d = XS.settings.defaultSettings();
    const merged = XS.settings.deepMerge(d, { global: { psiEra: true }, seats: ["sniper"] });
    t.equal(merged.global.psiEra, true, "saved value wins");
    t.equal(merged.global.woundedThreshold, 0.5, "missing key falls back to default");
    t.deepEqual(merged.seats, ["sniper"]);
    t.equal(merged.format.marker, "SoldierFlags");
  });

  test("settings: validation reports structural errors clearly", (t) => {
    t.ok(XS.settings.validateSettings(XS.settings.defaultSettings()).length === 0);
    const bad = XS.settings.validateSettings({ format: { marker: "", statCount: -3 }, roles: "nope" });
    t.ok(bad.some((e) => /marker/.test(e)));
    t.ok(bad.some((e) => /statCount/.test(e)));
    t.ok(bad.some((e) => /roles/.test(e)));
    t.ok(XS.settings.validateSettings(42).length > 0);
  });

  test("settings: export -> import round-trips to identical settings", (t) => {
    const s = XS.settings.defaultSettings();
    s.global.psiEra = true;
    s.global.woundedThreshold = 0.35;
    s.roles[0].weights.ACC = 4.5;
    s.roles.push(XS.domain.makeRole({ id: "custom", name: "Custom", weights: { TU: 5 } }));
    s.templates[0].seats = ["medic", "medic"];
    s.seats = ["sniper", "sniper", "sniper"];
    s.calibration.statSlots.ACC = 7;
    const json = XS.settings.serialize(s);
    const res = XS.settings.deserialize(json);
    t.ok(res.ok, "deserialize ok: " + res.errors.join(";"));
    t.deepEqual(res.settings, s, "imported settings are deep-equal to exported ones");
    // behavior-identical: planning with imported settings gives the same plan
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 77, soldiers: 9 });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const rosterA = XS.parser.parseSaveWithSettings(buf, s).soldiers;
    const rosterB = XS.parser.parseSaveWithSettings(buf, res.settings).soldiers;
    const planA = XS.scoring.planSquad(rosterA, s, { solver: XS.hungarian.hungarianMax });
    const planB = XS.scoring.planSquad(rosterB, res.settings, { solver: XS.hungarian.hungarianMax });
    t.deepEqual(planA, planB, "same behavior after export/import");
  });

  test("settings: import rejects bad input with clear errors", (t) => {
    t.notOk(XS.settings.deserialize("{not json").ok, "invalid JSON");
    t.notOk(XS.settings.deserialize(JSON.stringify({ hello: 1 })).ok, "missing app tag");
    t.notOk(XS.settings.deserialize(JSON.stringify({ app: "xenosquad-web" })).ok, "missing settings");
    t.notOk(XS.settings.deserialize(JSON.stringify({ app: "xenosquad-web", settings: { format: { marker: "" } } })).ok, "invalid marker");
    const errs = XS.settings.deserialize("nope").errors;
    t.ok(errs[0].indexOf("JSON") !== -1, "error mentions JSON: " + errs[0]);
  });

  test("settings: storage round-trip under the namespace prefix, roster never stored", (t) => {
    const st = fakeStorage();
    const s = XS.settings.defaultSettings();
    s.seats = ["medic"];
    XS.settings.saveSettings(st, s);
    t.ok(st._map.has("xenosquad-web.settings"), "stored under namespaced key");
    const loaded = XS.settings.loadSettings(st);
    t.deepEqual(loaded.seats, ["medic"]);
    t.equal(loaded.format.marker, "SoldierFlags", "missing fields get defaults");
    // corrupt stored JSON -> defaults, no crash
    st.setItem("xenosquad-web.settings", "{broken");
    const loaded2 = XS.settings.loadSettings(st);
    t.equal(loaded2.format.marker, "SoldierFlags");
    // nothing else is written by the app
    t.equal(st.length, 1, "exactly one key in the namespace");
  });

  test("settings: clearNamespace wipes only our prefix", (t) => {
    const st = fakeStorage();
    st.setItem("xenosquad-web.settings", "{}");
    st.setItem("xenosquad-web.other", "{}");
    st.setItem("other-app.key", "keep me");
    const removed = XS.settings.clearNamespace(st);
    t.equal(removed.length, 2);
    t.equal(st.getItem("other-app.key"), "keep me", "foreign keys untouched");
    t.equal(st.getItem("xenosquad-web.settings"), null);
  });

  test("settings: resetSection restores defaults for one section only", (t) => {
    const s = XS.settings.defaultSettings();
    s.global.psiEra = true;
    s.seats = ["sniper"];
    s.roles = [];
    XS.settings.resetSection(s, "global");
    t.equal(s.global.psiEra, false, "global reset");
    t.deepEqual(s.seats, ["sniper"], "seats untouched");
    t.equal(s.roles.length, 0, "roles untouched");
    XS.settings.resetSection(s, "roles");
    t.equal(s.roles.length, 8, "roles reset to the 8 seeded roles");
  });
})(typeof self !== "undefined" ? self : globalThis);
