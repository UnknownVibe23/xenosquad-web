/*
 * tests/sanity.test.js - load-time sanity check (parser.sanityCheck).
 *
 * A vanilla-shaped synthetic save must parse with ZERO anomalies; mutated or
 * foreign saves must produce visible, specific warnings (never silent wrong
 * numbers, never a crash). All input is synthetic (fixture generator), with
 * byte patches applied on top to simulate a different/corrupted layout.
 */
(function (root) {
  "use strict";
  const { test } = root.XSTest;
  const XS = root.XS;

  function bufferOf(u8) {
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  function parseWith(bytes, settings) {
    return XS.parser.parseSaveWithSettings(bufferOf(bytes), settings || XS.settings.defaultSettings());
  }

  /* Offset of the first stat int of soldier block 0 (marker + flag byte + short-nat string). */
  function firstStatOffset(bytes) {
    const res = XS.parser.parseSave(bufferOf(bytes));
    const m = res.soldiers[0].markerOffset;
    const view = new DataView(bufferOf(bytes));
    const sn = XS.parser._internals.readString(view, bytes, m + "SoldierFlags".length + 1);
    return sn.next;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test("sanity: a clean synthetic save passes with zero anomalies, deterministically", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 91, soldiers: 10, recruitEvery: 3, rankPoints: 9 });
    const res = parseWith(bytes);
    t.ok(res.ok);
    t.ok(Array.isArray(res.anomalies), "anomalies array is present on the result");
    t.deepEqual(res.anomalies, [], "clean vanilla-shaped fixture has no anomalies");
    const res2 = parseWith(bytes);
    t.deepEqual(res2.anomalies, res.anomalies, "same input -> same anomalies (determinism)");
  });

  test("sanity: out-of-range stat ints are flagged with the soldier and stat", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 92, soldiers: 6 });
    const patched = bytes.slice();
    const pv = new DataView(patched.buffer);
    pv.setInt32(firstStatOffset(patched), 999999, true); // soldier 0, slot 0 (TU)
    const res = parseWith(patched);
    t.ok(res.ok, "still parses");
    t.ok(res.anomalies.some((a) => /stat value/.test(a) && /range/.test(a)), "stat-range anomaly: " + res.anomalies.join(" | "));
    t.ok(res.anomalies.some((a) => /TU=999999/.test(a)), "example names the stat value");
  });

  test("sanity: wrong header magic and version are flagged", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 93, soldiers: 4 });
    const patched = bytes.slice();
    const pv = new DataView(patched.buffer);
    patched[0] = 88; patched[1] = 89; patched[2] = 90; patched[3] = 91; // "XYZ["
    pv.setInt32(4, 999, true); // header version
    const res = parseWith(patched);
    t.ok(res.anomalies.some((a) => /Header magic/.test(a)), "magic anomaly");
    t.ok(res.anomalies.some((a) => /save-version/.test(a) && /999/.test(a)), "version anomaly");
  });

  test("sanity: absurd rank points are flagged", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 94, soldiers: 5, rankPoints: 999999 });
    const res = parseWith(bytes);
    t.ok(res.anomalies.some((a) => /rank point/.test(a) && /999999/.test(a)), "rank anomaly: " + res.anomalies.join(" | "));
  });

  test("sanity: no role strings found anywhere is flagged", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 95, soldiers: 5 });
    const settings = XS.settings.defaultSettings();
    settings.format.roleNames = ["NoSuchRole"]; // parser then finds no role in any block
    const res = parseWith(bytes, settings);
    t.ok(res.anomalies.some((a) => /equipment-role string/.test(a)), "role anomaly: " + res.anomalies.join(" | "));
  });

  test("sanity: team prefix that matches nothing is flagged", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 96, soldiers: 6, recruitEvery: 2 });
    const settings = XS.settings.defaultSettings();
    settings.format.teamStringPrefix = "zzz.none";
    const res = parseWith(bytes, settings);
    t.ok(res.soldiers.every((s) => s.inTeam === false));
    t.ok(res.anomalies.some((a) => /could not be told apart/.test(a)), "team anomaly: " + res.anomalies.join(" | "));
  });

  test("sanity: thresholds are settings-driven (format.sanity), not hardcoded", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 97, soldiers: 8 }); // stats 35..70
    const clean = parseWith(bytes);
    t.deepEqual(clean.anomalies, [], "default thresholds accept the fixture");
    const strict = XS.settings.defaultSettings();
    strict.format.sanity = Object.assign({}, strict.format.sanity, { statMax: 40 });
    const res = parseWith(bytes, strict);
    t.ok(res.anomalies.some((a) => /stat value/.test(a)), "tighter statMax flags the same file");
  });

  test("sanity: warning list is capped and the overflow is counted", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 98, soldiers: 4, rankPoints: 999999 });
    const patched = bytes.slice();
    patched[0] = 88; // break magic too
    const pv = new DataView(patched.buffer);
    pv.setInt32(4, 999, true); // break version as well -> 3 anomaly kinds
    const settings = XS.settings.defaultSettings();
    settings.format.sanity = Object.assign({}, settings.format.sanity, { maxAnomalies: 2 });
    const res = parseWith(patched, settings);
    t.equal(res.anomalies.length, 3, "2 capped entries + 1 overflow line");
    t.ok(/more warning/.test(res.anomalies[res.anomalies.length - 1]), "last entry reports the overflow");
  });

  test("sanity: a current HP above max HP is flagged (block layout differs)", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 99, soldiers: 4 });
    const patched = bytes.slice();
    const view0 = new DataView(bufferOf(patched));
    const res0 = XS.parser.parseSave(bufferOf(patched));
    const m = res0.soldiers[0].markerOffset;
    const snLen = view0.getInt32(m + "SoldierFlags".length + 1, true);
    const winStart = m + "SoldierFlags".length + 1 + 4 + snLen + 12 * 4;
    const I = XS.parser._internals;
    const winText = I.ascii(patched.subarray(winStart, Math.min(patched.length, winStart + 2048)));
    const ridx = winText.indexOf(res0.soldiers[0].strings.role);
    t.ok(ridx >= 9, "role string found in the window");
    const pv = new DataView(patched.buffer);
    pv.setInt32(winStart + ridx - 9, 9999, true); // implausible current HP before the role string
    const res = parseWith(patched);
    t.ok(res.anomalies.some((a) => /current HP above/.test(a)), "hp-over-max anomaly: " + res.anomalies.join(" | "));
  });

  test("sanity: fuzzed buffers with a planted marker never throw and always return an array", (t) => {
    const rnd = mulberry32(4242);
    const marker = new TextEncoder().encode("SoldierFlags");
    for (let i = 0; i < 60; i++) {
      const len = 64 + Math.floor(rnd() * 512);
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j++) buf[j] = Math.floor(rnd() * 256);
      const at = Math.floor(rnd() * Math.max(1, len - marker.length));
      buf.set(marker, at);
      const res = parseWith(buf);
      t.ok(res.ok, "planted marker -> ok");
      t.ok(Array.isArray(res.anomalies), "anomalies is an array on fuzz buffer " + i);
    }
  });
})(typeof self !== "undefined" ? self : globalThis);
