/*
 * parser/saveParser.js — binary Xenonauts 1 save file inspection.
 *
 * WHY A MARKER SCAN
 * The .sav is the game engine's own binary serialization (not XML, not
 * compressed): 4-byte little-endian length + ASCII bytes for strings,
 * 4-byte LE int32, 4-byte LE IEEE-754 float, and FF FF FF FF for -1/null.
 * We deliberately do NOT decode the whole file — the format is positional and
 * game-version-specific. Instead we scan the raw bytes for the ASCII marker
 * "SoldierFlags", which occurs exactly once per soldier record. Everything
 * else in the file can shift around; the marker cannot.
 *
 * WHY PURE
 * This module only touches the ArrayBuffer it is given. No DOM, no
 * localStorage, no fetch — the save file never leaves the browser tab, and
 * Node can require() this file to unit-test the parser headlessly.
 *
 * All format parameters (marker string, stat count, scan windows, ...) are
 * passed in via the `format` argument and come from the site's settings, so a
 * game patch that shifts offsets never requires a code change.
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
    floatScanBytes: 96, // window after the stats scanned for a float (HP)
    stringScanBytes: 512, // window after the stats scanned for anchored strings
    roleNames: XS.domain ? XS.domain.EQUIPMENT_ROLES.slice() : [],
  };

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
    if (off + 4 > bytes.length) return null;
    const len = readInt32(view, off);
    if (len < 0 || len > 512 || off + 4 + len > bytes.length) return null;
    if (len > 0 && !isPrintable(bytes, off + 4, len)) return null;
    return { value: ascii(bytes.subarray(off + 4, off + 4 + len)), next: off + 4 + len };
  }

  /*
   * Read a length-prefixed string whose bytes END at offset `end`
   * (used to walk backwards from the marker to the name/nationality fields).
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
      };
    }
    return { ok: true, error: null, header, markerCount: markers.length, markers, format };
  }

  return {
    DEFAULT_FORMAT,
    inspectSave,
    // exposed for tests and later milestones:
    _internals: { toBytes, ascii, isPrintable, readInt32, readFloat32, readString, readStringEndingAt, findAll, parseHeader },
  };
});
