/*
 * settings/store.js — the one settings object, its defaults, validation, and
 * localStorage persistence.
 *
 * WHY: every tunable in the app (format parameters, calibration mapping,
 * global behavior, roles, templates, seats) lives in a single settings object.
 * Code carries only the built-in fallback defaults in defaultSettings(); any
 * value changed through the UI changes behavior without touching code.
 *
 * PERSISTENCE RULES (privacy):
 *   - settings persist in localStorage under the namespaced prefix
 *     "xenosquad-web." — never in cookies;
 *   - the roster is NEVER persisted (soldier names are personal data);
 *   - storage is injected (any Storage-like object), so this module stays
 *     pure and testable in Node with a fake storage.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  XS.settings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (XS) {
  "use strict";

  const STORAGE_PREFIX = "xenosquad-web.";
  const SETTINGS_KEY = STORAGE_PREFIX + "settings";
  const EXPORT_APP_TAG = "xenosquad-web";

  /*
   * Built-in fallback defaults. Milestone 1 only needs the save-format
   * parameters (marker string, stat count, scan windows); roles, templates,
   * calibration and global behavior are added by later milestones and merged
   * here. Keep this the single source of default values.
   */
  function defaultSettings() {
    return {
      version: XS.domain.APP_VERSION,
      format: {
        marker: "SoldierFlags",
        statCount: 12,
        floatScanBytes: 96,
        stringScanBytes: 512,
        roleNames: XS.domain.EQUIPMENT_ROLES.slice(),
      },
    };
  }

  function isPlainObject(v) {
    return v != null && typeof v === "object" && !Array.isArray(v);
  }

  function deepMerge(defaults, saved) {
    if (Array.isArray(defaults)) {
      return Array.isArray(saved) ? saved.slice() : defaults.slice();
    }
    if (isPlainObject(defaults)) {
      const out = {};
      const src = isPlainObject(saved) ? saved : {};
      for (const key of Object.keys(defaults)) out[key] = deepMerge(defaults[key], src[key]);
      return out;
    }
    return saved === undefined ? defaults : saved;
  }

  /* Structural validation of a parsed settings object. Returns error list. */
  function validateSettings(obj) {
    const errors = [];
    if (!isPlainObject(obj)) return ["settings root must be an object"];
    if (!isPlainObject(obj.format)) errors.push("format must be an object");
    else {
      if (typeof obj.format.marker !== "string" || obj.format.marker.length === 0) errors.push("format.marker must be a non-empty string");
      if (!Number.isInteger(obj.format.statCount) || obj.format.statCount < 0 || obj.format.statCount > 64) errors.push("format.statCount must be an integer in 0..64");
    }
    return errors;
  }

  /* Merge a (possibly partial or invalid) saved object over the defaults. */
  function mergeSettings(saved) {
    const errors = validateSettings(saved || {});
    return { settings: deepMerge(defaultSettings(), isPlainObject(saved) ? saved : {}), errors };
  }

  /* Serialize for the Export button — a self-describing JSON document. */
  function serialize(settings) {
    return JSON.stringify({ app: EXPORT_APP_TAG, exportedAt: new Date().toISOString(), version: XS.domain.APP_VERSION, settings }, null, 2);
  }

  /*
   * Parse + validate an imported JSON document. Returns { ok, settings, errors }.
   * Unknown/missing fields fall back to defaults so exports stay portable
   * across versions; hard structural errors are reported clearly.
   */
  function deserialize(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      return { ok: false, errors: ["Not valid JSON: " + e.message] };
    }
    if (!isPlainObject(doc)) return { ok: false, errors: ["Imported file must contain a JSON object"] };
    if (doc.app !== EXPORT_APP_TAG) return { ok: false, errors: ['Not a xenosquad-web settings export (missing app tag "' + EXPORT_APP_TAG + '")'] };
    if (!isPlainObject(doc.settings)) return { ok: false, errors: ["Export is missing the settings object"] };
    const errors = validateSettings(doc.settings);
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, settings: deepMerge(defaultSettings(), doc.settings), errors: [] };
  }

  function loadSettings(storage) {
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      if (!raw) return deepMerge(defaultSettings(), {});
      const doc = JSON.parse(raw);
      return deepMerge(defaultSettings(), isPlainObject(doc) && isPlainObject(doc.settings) ? doc.settings : doc);
    } catch (e) {
      return deepMerge(defaultSettings(), {});
    }
  }

  function saveSettings(storage, settings) {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ app: EXPORT_APP_TAG, version: XS.domain.APP_VERSION, settings }));
  }

  /* Wipe every key under our namespace ("Clear all my data"). */
  function clearNamespace(storage) {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.indexOf(STORAGE_PREFIX) === 0) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
    return keys;
  }

  return {
    STORAGE_PREFIX,
    SETTINGS_KEY,
    defaultSettings,
    deepMerge,
    validateSettings,
    mergeSettings,
    serialize,
    deserialize,
    loadSettings,
    saveSettings,
    clearNamespace,
  };
});
