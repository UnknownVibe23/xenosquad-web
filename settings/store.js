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
        hpFloatOffset: 40, // bytes after the stats where the current-HP float sits
        stringScanBytes: 2048, // window after the stats for anchored strings; wide enough that repeated loadout strings are not truncated at the edge
        teamStringPrefix: "weapon.", // block containing such a string = active team (recruits have armour only)
        // recruits are at full HP in-game; the HP-offset float in their block is a different field (verified) — keep false
        recruitHpIsFloat: false,
        roleNames: XS.domain.EQUIPMENT_ROLES.slice(),
      },
      /*
       * Calibration: which raw slot of a soldier block is which stat.
       * VERIFIED against in-game roster screenshots: slots 0..5 of the first
       * (current) copy are TU, HP, STR, ACC, RFL, BRV — note the save stores
       * HP in slot 1, not slot 5. The padding float is current HP. Rank is
       * still not locatable and stays disabled. All adjustable in Calibrate.
       */
      calibration: {
        statSlots: { TU: 0, HP: 1, STR: 2, ACC: 3, RFL: 4, BRV: 5 },
        currentHP: { kind: "float" }, // or { kind: "slot", slot: n }
        rank: { kind: "none" }, // or { kind: "slot", slot: n } / { kind: "experience" }
      },
      /*
       * Global behavior parameters. Carrying capacity follows the game's own
       * gameconfig.xml: capacity(kg) = strCapacityBase + strCapacityCoef x STR.
       * The TU penalty starts above encumbranceLimit x capacity (1.0 = only
       * when over full capacity); STR *trains* at >= strTrainThreshold x
       * capacity (0.8 in the game files), which is what strength_training
       * roles invert to. Also: psiBrvFloor (frontline BRV floor while the psi
       * era is on), trainingSeatIndex (-1 = first seat), includeRecruits
       * (tri-state: false / "empty" / true).
       * All editable in the Settings tab.
       */
      global: {
        woundedThreshold: 0.5, // HP fraction below which a soldier is ineligible
        encumbranceLimit: 1.0, // kit must stay at/below this fraction of capacity to avoid the TU penalty
        strCapacityBase: 8, // kg; capacity = strCapacityBase + strCapacityCoef x STR
        strCapacityCoef: 0.3, // kg per STR point (gameconfig.xml: 8kg + 0.3kg * strength)
        strTrainThreshold: 0.8, // fraction of capacity at/above which moving trains STR (strength_training inverts to require this)
        psiEra: false, // late-game psi threats on
        psiBrvFloor: 50, // BRV floor for frontline roles while psiEra is on
        trainingSeat: false, // reserve one seat for the lowest-composite soldier
        trainingSeatIndex: -1, // which seat (-1 = first seat)
        includeRecruits: false, // tri-state: false = active team only (default); "empty" = recruits fill only seats no team soldier can fill; true = recruits compete for all seats
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
      if (!Number.isInteger(obj.format.hpFloatOffset) || obj.format.hpFloatOffset < 0 || obj.format.hpFloatOffset > 4096) errors.push("format.hpFloatOffset must be an integer in 0..4096");
      if (typeof obj.format.teamStringPrefix !== "string") errors.push("format.teamStringPrefix must be a string");
      if (obj.format.recruitHpIsFloat !== undefined && typeof obj.format.recruitHpIsFloat !== "boolean") errors.push("format.recruitHpIsFloat must be a boolean");
    }
    if (obj.calibration !== undefined) {
      if (!isPlainObject(obj.calibration)) errors.push("calibration must be an object");
      else if (!isPlainObject(obj.calibration.statSlots)) errors.push("calibration.statSlots must be an object");
    }
    if (obj.global !== undefined && !isPlainObject(obj.global)) errors.push("global must be an object");
    else if (obj.global !== undefined && obj.global.includeRecruits !== undefined && [false, true, "empty"].indexOf(obj.global.includeRecruits) === -1) {
      errors.push('global.includeRecruits must be false, "empty" or true');
    }
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
