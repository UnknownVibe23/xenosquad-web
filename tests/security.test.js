/*
 * tests/security.test.js — redteam / robustness suite (hand-written, zero-dep).
 *
 * Covers:
 *  - parser fuzzing: random buffers, truncations, hostile field values
 *    (giant/negative string lengths, marker at the very end) — must never
 *    throw, never allocate wildly, always report a sane ok/error;
 *  - hostile settings imports: prototype-pollution keys, wrong types, out-of-
 *    range numbers — rejected by validation or sanitized on load;
 *  - source scans (Node only): no network sinks, no eval/new Function/
 *    document.write, no cookies, no innerHTML, CSP meta present, every local
 *    src/href referenced by index.html exists;
 *  - determinism + invariant fuzz: random fixtures x random settings, planned
 *    twice -> identical; no double-booking; floors respected; recruit modes;
 *  - solver fuzz: Hungarian vs brute-force optimality on many random matrices.
 */
(function (root) {
  "use strict";
  const { test } = root.XSTest;
  const XS = root.XS;

  function bufferOf(u8) {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  /* Deterministic PRNG so fuzz failures are reproducible. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Brute-force best assignment (test-only; never ships in production). */
  function bruteForceMax(matrix) {
    const n = matrix.length;
    let best = -Infinity;
    const perm = Array.from({ length: n }, (_, i) => i);
    const used = new Array(n).fill(false);
    (function rec(row, sum) {
      if (row === n) { if (sum > best) best = sum; return; }
      for (let col = 0; col < n; col++) {
        if (used[col]) continue;
        used[col] = true;
        rec(row + 1, sum + matrix[row][col]);
        used[col] = false;
      }
    })(0, 0);
    return best;
  }

  test("security: parser fuzz — random buffers never throw and report not-a-save", (t) => {
    const rnd = mulberry32(1234);
    for (let i = 0; i < 200; i++) {
      const len = Math.floor(rnd() * 512);
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j++) buf[j] = Math.floor(rnd() * 256);
      // sometimes embed a real marker to force the record path
      if (i % 3 === 0 && len > 32) {
        const m = Buffer.from("SoldierFlags", "ascii");
        buf.set(m, Math.floor(rnd() * (len - 12)));
      }
      const res = XS.parser.inspectSave(bufferOf(buf));
      t.ok(res && typeof res.ok === "boolean", "inspectSave returns a result for random buffer " + i);
      const full = XS.parser.parseSaveWithSettings(bufferOf(buf), XS.settings.defaultSettings());
      t.ok(full && typeof full.ok === "boolean", "parseSaveWithSettings never throws on random buffer " + i);
    }
  });

  test("security: fixture truncated at many offsets never throws", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 99, soldiers: 6, recruitEvery: 2 });
    const cuts = [0, 1, 8, 16, 40, 100, 500, 1000, bytes.length - 1, bytes.length];
    for (const cut of cuts) {
      const res = XS.parser.parseSaveWithSettings(bufferOf(bytes.subarray(0, cut)), XS.settings.defaultSettings());
      t.ok(res && typeof res.ok === "boolean", "truncated at " + cut + " ok");
    }
    // every prefix length in a sample range
    for (let cut = 0; cut < Math.min(bytes.length, 3000); cut += 137) {
      XS.parser.parseSaveWithSettings(bufferOf(bytes.subarray(0, cut)), XS.settings.defaultSettings());
    }
    t.ok(true, "no throw on any sampled truncation");
  });

  test("security: hostile field values inside a record (giant/negative lengths, marker at EOF)", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 7, soldiers: 3 });
    const b = Buffer.from(bytes);
    // 1) giant string length right after the first marker (short-nationality slot)
    const m = b.indexOf(Buffer.from("SoldierFlags", "ascii"));
    b.writeInt32LE(0x7fffffff, m + 12 + 1);
    let res = XS.parser.parseSaveWithSettings(bufferOf(new Uint8Array(b)), XS.settings.defaultSettings());
    t.ok(res.ok, "giant length: parse still ok");
    t.ok(res.soldiers.length + res.recordErrors.length <= res.markerCount, "no phantom soldiers");
    // 2) negative length
    b.writeInt32LE(-5, m + 12 + 1);
    res = XS.parser.parseSaveWithSettings(bufferOf(new Uint8Array(b)), XS.settings.defaultSettings());
    t.ok(res.ok, "negative length: parse still ok");
    // 3) marker as the very last bytes of the file
    const tail = Buffer.concat([Buffer.alloc(64, 1), Buffer.from("SoldierFlags", "ascii")]);
    res = XS.parser.parseSaveWithSettings(bufferOf(tail), XS.settings.defaultSettings());
    t.ok(res.ok && res.markerCount === 1, "marker at EOF handled");
    t.equal(res.soldiers.length + res.recordErrors.length, 1, "exactly one record attempted");
    // 4) huge statCount / offsets via format overrides are bounded by validation, but
    //    the parser itself must still not throw on absurd-but-valid params
    res = XS.parser.parseSave(bufferOf(bytes), { statCount: 64, hpFloatOffset: 4096, floatScanBytes: 100000, stringScanBytes: 100000 });
    t.ok(res.ok, "absurd format params do not throw");
  });

  test("security: hostile settings imports — prototype pollution, wrong types, ranges", (t) => {
    // __proto__ must never leak into merged settings or pollute Object.prototype
    const evil = '{"app":"xenosquad-web","settings":{"__proto__":{"polluted":true},"global":{"woundedThreshold":"high","psiEra":"yes","includeRecruits":"sometimes"},"format":{"marker":"","floatScanBytes":1e12},"roles":"nope"}}';
    const res = XS.settings.deserialize(evil);
    t.notOk(res.ok, "hostile import rejected");
    t.ok(res.errors.length > 0, "errors reported");
    t.equal(({}).polluted, undefined, "Object.prototype not polluted");
    const merged = XS.settings.mergeSettings(JSON.parse('{"global":{"woundedThreshold":"high"}}'));
    // mergeSettings validates; the bad value must not survive into behavior
    t.ok(merged.errors.some((e) => /woundedThreshold/.test(e)), "wrong-typed global reported");
    // loadSettings (localStorage path) sanitizes instead of crashing
    const st = {
      _m: new Map([["xenosquad-web.settings", '{"app":"xenosquad-web","settings":{"global":{"woundedThreshold":"high","includeRecruits":"everything"},"format":{"marker":123}}}']]),
      getItem(k) { return this._m.get(k) || null; }, setItem(k, v) { this._m.set(k, v); }, removeItem(k) { this._m.delete(k); }, key(i) { return Array.from(this._m.keys())[i] || null; }, get length() { return this._m.size; },
    };
    const loaded = XS.settings.loadSettings(st);
    t.equal(loaded.global.woundedThreshold, 0.75, "corrupted localStorage value sanitized to default");
    t.equal(loaded.global.includeRecruits, false, "invalid tri-state sanitized to off");
    t.equal(loaded.format.marker, "SoldierFlags", "corrupted marker sanitized");
    // valid export still round-trips through the sanitizer untouched
    const s = XS.settings.defaultSettings();
    s.global.woundedThreshold = 0.35;
    s.global.includeRecruits = "empty";
    const rt = XS.settings.deserialize(XS.settings.serialize(s));
    t.ok(rt.ok && rt.settings.global.woundedThreshold === 0.35 && rt.settings.global.includeRecruits === "empty", "valid values survive");
  });

  test("security: determinism + invariant fuzz over random fixtures and settings", (t) => {
    const rnd = mulberry32(20260614);
    for (let iter = 0; iter < 30; iter++) {
      const soldiers = 1 + Math.floor(rnd() * 40); // >=1: a 0-soldier fixture is not a save (no marker)
      const recruitEvery = [0, 2, 3, 5][Math.floor(rnd() * 4)];
      const { bytes } = XS.fixture.buildFixtureSave({ seed: 1000 + iter, soldiers, recruitEvery });
      const settings = XS.settings.defaultSettings();
      settings.global.woundedThreshold = [0, 0.25, 0.5, 0.75, 1][Math.floor(rnd() * 5)];
      settings.global.psiEra = rnd() < 0.5;
      settings.global.trainingSeat = rnd() < 0.5;
      settings.global.trainingSeatIndex = Math.floor(rnd() * 10) - 1;
      settings.global.includeRecruits = [false, "empty", true][Math.floor(rnd() * 3)];
      settings.seats = Array.from({ length: Math.floor(rnd() * 12) }, () => settings.roles[Math.floor(rnd() * settings.roles.length)].id);
      const res = XS.parser.parseSaveWithSettings(bufferOf(bytes), settings);
      const plan1 = XS.scoring.planSquad(res.soldiers, settings, { solver: XS.hungarian.hungarianMax });
      const plan2 = XS.scoring.planSquad(res.soldiers, settings, { solver: XS.hungarian.hungarianMax });
      t.deepEqual(plan1, plan2, "iter " + iter + ": deterministic");
      const picked = plan1.picks.filter((p) => p && p.soldier);
      t.equal(new Set(picked.map((p) => p.soldier.id)).size, picked.length, "iter " + iter + ": no double-booking");
      picked.forEach((p) => {
        const elig = XS.scoring.roleEligibility(p.soldier, p.role, settings);
        t.ok(elig.ok, "iter " + iter + ": pick passes role eligibility: " + elig.reasons.join(";"));
        if (settings.global.includeRecruits === false) t.ok(p.soldier.inTeam !== false, "iter " + iter + ": no recruit in off mode");
      });
      plan1.picks.forEach((p) => {
        if (p && !p.soldier) t.ok(p.why.length > 0, "iter " + iter + ": empty seat has a why");
      });
      // "empty" mode: recruits only on seats that are empty in off mode
      if (settings.global.includeRecruits === "empty") {
        const off = Object.assign({}, settings, { global: Object.assign({}, settings.global, { includeRecruits: false }) });
        const planOff = XS.scoring.planSquad(res.soldiers, off, { solver: XS.hungarian.hungarianMax });
        const offEmpty = new Set(planOff.picks.map((p, j) => (p && !p.soldier ? j : -1)).filter((j) => j >= 0));
        plan1.picks.forEach((p, j) => {
          if (p && p.soldier && p.soldier.inTeam === false) t.ok(offEmpty.has(j), "iter " + iter + ": recruit only on seat " + j + " that was empty for the team");
        });
      }
    }
  });

  test("security: hungarian vs brute force on 150 random matrices", (t) => {
    const rnd = mulberry32(777);
    for (let i = 0; i < 150; i++) {
      const n = 2 + Math.floor(rnd() * 4); // 2..5
      const m = [];
      for (let r = 0; r < n; r++) {
        const row = [];
        for (let c = 0; c < n; c++) row.push(Math.floor(rnd() * 1000) - 500);
        m.push(row);
      }
      const rowCol = XS.hungarian.hungarianMax(m);
      let sum = 0;
      for (let r = 0; r < n; r++) sum += m[r][rowCol[r]];
      const best = bruteForceMax(m);
      t.equal(sum, best, "matrix " + i + " optimal");
    }
  });

  test("security (node only): source scan — no network sinks, no eval, no cookies, no HTML sinks, CSP present, local refs exist", (t) => {
    if (typeof require !== "function" || typeof process === "undefined" || !process.versions || !process.versions.node) {
      t.ok(true, "skipped in browser (fs unavailable)");
      return;
    }
    const fs = require("fs");
    const path = require("path");
    const repo = path.join(__dirname, "..");
    const appFiles = ["index.html", "tests/tests.html"]
      .concat(["ui", "parser", "scoring", "domain", "settings", "tools"].flatMap((d) =>
        fs.readdirSync(path.join(repo, d)).filter((f) => f.endsWith(".js") || f.endsWith(".html")).map((f) => d + "/" + f)));
    const banned = [
      /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /EventSource/, /sendBeacon/,
      /document\.cookie/, /\beval\s*\(/, /new\s+Function/, /document\.write/, /innerHTML/, /outerHTML/, /insertAdjacentHTML/,
    ];
    appFiles.forEach((f) => {
      let text = fs.readFileSync(path.join(repo, f), "utf8");
      if (f.endsWith(".html")) text = text.replace(/<!--[\s\S]*?-->/g, ""); // scan markup, not comments
      banned.forEach((re) => t.notOk(re.test(text), f + " must not contain " + re));
      if (f.endsWith(".html")) {
        t.ok(/Content-Security-Policy/.test(text), f + " has CSP meta");
        t.ok(/connect-src 'none'/.test(text) && /script-src 'self'/.test(text), f + " CSP locks network + scripts");
        t.notOk(/type="module"/.test(text), f + " uses classic scripts (file:// works)");
      }
      // localStorage API may only be touched by the app shell (the store uses
      // injected storage); prose mentions in help text are fine
      if (/localStorage\s*[.\[]/.test(text) && f !== "ui/main.js") {
        t.ok(false, f + " touches the localStorage API (only ui/main.js may)");
      }
    });
    // every local src/href in index.html must exist on disk
    const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
    const refs = Array.from(html.matchAll(/(?:src|href)="([^"#]+)"/g)).map((m) => m[1]).filter((u) => !/^https?:/.test(u));
    refs.forEach((r) => t.ok(fs.existsSync(path.join(repo, r)), "index.html references existing file: " + r));
    // no em dashes in UI sources (guard from M17) + icons exist
    ["index.html"].concat(fs.readdirSync(path.join(repo, "ui")).filter((f) => f.endsWith(".js")).map((f) => "ui/" + f)).forEach((f) => {
      t.equal(fs.readFileSync(path.join(repo, f), "utf8").indexOf("—"), -1, f + " em-dash free");
    });
  });
})(typeof self !== "undefined" ? self : globalThis);
