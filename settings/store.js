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
      /*
       * Calibration: which raw slot of a soldier block is which stat.
       * Default hypothesis (verified against the sample save's layout, but
       * adjustable in the Calibrate tab): slots 0..5 are TU, ACC, RFL, BRV,
       * STR, HP of the first copy; the padding float is current HP; rank is
       * not locatable and stays disabled.
       */
      calibration: {
        statSlots: { TU: 0, ACC: 1, RFL: 2, BRV: 3, STR: 4, HP: 5 },
        currentHP: { kind: "float" }, // or { kind: "slot", slot: n }
        rank: { kind: "none" }, // or { kind: "slot", slot: n } / { kind: "experience" }
      },
      /*
       * Global behavior parameters. New tunables added while implementing:
       * strCapacityFactor (capacity = STR x factor), psiBrvFloor (frontline
       * BRV floor while the psi era is on), trainingSeatIndex (-1 = first
       * seat). All editable in the Settings tab.
       */
      global: {
        woundedThreshold: 0.5, // HP fraction below which a soldier is ineligible
        encumbranceLimit: 0.8, // kit must stay at/below this fraction of capacity
        strCapacityFactor: 1.0, // carrying capacity = STR x this
        psiEra: false, // late-game psi threats on
        psiBrvFloor: 50, // BRV floor for frontline roles while psiEra is on
        trainingSeat: false, // reserve one seat for the lowest-composite soldier
        trainingSeatIndex: -1, // which seat (-1 = first seat)
      },
      roles: XS.domain.defaultRoles(),
      /* The seat builder: a role id per seat. Defaults to 8 seats. */
      seats: ["breacher", "breacher", "assault", "assault", "rifleman", "rifleman", "sniper", "mg"],
      templates: XS.domain.defaultTemplates(),
    };
  }

  /* Sections that have a per-section reset button in the Settings tab. */
  const SECTIONS = ["format", "calibration", "global", "roles", "templates", "seats"];

  /* Reset one section of a settings object to its built-in defaults. */
  function resetSection(settings, section) {
    if (SECTIONS.indexOf(section) === -1) return settings;
    const dflt = defaultSettings();
    settings[section] = dflt[section] && typeof dflt[section] === "object" ? JSON.parse(JSON.stringify(dflt[section])) : dflt[section];
    return settings;
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
    if (obj.calibration !== undefined) {
      if (!isPlainObject(obj.calibration)) errors.push("calibration must be an object");
      else if (!isPlainObject(obj.calibration.statSlots)) errors.push("calibration.statSlots must be an object");
    }
    if (obj.global !== undefined && !isPlainObject(obj.global)) errors.push("global must be an object");
    if (obj.roles !== undefined) {
      if (!Array.isArray(obj.roles)) errors.push("roles must be an array");
      else obj.roles.forEach((r, i) => { if (!isPlainObject(r) || typeof r.id !== "string" || typeof r.name !== "string") errors.push("roles[" + i + "] must have id and name strings"); });
    }
    if (obj.seats !== undefined && !Array.isArray(obj.seats)) errors.push("seats must be an array");
    if (obj.templates !== undefined) {
      if (!Array.isArray(obj.templates)) errors.push("templates must be an array");
      else obj.templates.forEach((tp, i) => { if (!isPlainObject(tp) || typeof tp.id !== "string" || !Array.isArray(tp.seats)) errors.push("templates[" + i + "] must have id and a seats array"); });
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
    SECTIONS,
    defaultSettings,
    resetSection,
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
