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
 *     bytes in; NOT current HP, verified), then anchored strings:
 *     "regiment.*", "experience.*", an optional transport-seat string
 *     ("Charlie - 1/13") or an empty string, a seat-index int (-1 = no seat),
 *     then the CURRENT HP as an int32 (it sits 9 bytes before the role
 *     string's content: seatIndex i32, currentHP i32, flag u8, roleLen,
 *     role; verified byte-level on three real saves, incl. one where a soldier
 *     reads 35 of max 50 while all others read full; recruits read 0 and are
 *     always at full HP in-game), then the in-game equipment role
 *     ("Rifleman", ...), "armour.*", and loadout strings ("weapon.*",
 *     "ammo.*", "weapon.grenade.*"). Soldiers in the ACTIVE TEAM always carry a
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
    hpFloatOffset: 40, // bytes after the stats where the one padding float sits (NOT current HP; verified) (4-aligned)
    // window after the stats scanned for anchored strings; wide (2048) because
    // the record repeats its loadout strings, and a too-small window truncates
    // the last string at the edge (verified on real saves)
    stringScanBytes: 2048,
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
    /*
     * CURRENT HP, verified on real saves: the int32 sitting 9 bytes before the
     * role string's content (layout: ... seat string, seatIndex i32,
     * currentHP i32, flag u8, roleLen i32, role ...). It is on the in-game HP
     * scale (includes the PVT->CPL +2 promotion bonus). Recruits' field reads
     * 0 there, and recruits are at full HP in-game anyway. We only accept a
     * plausible positive value; anything else means "not found" (null).
     */
    let intBeforeRole = null;
    if (bestRole && bestRole.index >= 9) {
      const p = windowStart + bestRole.index - 9;
      if (p >= 0 && p + 4 <= bytes.length) {
        const v = readInt32(view, p);
        if (Number.isFinite(v) && v > 0 && v < 100000) intBeforeRole = v;
      }
    }
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
      intBeforeRole, // current HP (verified), null when not found/plausible
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
        error: 'No "' + format.marker + '" marker found; this does not look like a Xenonauts save file. (We check the content, not the file extension.)',
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
    /*
     * Current HP: VERIFIED to be the int32 stored 9 bytes before the role
     * string (intBeforeRole, read in extractRecord) - it is on the in-game HP
     * scale, i.e. it includes the promotion bonus, so it divides cleanly by the
     * calibrated (bonus-adjusted) HP stat. The one float in the padding
     * (stats-end + hpFloatOffset) is a DIFFERENT field (it drifts by small
     * fractions between re-saves of the same game). Default kind is
     * "beforeRole"; "none" disables the wounded check with a notice, and
     * "float"/"slot" remain available (hidden Calibrate) for other layouts.
     */
    let currentHP = null;
    const chp = cal.currentHP || { kind: "beforeRole" };
    if (chp.kind === "float") currentHP = raw.hpFloat;
    else if (chp.kind === "beforeRole") currentHP = typeof raw.intBeforeRole === "number" ? raw.intBeforeRole : null;
    else if (chp.kind === "slot" && Number.isInteger(chp.slot) && chp.slot >= 0 && chp.slot < raw.statInts.length) currentHP = raw.statInts[chp.slot];
    let rank = 0;
    let rankKind = "none";
    const rk = cal.rank || { kind: "postInt", index: 0 };
    if (rk.kind === "slot" && Number.isInteger(rk.slot) && rk.slot >= 0 && rk.slot < raw.statInts.length) {
      rank = raw.statInts[rk.slot];
      rankKind = "slot";
    } else if (rk.kind === "experience") {
      const m = /(\d+)\s*$/.exec(raw.strings.experience || "");
      rank = m ? parseInt(m[1], 10) : 0;
      rankKind = "experience";
    } else if (rk.kind === "postInt" && Number.isInteger(rk.index) && raw.postInts && rk.index >= 0 && rk.index < raw.postInts.length) {
      // VERIFIED: postInts[0] is the soldier's rank points (gameconfig.xml
      // soldierRanks: PVT 0, CPL 3, SGT 9, LT 16, CPT 30, ...)
      rank = raw.postInts[rk.index];
      rankKind = "postInt";
    }
    /*
     * Promotion bonus: the first promotion (PVT -> CPL, i.e. rank points >= 3)
     * grants +2 to EVERY stat (Arqade/gameconfig). Verified against roster
     * screenshots: the in-game screen shows stat-int + 2 for CPL+ soldiers,
     * while the save's stat ints do NOT include the bonus. So we add it here to
     * make the app's numbers match the game. The bonus raises max HP as well;
     * the stored current-HP float is left as-is.
     * Tunable via calibration.promotionBonus (set bonus 0 to disable).
     */
    const pb = cal.promotionBonus;
    if (pb && typeof pb.bonus === "number" && typeof pb.rankPointsAtOrAbove === "number" && rank >= pb.rankPointsAtOrAbove) {
      for (const st of XS.domain.STATS) {
        if (typeof stats[st] === "number") stats[st] += pb.bonus;
      }
    }
    // the save stores each loadout string twice; keep the first occurrence only
    const seen = new Set();
    const loadout = (raw.strings.loadout || []).filter((v) => (seen.has(v) ? false : (seen.add(v), true)));
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
      armour: raw.strings.armour,
      loadout,
      raw: { statInts: raw.statInts, rawFloats: raw.rawFloats, hpFloat: raw.hpFloat, intBeforeRole: raw.intBeforeRole, postInts: raw.postInts, markerOffset: raw.markerOffset, rankKind },
    });
  }

  function isObj(v) {
    return v != null && typeof v === "object" && !Array.isArray(v);
  }

  /*
   * Load-time sanity thresholds (defaults; adjustable via settings.format.sanity).
   * WHAT/WHY: the marker scan finds soldier blocks in any file that contains
   * the marker, but a save from a DIFFERENT build (Xenonauts: Community
   * Edition without saveCompatibility, heavy mods) or a corrupted file can
   * have the same marker with different bytes after it. Parsing would then
   * "succeed" with garbage stats. So after parsing we check the result against
   * what real vanilla Xenonauts 1 data must look like, and return human-readable
   * anomaly strings the UI shows as a prominent warning: wrong numbers must
   * never appear silently.
   */
  const SANITY_DEFAULTS = {
    headerMagic: "onex", // 4-byte magic at file start (every real save inspected)
    headerVersion: 256, // int32 right after the magic (vanilla 1.06 writes 256)
    statMin: 0, // plausible range of one raw stat int (real stats are ~20..150)
    statMax: 500,
    rankMax: 10000, // rank points are small non-negative ints
    maxAnomalies: 8, // cap on the warning list; the rest are only counted
  };

  /*
   * sanityCheck(res, settings): validate a parseSaveWithSettings result.
   * Pure and defensive: never throws, even on fuzzed records; returns a list
   * of anomaly strings (empty = the save looks like a normal vanilla save).
   */
  function sanityCheck(res, settings) {
    if (!res || !res.ok) return [];
    const format = isObj(res.format) ? res.format : isObj(settings && settings.format) ? settings.format : {};
    const cal = isObj(settings && settings.calibration) ? settings.calibration : {};
    const san = Object.assign({}, SANITY_DEFAULTS, isObj(format.sanity) ? format.sanity : {});
    const cap = Number.isInteger(san.maxAnomalies) && san.maxAnomalies > 0 ? san.maxAnomalies : SANITY_DEFAULTS.maxAnomalies;
    const out = [];
    let overflow = 0;
    const add = (msg) => {
      if (out.length < cap) out.push(msg);
      else overflow++;
    };

    const header = res.header || {};
    if (typeof san.headerMagic === "string" && san.headerMagic.length > 0 && header.magic !== san.headerMagic) {
      add('Header magic is "' + String(header.magic) + '", but a vanilla Xenonauts 1 save starts with "' + san.headerMagic + '".');
    }
    if (Number.isFinite(san.headerVersion) && header.version != null && header.version !== san.headerVersion) {
      add("Header save-version int is " + header.version + "; vanilla Xenonauts 1 (build 1.06) writes " + san.headerVersion + ".");
    }
    if (Array.isArray(res.recordErrors) && res.recordErrors.length > 0) {
      add(res.recordErrors.length + " soldier block(s) could not be read at all (corrupt or truncated record).");
    }

    // per-soldier checks, aggregated so 22 bad blocks produce one line, not 22
    const slots = isObj(cal.statSlots) ? cal.statSlots : {};
    const soldiers = Array.isArray(res.soldiers) ? res.soldiers : [];
    let badStats = 0, statExample = "";
    let badRank = 0, rankExample = "";
    let nullRole = 0;
    let seatNoTeam = 0;
    let hpOverMax = 0, hpExample = "";
    for (const s of soldiers) {
      const raw = isObj(s.raw) ? s.raw : {};
      const ints = Array.isArray(raw.statInts) ? raw.statInts : [];
      for (const st of XS.domain.STATS) {
        const slot = slots[st];
        if (!Number.isInteger(slot) || slot < 0 || slot >= ints.length) continue;
        const v = ints[slot];
        if (typeof v !== "number" || !Number.isFinite(v) || v < san.statMin || v > san.statMax) {
          badStats++;
          if (!statExample) statExample = (s.name || "soldier") + " " + st + "=" + String(v);
        }
      }
      if (typeof s.rank === "number" && (!Number.isFinite(s.rank) || s.rank < 0 || s.rank > san.rankMax)) {
        badRank++;
        if (!rankExample) rankExample = (s.name || "soldier") + " rank points=" + String(s.rank);
      }
      if (s.equipmentRole == null) nullRole++;
      if (s.seat && s.inTeam === false) seatNoTeam++;
      // a located current HP above the (bonus-adjusted) max HP means the block
      // layout is not the vanilla one we verified
      if (typeof s.currentHP === "number" && typeof s.stats.HP === "number" && s.currentHP > s.stats.HP + 0.5) {
        hpOverMax++;
        if (!hpExample) hpExample = (s.name || "soldier") + " current " + s.currentHP + " > max " + s.stats.HP;
      }
    }
    if (badStats > 0) add(badStats + " stat value(s) outside the plausible range " + san.statMin + ".." + san.statMax + " (first: " + statExample + "); the stat block may be misaligned in this file.");
    if (badRank > 0) add(badRank + " rank point value(s) outside 0.." + san.rankMax + " (first: " + rankExample + ").");
    if (soldiers.length > 0 && nullRole === soldiers.length) add("No in-game equipment-role string was found in any soldier block (expected one of: " + (Array.isArray(format.roleNames) ? format.roleNames.join(", ") : "Rifleman, Assault, ...") + ").");
    if (seatNoTeam > 0) add(seatNoTeam + ' soldier(s) have a transport seat but no "' + (format.teamStringPrefix || "weapon.") + '" string (team detection is inconsistent in this file).');
    if (hpOverMax > 0) add(hpOverMax + " soldier(s) have a current HP above their max HP (first: " + hpExample + "); the block layout may differ in this file.");
    const prefix = typeof format.teamStringPrefix === "string" ? format.teamStringPrefix : "";
    if (prefix && soldiers.length > 0 && soldiers.every((s) => s.inTeam === false)) {
      add('No soldier block contains a "' + prefix + '" string, so active team and recruitment pool could not be told apart.');
    }
    // the overflow summary always fits, even when the list is at its cap
    if (overflow > 0) out.push("... and " + overflow + " more warning(s).");
    return out;
  }

  /*
   * Parse a save and calibrate every soldier with the site's settings.
   * Returns { ok, error, header, markerCount, soldiers, recordErrors, notices, anomalies }.
   * Notices flag domain fields we could not locate (e.g. rank), so the UI
   * can disable the dependent feature visibly instead of inventing values.
   * Anomalies are the load-time sanity warnings (see sanityCheck): a non-empty
   * list means the file may not be a vanilla Xenonauts 1 save.
   */
  function parseSaveWithSettings(buffer, settings) {
    const res = parseSave(buffer, settings.format);
    if (!res.ok) return res;
    const cal = settings.calibration || {};
    const notices = [];
    const rk = cal.rank || { kind: "postInt", index: 0 };
    if (rk.kind === "none") {
      notices.push("Rank mapping is disabled in settings, so the rank tie-breaker is off (all ranks count as equal).");
    }
    let missingHP = true;
    let hasRecruits = false;
    const chp = cal.currentHP || { kind: "beforeRole" };
    const soldiers = res.soldiers.map((raw) => {
      const s = calibrateSoldier(raw, cal);
      if (typeof s.currentHP === "number") missingHP = false;
      // recruits are at full HP in-game (verified on the recruit screen), so
      // their HP field is never used: they are never treated as wounded
      if (s.inTeam === false) {
        hasRecruits = true;
        if ((chp.kind === "float" || chp.kind === "beforeRole") && typeof s.currentHP === "number") s.currentHP = null;
      }
      return s;
    });
    if (chp.kind === "none") {
      notices.push("Current-HP mapping is disabled in settings, so the wounded check is off (everyone counts as healthy).");
    } else if (missingHP) {
      notices.push("No current-HP value was found in the soldier blocks, so the wounded check is skipped. Check the 'current HP' mapping in the Calibrate tab.");
    }
    if (hasRecruits && chp.kind !== "none") {
      notices.push("Recruitable soldiers are at full HP in-game, so they are never treated as wounded.");
    }
    const anomalies = sanityCheck(Object.assign({}, res, { soldiers }), settings);
    return Object.assign({}, res, { soldiers, notices, anomalies });
  }

  return {
    DEFAULT_FORMAT,
    ANCHOR_PREFIXES,
    SANITY_DEFAULTS,
    inspectSave,
    parseSave,
    calibrateSoldier,
    sanityCheck,
    parseSaveWithSettings,
    // exposed for tests and later milestones:
    _internals: { toBytes, ascii, isPrintable, readInt32, readFloat32, readString, readStringEndingAt, findAll, parseHeader, extractRecord },
  };
});
