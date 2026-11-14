/*
 * parser/saveParser.js — binary Xenonauts 1 save file parsing.
 *
 * WHY A MARKER SCAN
 * The .sav is the game engine's own binary serialization (not XML, not
 * compressed): 4-byte little-endian length + ASCII bytes for strings,
 * 4-byte LE int32, 4-byte LE IEEE-754 float, and FF FF FF FF for -1/null.
 * We deliberately do NOT decode the whole file — byte offsets elsewhere in
 * the file are positional and game-version-specific. Instead we scan the raw
 * bytes for the ASCII marker "SoldierFlags", which occurs exactly once per
 * soldier record, and read each record relative to its marker. Everything
 * else in the file can shift around; the marker cannot.
 *
 * RECORD LAYOUT (verified against a real planner.sav; all counts/strings are
 * format settings, never hardcoded):
 *   before the marker:  nationality string, full name string, portrait-type
 *     string, one small int (portrait index), then the length-prefixed marker
 *     itself.
 *   after the marker:   one byte, a short nationality string, then `statCount`
 *     int32 values (in the inspected saves: TWELVE ints = six stats, each
 *     appearing twice — first copy current, second copy base), a run of zero
 *     padding with one float among it (at stats-end + hpFloatOffset, i.e. 40
 *     bytes in; it is the current HP as a float), then anchored strings:
 *     "regiment.*", "experience.*", an optional transport-seat string
 *     ("Charlie - 1/13"), the in-game equipment role ("Rifleman", ...),
 *     "armour.*", and loadout strings ("weapon.*", "ammo.*",
 *     "weapon.grenade.*"). Soldiers in the ACTIVE TEAM always carry a
 *     "weapon.*" string; recruitment-pool soldiers have armour only — that
 *     prefix is the teamStringPrefix format setting.
 *   header:             4-byte magic "onex", int32 version, then strings:
 *     save name, in-game date, real-world timestamp.
 *
 * STAT SLOT ORDER, verified against in-game roster screenshots: the six
 * stats are stored as slot0=TU, slot1=HP, slot2=STR, slot3=ACC, slot4=RFL,
 * slot5=BRV (NOT the TU/ACC/RFL/BRV/STR/HP order one might assume).
 *
 * WHY PURE
 * This module only touches the ArrayBuffer it is given. No DOM, no
 * localStorage, no fetch — the save file never leaves the browser tab, and
 * Node can require() this file to unit-test the parser headlessly.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  XS.parser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (XS) {
  "use strict";

  const DEFAULT_FORMAT = {
    marker: "SoldierFlags", // ASCII marker scanned for in the raw bytes
    statCount: 12, // int32 values read after the short-nationality string
    floatScanBytes: 96, // fallback window scanned for a float if the offset read fails
    hpFloatOffset: 40, // bytes after the stats where the current-HP float sits (4-aligned)
    stringScanBytes: 512, // window after the stats scanned for anchored strings
    teamStringPrefix: "weapon.", // a block containing such a string = soldier is in the active team (recruits have armour only); "" disables the distinction
    roleNames: XS.domain ? XS.domain.EQUIPMENT_ROLES.slice() : [],
  };

  /* String prefixes anchored inside the post-stat region of a record. */
  const ANCHOR_PREFIXES = ["regiment.", "experience.", "armour.", "weapon.", "ammo."];

  function toBytes(buffer) {
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  function ascii(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function isPrintable(bytes, start, len) {
    for (let i = 0; i < len; i++) {
      const b = bytes[start + i];
      if (b < 32 || b > 126) return false;
    }
    return true;
  }

  function readInt32(view, off) {
    return view.getInt32(off, true);
  }

  function readFloat32(view, off) {
    return view.getFloat32(off, true);
  }

  /*
   * Read a length-prefixed string at `off`.
   * Returns { value, next } or null when the bytes cannot be a string
   * (implausible length or non-printable content) — this is what lets the
   * parser walk over unknown padding without knowing the exact layout.
   */
  function readString(view, bytes, off) {
    if (off < 0 || off + 4 > bytes.length) return null;
    const len = readInt32(view, off);
    if (len < 0 || len > 512 || off + 4 + len > bytes.length) return null;
    if (len > 0 && !isPrintable(bytes, off + 4, len)) return null;
    return { value: ascii(bytes.subarray(off + 4, off + 4 + len)), next: off + 4 + len };
  }

  /*
   * Read a length-prefixed string whose bytes END at offset `end`
   * (used to walk backwards from the marker to portrait/name/nationality).
   * Returns { value, start } or null.
   */
  function readStringEndingAt(view, bytes, end) {
    for (let len = 0; len <= 128; len++) {
      const start = end - 4 - len;
      if (start < 0) break;
      if (readInt32(view, start) !== len) continue;
      if (len > 0 && !isPrintable(bytes, start + 4, len)) continue;
      return { value: ascii(bytes.subarray(start + 4, start + 4 + len)), start };
    }
    return null;
  }

  /* Find every occurrence of `needle` (string) in `haystack` (Uint8Array). */
  function findAll(haystack, needle) {
    const n = new TextEncoder().encode(needle);
    const out = [];
    if (n.length === 0 || haystack.length < n.length) return out;
    outer: for (let i = 0; i <= haystack.length - n.length; i++) {
      for (let j = 0; j < n.length; j++) {
        if (haystack[i + j] !== n[j]) continue outer;
      }
      out.push(i);
    }
    return out;
  }

  /*
   * Parse the file header: magic (4 bytes), version int32, then the save name
   * and the in-game date as length-prefixed strings. Tolerant: if the strings
   * cannot be read we still report the magic/version and null fields.
   */
  function parseHeader(view, bytes) {
    const header = { magic: ascii(bytes.subarray(0, Math.min(4, bytes.length))), version: null, saveName: null, gameDate: null, realDate: null };
    if (bytes.length < 8) return header;
    header.version = readInt32(view, 4);
    let s = readString(view, bytes, 8);
    if (s) {
      header.saveName = s.value;
      s = readString(view, bytes, s.next);
      if (s) {
        header.gameDate = s.value;
        s = readString(view, bytes, s.next);
        if (s) header.realDate = s.value;
      }
    }
    return header;
  }

  /*
   * Try to read a length-prefixed string whose content starts at absolute
   * offset `abs`, where `windowText` is the decoded ASCII of the scan window
   * starting at `windowStart`. Validates that the 4 bytes before `abs` are
   * exactly the string length and the content is printable.
   */
  function tryReadAnchored(view, bytes, windowStart, windowText, idx) {
    const abs = windowStart + idx;
    if (abs < 4 || abs + 4 > bytes.length) return null;
    const len = readInt32(view, abs - 4);
    if (len < 0 || len > 512 || abs + len > bytes.length) return null;
    if (len === 0) return null;
    const s = windowText.substr(idx, len);
    if (!/^[ -~]+$/.test(s)) return null;
    return { value: s, index: idx };
  }

  /* Collect every valid anchored occurrence of `prefix` in the window. */
  function collectAnchored(view, bytes, windowStart, windowText, prefix) {
    const out = [];
    let idx = windowText.indexOf(prefix);
    while (idx !== -1) {
      const r = tryReadAnchored(view, bytes, windowStart, windowText, idx);
      if (r && r.value.indexOf(prefix) === 0) out.push(r);
      idx = windowText.indexOf(prefix, idx + 1);
    }
    return out;
  }

  /*
   * Extract one raw soldier record at marker offset `m`, bounded by `limit`
   * (the next marker or end of file) so the string scan never bleeds into the
   * next soldier. Never throws on odd bytes; returns what it could read.
   */
  function extractRecord(view, bytes, m, format, index, limit) {
    const markerLen = format.marker.length;

    // --- before the marker: portrait int, portrait string, name, nationality
    let portraitIndex = null;
    let portrait = null;
    let name = null;
    let nationality = null;
    if (m >= 8) {
      portraitIndex = readInt32(view, m - 8);
      const p = readStringEndingAt(view, bytes, m - 8);
      if (p) {
        portrait = p.value;
        const n = readStringEndingAt(view, bytes, p.start);
        if (n) {
          name = n.value;
          const g = readStringEndingAt(view, bytes, n.start);
          if (g) nationality = g.value;
        }
      }
    }

    // --- after the marker: flag byte, short nationality, stat ints, floats
    let off = m + markerLen;
    const flagByte = off < bytes.length ? bytes[off] : null;
    off += 1;
    let shortNationality = null;
    const sn = readString(view, bytes, off);
    if (sn) {
      shortNationality = sn.value;
      off = sn.next;
    }
    const statInts = [];
    for (let k = 0; k < format.statCount && off + 4 <= bytes.length; k++) {
      statInts.push(readInt32(view, off));
      off += 4;
    }
    /*
     * The current-HP float sits at a fixed aligned offset after the stats
     * (stats-end + hpFloatOffset; 40 bytes = ten zero ints in both inspected
     * saves). Reading the configured offset directly avoids mis-picking
     * stray floats elsewhere in the block; if that read is implausible we
     * fall back to the first plausible float in the scan window.
     */
    const rawFloats = [];
    const floatEnd = Math.min(bytes.length - 4, off + format.floatScanBytes);
    for (let k = 0; off + k <= floatEnd; k++) {
      const f = readFloat32(view, off + k);
      if (Number.isFinite(f) && f > 0.01 && f < 100000) rawFloats.push({ offset: off + k, value: f });
    }
    let hpFloat = null;
    const offHp = off + (Number.isInteger(format.hpFloatOffset) ? format.hpFloatOffset : 40);
    if (offHp + 4 <= bytes.length) {
      const f = readFloat32(view, offHp);
      if (Number.isFinite(f) && f > 0.01 && f < 100000) hpFloat = f;
    }
    if (hpFloat == null && rawFloats.length > 0) hpFloat = rawFloats[0].value;
    /*
     * The small ints between the stats and the float (and just after it) are
     * candidate fields for things like missions/kills/rank — not certainly
     * identified, so they are exposed raw (postInts) for the Calibrate tab
     * instead of being interpreted here.
     */
    const postInts = [];
    for (let k = 0; k < 12 && off + 4 * k + 4 <= bytes.length; k++) postInts.push(readInt32(view, off + 4 * k));

    // --- anchored strings in the window up to the next marker
    const windowStart = off;
    const windowEnd = Math.min(limit, off + format.stringScanBytes, bytes.length);
    const windowText = ascii(bytes.subarray(windowStart, windowEnd));

    const strings = { regiment: null, experience: null, role: null, armour: null, loadout: [], seat: null };
    const firstOf = (prefix) => {
      const all = collectAnchored(view, bytes, windowStart, windowText, prefix);
      return all.length > 0 ? all[0].value : null;
    };
    strings.regiment = firstOf("regiment.");
    strings.experience = firstOf("experience.");
    strings.armour = firstOf("armour.");
    // equipment role: earliest match among the known role names
    let bestRole = null;
    for (const roleName of format.roleNames || []) {
      const all = collectAnchored(view, bytes, windowStart, windowText, roleName);
      for (const r of all) {
        if (r.value === roleName && (!bestRole || r.index < bestRole.index)) bestRole = r;
      }
    }
    strings.role = bestRole ? bestRole.value : null;
    // loadout: every weapon.* / ammo.* string, in file order
    const loadout = [];
    for (const prefix of ["weapon.", "ammo."]) {
      for (const r of collectAnchored(view, bytes, windowStart, windowText, prefix)) loadout.push(r);
    }
    loadout.sort((a, b) => a.index - b.index);
    strings.loadout = loadout.map((r) => r.value);
    // best-effort transport seat string, e.g. "Charlie - 1/13" — searched only
    // in the first part of the window so post-block mission data cannot fake it
    const seatRegion = windowText.substr(0, 256);
    const seatMatch = seatRegion.match(/[A-Za-z][A-Za-z0-9 ._'-]{1,30} - \d+\/\d+/);
    if (seatMatch) {
      const r = tryReadAnchored(view, bytes, windowStart, windowText, seatMatch.index);
      if (r) strings.seat = r.value;
    }

    /*
     * Team membership: soldiers in the active team carry equipment, so their
     * block contains a string with teamStringPrefix ("weapon.*" by default);
     * recruitment-pool soldiers have armour only. An empty prefix disables
     * the distinction (everyone counts as in-team).
     */
    const prefix = typeof format.teamStringPrefix === "string" ? format.teamStringPrefix : "";
    const inTeam = prefix === "" ? true : collectAnchored(view, bytes, windowStart, windowText, prefix).length > 0;

    return {
      index,
      markerOffset: m,
      nationality,
      name,
      portrait,
      portraitIndex,
      shortNationality,
      flagByte,
      statInts,
      rawFloats,
      hpFloat,
      postInts,
      inTeam,
      strings,
    };
  }

  /*
   * Milestone-1 inspection pass: header + marker scan.
   * Returns { ok, error, header, markerCount, markers }.
   * ok === false with a readable error when no marker is found, i.e. the
   * file is not a Xenonauts save (we verify content, not extension).
   */
  function inspectSave(buffer, formatOverride) {
    const format = Object.assign({}, DEFAULT_FORMAT, formatOverride || {});
    const bytes = toBytes(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 16) {
      return { ok: false, error: "File is too small (" + bytes.length + " bytes) to be a Xenonauts save.", header: null, markerCount: 0, markers: [] };
    }
    const header = parseHeader(view, bytes);
    const markers = findAll(bytes, format.marker);
    if (markers.length === 0) {
      return {
        ok: false,
        error: 'No "' + format.marker + '" marker found — this does not look like a Xenonauts save file. (We check the content, not the file extension.)',
        header,
        markerCount: 0,
        markers: [],
        format,
      };
    }
    return { ok: true, error: null, header, markerCount: markers.length, markers, format };
  }

  /*
   * Full parse: header + marker scan + one raw record per marker.
   * A record that cannot be read is skipped with an entry in recordErrors —
   * the parser never throws on malformed bytes.
   */
  function parseSave(buffer, formatOverride) {
    const format = Object.assign({}, DEFAULT_FORMAT, formatOverride || {});
    const insp = inspectSave(buffer, format);
    if (!insp.ok) return insp;
    const bytes = toBytes(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const soldiers = [];
    const recordErrors = [];
    for (let i = 0; i < insp.markers.length; i++) {
      const m = insp.markers[i];
      const limit = i + 1 < insp.markers.length ? insp.markers[i + 1] : bytes.length;
      try {
        soldiers.push(extractRecord(view, bytes, m, format, i, limit));
      } catch (e) {
        recordErrors.push("soldier block #" + (i + 1) + " at offset " + m + " could not be read: " + (e && e.message ? e.message : String(e)));
      }
    }
    return Object.assign({}, insp, { soldiers, recordErrors });
  }

  /*
   * Apply the calibration mapping (raw slot -> stat) to one raw record,
   * producing a domain Soldier. The mapping lives in settings; nothing about
   * which slot is which stat is hardcoded here.
   *
   * Default hypothesis (user-adjustable in the Calibrate tab): slots 0..5 are
   * TU, ACC, RFL, BRV, STR, HP of the first (current) copy, and the float in
   * the padding is current HP against the HP stat as max HP.
   */
  function calibrateSoldier(raw, calibration) {
    const cal = calibration || {};
    const statSlots = cal.statSlots || {};
    const stats = {};
    for (const s of XS.domain.STATS) {
      const slot = statSlots[s];
      stats[s] = Number.isInteger(slot) && slot >= 0 && slot < raw.statInts.length ? raw.statInts[slot] : null;
    }
    let currentHP = null;
    const chp = cal.currentHP || { kind: "float" };
    if (chp.kind === "float") currentHP = raw.hpFloat;
    else if (chp.kind === "slot" && Number.isInteger(chp.slot) && chp.slot >= 0 && chp.slot < raw.statInts.length) currentHP = raw.statInts[chp.slot];
    let rank = 0;
    let rankKind = "none";
    const rk = cal.rank || { kind: "none" };
    if (rk.kind === "slot" && Number.isInteger(rk.slot) && rk.slot >= 0 && rk.slot < raw.statInts.length) {
      rank = raw.statInts[rk.slot];
      rankKind = "slot";
    } else if (rk.kind === "experience") {
      const m = /(\d+)\s*$/.exec(raw.strings.experience || "");
      rank = m ? parseInt(m[1], 10) : 0;
      rankKind = "experience";
    } else if (rk.kind === "postInt" && Number.isInteger(rk.index) && raw.postInts && rk.index >= 0 && rk.index < raw.postInts.length) {
      rank = raw.postInts[rk.index];
      rankKind = "postInt";
    }
    return XS.domain.makeSoldier({
      id: "soldier-" + raw.index,
      name: raw.name || "Soldier " + (raw.index + 1),
      nationality: raw.nationality || "",
      portrait: raw.portrait || "",
      stats,
      currentHP,
      rank,
      inTeam: raw.inTeam !== false,
      seat: raw.strings.seat || null,
      equipmentRole: raw.strings.role,
      regiment: raw.strings.regiment,
      experience: raw.strings.experience,
      loadout: raw.strings.loadout,
      raw: { statInts: raw.statInts, rawFloats: raw.rawFloats, hpFloat: raw.hpFloat, postInts: raw.postInts, markerOffset: raw.markerOffset, rankKind },
    });
  }

  /*
   * Parse a save and calibrate every soldier with the site's settings.
   * Returns { ok, error, header, markerCount, soldiers, recordErrors, notices }.
   * Notices flag domain fields we could not locate (e.g. rank), so the UI
   * can disable the dependent feature visibly instead of inventing values.
   */
  function parseSaveWithSettings(buffer, settings) {
    const res = parseSave(buffer, settings.format);
    if (!res.ok) return res;
    const cal = settings.calibration || {};
    const notices = [];
    const rk = cal.rank || { kind: "none" };
    if (rk.kind === "none") {
      notices.push("Rank could not be located in the soldier block, so the rank tie-breaker is disabled (all ranks count as equal).");
    }
    let missingHP = true;
    const soldiers = res.soldiers.map((raw) => {
      const s = calibrateSoldier(raw, cal);
      if (typeof s.currentHP === "number") missingHP = false;
      return s;
    });
    if (missingHP) notices.push("No current-HP value was found in the soldier blocks, so the wounded check is skipped. Check the 'current HP' mapping in the Calibrate tab.");
    return Object.assign({}, res, { soldiers, notices });
  }

  return {
    DEFAULT_FORMAT,
    ANCHOR_PREFIXES,
    inspectSave,
    parseSave,
    calibrateSoldier,
    parseSaveWithSettings,
    // exposed for tests and later milestones:
    _internals: { toBytes, ascii, isPrintable, readInt32, readFloat32, readString, readStringEndingAt, findAll, parseHeader, extractRecord },
  };
});
