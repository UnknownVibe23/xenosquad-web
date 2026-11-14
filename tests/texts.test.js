/*
 * tests/texts.test.js — sanity guards for the user-facing texts.
 *
 * The app's texts must stay plain and consistent: no em dashes ("—") in any
 * string the user can see (labels, notices, "why" lines, version history),
 * and no em dash character at all in the UI sources (ui/*.js, index.html).
 * The file-scan part runs only under Node (it needs fs); in the browser the
 * runtime part still runs.
 */
(function (root) {
  "use strict";
  const { test } = root.XSTest;
  const XS = root.XS;

  test("texts: runtime strings (notices, why lines, version history, errors) contain no em dash", (t) => {
    const hasDash = (s) => typeof s === "string" && s.indexOf("—") !== -1;
    // version history is rendered in the Help tab
    XS.domain.VERSION_HISTORY.forEach((e) => {
      t.notOk(hasDash(e.version), "version " + e.version);
      t.notOk(hasDash(e.note), "note of " + e.version);
    });
    // parser notices + error paths on the synthetic fixture (with recruits)
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 71, soldiers: 8, recruitEvery: 4 });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const settings = XS.settings.defaultSettings();
    const res = XS.parser.parseSaveWithSettings(buf, settings);
    res.notices.forEach((n) => t.notOk(hasDash(n), "notice: " + n.slice(0, 40)));
    // sanity anomalies on a deliberately weird save (absurd rank points) must be em-dash-free too
    const wb = XS.fixture.buildFixtureSave({ seed: 72, soldiers: 5, rankPoints: 999999 }).bytes;
    const wbuf = wb.buffer.slice(wb.byteOffset, wb.byteOffset + wb.byteLength);
    const weird = XS.parser.parseSaveWithSettings(wbuf, settings);
    (weird.anomalies || []).forEach((a) => t.notOk(hasDash(a), "anomaly: " + a.slice(0, 40)));
    t.notOk(hasDash(XS.parser.inspectSave(new ArrayBuffer(8)).error), "small-file error");
    t.notOk(hasDash(XS.parser.inspectSave(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).buffer).error), "no-marker error");
    // planSquad notices + why lines in every recruit mode
    for (const mode of [false, "empty", true]) {
      const s = XS.settings.defaultSettings();
      s.global.woundedThreshold = 0;
      s.global.includeRecruits = mode;
      const plan = XS.scoring.planSquad(res.soldiers, s, { solver: XS.hungarian.hungarianMax });
      plan.notices.forEach((n) => t.notOk(hasDash(n), "plan notice (mode " + mode + "): " + n.slice(0, 40)));
      plan.picks.forEach((p) => {
        if (!p) return;
        p.why.forEach((w) => t.notOk(hasDash(w), "why line: " + w));
      });
      plan.ineligible.forEach((e) => e.reasons.forEach((r) => t.notOk(hasDash(r), "ineligible reason: " + r)));
    }
  });

  test("texts (node only): no em dash character anywhere in ui/*.js or index.html", (t) => {
    // browser run: nothing to scan (no fs), the runtime test above covers strings
    if (typeof require !== "function" || typeof process === "undefined" || !process.versions || !process.versions.node) {
      t.ok(true, "skipped in browser (fs unavailable)");
      return;
    }
    const fs = require("fs");
    const path = require("path");
    const repo = path.join(__dirname, "..");
    const files = ["index.html"].concat(fs.readdirSync(path.join(repo, "ui")).filter((f) => f.endsWith(".js")).map((f) => "ui/" + f));
    files.forEach((f) => {
      const text = fs.readFileSync(path.join(repo, f), "utf8");
      const idx = text.indexOf("—");
      t.equal(idx, -1, f + " contains an em dash at char " + idx);
    });
  });

  test("icons: every seeded role id has its extracted icon file (node only)", (t) => {
    t.equal(XS.domain.roleIcon("mg"), "assets/icons/mg.png", "roleIcon path shape");
    if (typeof require !== "function" || typeof process === "undefined" || !process.versions || !process.versions.node) {
      t.ok(true, "skipped in browser (fs unavailable)");
      return;
    }
    const fs = require("fs");
    const path = require("path");
    const repo = path.join(__dirname, "..");
    XS.domain.defaultRoles().forEach((r) => {
      const p = path.join(repo, XS.domain.roleIcon(r.id));
      t.ok(fs.existsSync(p), "icon file exists for role " + r.id + ": " + XS.domain.roleIcon(r.id));
    });
  });
})(typeof self !== "undefined" ? self : globalThis);
