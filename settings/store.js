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
        hpFloatOffset: 40, // bytes after the stats where the one padding float sits (NOT current HP; verified)
        stringScanBytes: 2048, // window after the stats for anchored strings; wide enough that repeated loadout strings are not truncated at the edge
        teamStringPrefix: "weapon.", // block containing such a string = active team (recruits have armour only)
        roleNames: XS.domain.EQUIPMENT_ROLES.slice(),
        // load-time sanity thresholds used by parser.sanityCheck (a save that
        // fails them may not be a vanilla Xenonauts 1 save and gets a visible
        // warning); defaults live in the parser, mirrored here so they merge
        // and persist with the other format parameters
        sanity: XS.parser && XS.parser.SANITY_DEFAULTS ? JSON.parse(JSON.stringify(XS.parser.SANITY_DEFAULTS)) : { headerMagic: "onex", headerVersion: 256, statMin: 0, statMax: 500, rankMax: 10000, maxAnomalies: 8 },
      },
      /*
       * Calibration: which raw slot of a soldier block is which stat.
       * VERIFIED against in-game roster screenshots: slots 0..5 of the first
       * (current) copy are TU, HP, STR, ACC, RFL, BRV — note the save stores
       * HP in slot 1, not slot 5. The padding float is NOT current HP (verified
       * on a fresh-game save: everyone is at full HP in-game while the float
       * reads 22-35), so current HP defaults to "none" and the wounded check is
       * off. Rank points are postInts[0]; the PVT->CPL promotion bonus (+2 all
       * stats) is applied via promotionBonus. All adjustable in Calibrate.
       */
      calibration: {
        statSlots: { TU: 0, HP: 1, STR: 2, ACC: 3, RFL: 4, BRV: 5 },
        // VERIFIED on real saves (0.27.0): the int32 9 bytes before the role
        // string is the in-game current HP (includes the promotion bonus).
        // Recruits read 0 there and are always full HP in-game. The padding
        // float is a different field. Alternatives kept for other layouts:
        // { kind: "none" } disables the wounded check, { kind: "float" } /
        // { kind: "slot", slot: n } map another field (hidden Calibrate).
        currentHP: { kind: "beforeRole" },
        // rank POINTS live in postInts[0] (verified against roster screenshots;
        // rank POINTS live in postInts[0] (verified against roster screenshots;
        // gameconfig.xml soldierRanks thresholds)
        rank: { kind: "postInt", index: 0 }, // or { kind: "none" } / { kind: "slot", slot: n } / { kind: "experience" }
        // first promotion (PVT -> CPL, rank points >= 3) adds +2 to every stat
        // in-game but is NOT stored in the stat ints; the parser adds it here
        promotionBonus: { rankPointsAtOrAbove: 3, bonus: 2 },
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
        woundedThreshold: 0.75, // HP fraction below which a soldier is ineligible (veteran default: field only nearly-full soldiers)
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
      /*
       * Dismiss list (Soldiers tab): flag HIRED soldiers (active team) whose
       * composite stat score is below belowFraction x the team's median
       * composite. In vanilla Xenonauts 1 every soldier costs a flat
       * $10,000/month salary (Xenonauts wiki; not rank-dependent), so
       * soldierUpkeep is that flat upkeep. maxListed caps the list (0 = all).
       */
      dismiss: {
        belowFraction: 0.7, // flag in-team soldiers below 70% of the team median composite
        soldierUpkeep: 10000, // $/month per hired soldier (vanilla X1 flat salary, wiki)
        maxListed: 0, // 0 = no cap
      },
      roles: XS.domain.defaultRoles(),
      /* The seat builder: a role id per seat. Defaults to 8 seats. */
      seats: ["breacher", "breacher", "assault", "assault", "rifleman", "rifleman", "sniper", "mg"],
      templates: XS.domain.defaultTemplates(),
    };
  }

  /* Sections that have a per-section reset button in the Settings tab. */
  const SECTIONS = ["format", "calibration", "global", "dismiss", "roles", "templates", "seats"];

  /*
   * Version migrations. deepMerge keeps saved values for keys that exist in
   * the defaults - which is wrong for sections whose built-in defaults were
   * corrected/verified in a later version (0.23.0 located the rank field in
   * postInts[0] and added the PVT->CPL +2 promotion bonus; a settings blob
   * saved by 0.22.0 has calibration.rank = { kind: "none" } and would stick
   * forever, so the app would keep showing raw stats and PVT). MIGRATIONS maps
   * a version -> the sections reset to the NEW defaults when the saved/exported
   * version is older than that.
   */
  const MIGRATIONS = {
    "0.23.0": ["calibration"], // rank points located + promotion bonus added
    "0.25.0": ["calibration"], // wound check temporarily off (float thought to be HP)
    "0.27.0": ["calibration"], // current HP located (int before the role string); wound check on again
    "0.29.0": ["templates:append"], // new seeded 6+Hunter draft templates: append the missing ones, keep user edits/deletions of existing templates
  };

  /* Semver-ish compare: -1 / 0 / 1. Missing or non-numeric parts count as 0. */
  function compareVersions(a, b) {
    const pa = String(a == null ? "" : a).split(".").map((x) => parseInt(x, 10) || 0);
    const pb = String(b == null ? "" : b).split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  /* Reset migrated sections of a merged settings object to the new defaults.
   * A section named "<section>:append" (e.g. "templates:append") instead
   * APPENDS the built-in defaults whose id is not already present, so new
   * seeded entries reach upgrading users without clobbering their edits or
   * intentionally deleted entries. */
  function applyMigrations(settings, fromVersion) {
    for (const v of Object.keys(MIGRATIONS)) {
      if (compareVersions(fromVersion, v) < 0 && compareVersions(v, XS.domain.APP_VERSION) <= 0) {
        for (const sec of MIGRATIONS[v]) {
          if (sec.slice(-7) === ":append") {
            const key = sec.slice(0, -7);
            const dflt = defaultSettings()[key];
            if (Array.isArray(dflt) && Array.isArray(settings[key])) {
              const have = new Set(settings[key].map((x) => x && x.id));
              for (const item of dflt) if (!have.has(item.id)) settings[key].push(JSON.parse(JSON.stringify(item)));
            }
          } else {
            const dflt = defaultSettings()[sec];
            settings[sec] = dflt && typeof dflt === "object" ? JSON.parse(JSON.stringify(dflt)) : dflt;
          }
        }
      }
    }
    return settings;
  }

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

  /*
   * Hardening tables: every numeric/boolean global has an allowed range, so a
   * hostile or corrupted settings import can never inject weird types into the
   * pure logic modules. validateSettings (import path) rejects violations;
   * sanitizeSettings (localStorage path) coerces them back to defaults.
   */
  const GLOBAL_NUMS = {
    woundedThreshold: [0, 1],
    encumbranceLimit: [0, 1],
    strCapacityBase: [0, 1000],
    strCapacityCoef: [0, 100],
    strTrainThreshold: [0, 1],
    psiBrvFloor: [0, 200],
  };
  const GLOBAL_BOOLS = ["psiEra", "trainingSeat"];

  function sanitizeSettings(settings) {
    const d = defaultSettings();
    const g = isPlainObject(settings.global) ? settings.global : {};
    for (const k of Object.keys(GLOBAL_NUMS)) {
      const range = GLOBAL_NUMS[k];
      if (typeof g[k] !== "number" || !Number.isFinite(g[k]) || g[k] < range[0] || g[k] > range[1]) g[k] = d.global[k];
    }
    if (!Number.isInteger(g.trainingSeatIndex) || g.trainingSeatIndex < -1 || g.trainingSeatIndex > 10000) g.trainingSeatIndex = d.global.trainingSeatIndex;
    for (const k of GLOBAL_BOOLS) if (typeof g[k] !== "boolean") g[k] = d.global[k];
    if ([false, true, "empty"].indexOf(g.includeRecruits) === -1) g.includeRecruits = d.global.includeRecruits;
    settings.global = g;
    const dd = isPlainObject(settings.dismiss) ? settings.dismiss : {};
    if (typeof dd.belowFraction !== "number" || !Number.isFinite(dd.belowFraction) || dd.belowFraction < 0 || dd.belowFraction > 1) dd.belowFraction = d.dismiss.belowFraction;
    if (typeof dd.soldierUpkeep !== "number" || !Number.isFinite(dd.soldierUpkeep) || dd.soldierUpkeep < 0 || dd.soldierUpkeep > 1e9) dd.soldierUpkeep = d.dismiss.soldierUpkeep;
    if (!Number.isInteger(dd.maxListed) || dd.maxListed < 0 || dd.maxListed > 100000) dd.maxListed = d.dismiss.maxListed;
    settings.dismiss = dd;
    const f = isPlainObject(settings.format) ? settings.format : {};
    if (typeof f.marker !== "string" || f.marker.length === 0 || f.marker.length > 64) f.marker = d.format.marker;
    if (!Number.isInteger(f.statCount) || f.statCount < 0 || f.statCount > 64) f.statCount = d.format.statCount;
    if (!Number.isInteger(f.hpFloatOffset) || f.hpFloatOffset < 0 || f.hpFloatOffset > 4096) f.hpFloatOffset = d.format.hpFloatOffset;
    for (const k of ["floatScanBytes", "stringScanBytes"]) {
      if (!Number.isInteger(f[k]) || f[k] < 0 || f[k] > 1 << 20) f[k] = d.format[k];
    }
    if (typeof f.teamStringPrefix !== "string" || f.teamStringPrefix.length > 64) f.teamStringPrefix = d.format.teamStringPrefix;
    if (!Array.isArray(f.roleNames) || !f.roleNames.every((x) => typeof x === "string")) f.roleNames = d.format.roleNames;
    if (!isPlainObject(f.sanity)) f.sanity = d.format.sanity;
    else {
      if (typeof f.sanity.headerMagic !== "string" || f.sanity.headerMagic.length === 0 || f.sanity.headerMagic.length > 16) f.sanity.headerMagic = d.format.sanity.headerMagic;
      for (const k of ["headerVersion", "statMin", "statMax", "rankMax", "maxAnomalies"]) {
        if (typeof f.sanity[k] !== "number" || !Number.isFinite(f.sanity[k])) f.sanity[k] = d.format.sanity[k];
      }
    }
    settings.format = f;
    const c = isPlainObject(settings.calibration) ? settings.calibration : {};
    if (!isPlainObject(c.statSlots)) c.statSlots = d.calibration.statSlots;
    if (!isPlainObject(c.currentHP) || ["none", "float", "slot", "beforeRole"].indexOf(c.currentHP.kind) === -1) c.currentHP = d.calibration.currentHP;
    if (!isPlainObject(c.rank) || ["none", "slot", "experience", "postInt"].indexOf(c.rank.kind) === -1) c.rank = d.calibration.rank;
    if (!isPlainObject(c.promotionBonus) || typeof c.promotionBonus.bonus !== "number" || typeof c.promotionBonus.rankPointsAtOrAbove !== "number") c.promotionBonus = d.calibration.promotionBonus;
    settings.calibration = c;
    return settings;
  }

  /* Structural validation of a parsed settings object. Returns error list. */
  function validateSettings(obj) {
    const errors = [];
    if (!isPlainObject(obj)) return ["settings root must be an object"];
    if (!isPlainObject(obj.format)) errors.push("format must be an object");
    else {
      if (typeof obj.format.marker !== "string" || obj.format.marker.length === 0 || obj.format.marker.length > 64) errors.push("format.marker must be a non-empty string of at most 64 chars");
      if (!Number.isInteger(obj.format.statCount) || obj.format.statCount < 0 || obj.format.statCount > 64) errors.push("format.statCount must be an integer in 0..64");
      if (!Number.isInteger(obj.format.hpFloatOffset) || obj.format.hpFloatOffset < 0 || obj.format.hpFloatOffset > 4096) errors.push("format.hpFloatOffset must be an integer in 0..4096");
      for (const k of ["floatScanBytes", "stringScanBytes"]) {
        if (obj.format[k] !== undefined && (!Number.isInteger(obj.format[k]) || obj.format[k] < 0 || obj.format[k] > (1 << 20))) errors.push("format." + k + " must be an integer in 0.." + (1 << 20));
      }
      if (typeof obj.format.teamStringPrefix !== "string" || obj.format.teamStringPrefix.length > 64) errors.push("format.teamStringPrefix must be a string of at most 64 chars");
      if (obj.format.roleNames !== undefined && (!Array.isArray(obj.format.roleNames) || !obj.format.roleNames.every((x) => typeof x === "string"))) errors.push("format.roleNames must be an array of strings");
      if (obj.format.sanity !== undefined) {
        if (!isPlainObject(obj.format.sanity)) errors.push("format.sanity must be an object");
        else {
          if (obj.format.sanity.headerMagic !== undefined && (typeof obj.format.sanity.headerMagic !== "string" || obj.format.sanity.headerMagic.length === 0 || obj.format.sanity.headerMagic.length > 16)) errors.push("format.sanity.headerMagic must be a non-empty string of at most 16 chars");
          for (const k of ["headerVersion", "statMin", "statMax", "rankMax", "maxAnomalies"]) {
            if (obj.format.sanity[k] !== undefined && (typeof obj.format.sanity[k] !== "number" || !Number.isFinite(obj.format.sanity[k]))) errors.push("format.sanity." + k + " must be a finite number");
          }
        }
      }
    }
    if (obj.calibration !== undefined) {
      if (!isPlainObject(obj.calibration)) errors.push("calibration must be an object");
      else {
        if (!isPlainObject(obj.calibration.statSlots)) errors.push("calibration.statSlots must be an object");
        if (obj.calibration.currentHP !== undefined && (!isPlainObject(obj.calibration.currentHP) || ["none", "float", "slot", "beforeRole"].indexOf(obj.calibration.currentHP.kind) === -1)) errors.push('calibration.currentHP.kind must be "none", "float", "slot" or "beforeRole"');
        if (obj.calibration.rank !== undefined && (!isPlainObject(obj.calibration.rank) || ["none", "slot", "experience", "postInt"].indexOf(obj.calibration.rank.kind) === -1)) errors.push('calibration.rank.kind must be "none", "slot", "experience" or "postInt"');
        if (obj.calibration.promotionBonus !== undefined && (!isPlainObject(obj.calibration.promotionBonus) || typeof obj.calibration.promotionBonus.bonus !== "number" || typeof obj.calibration.promotionBonus.rankPointsAtOrAbove !== "number")) errors.push("calibration.promotionBonus needs numeric bonus and rankPointsAtOrAbove");
      }
    }
    if (obj.global !== undefined && !isPlainObject(obj.global)) errors.push("global must be an object");
    else if (obj.global !== undefined) {
      if (obj.global.includeRecruits !== undefined && [false, true, "empty"].indexOf(obj.global.includeRecruits) === -1) {
        errors.push('global.includeRecruits must be false, "empty" or true');
      }
      for (const k of Object.keys(GLOBAL_NUMS)) {
        if (obj.global[k] !== undefined) {
          const range = GLOBAL_NUMS[k];
          if (typeof obj.global[k] !== "number" || !Number.isFinite(obj.global[k]) || obj.global[k] < range[0] || obj.global[k] > range[1]) {
            errors.push("global." + k + " must be a number in [" + range[0] + ", " + range[1] + "]");
          }
        }
      }
      for (const k of GLOBAL_BOOLS) {
        if (obj.global[k] !== undefined && typeof obj.global[k] !== "boolean") errors.push("global." + k + " must be a boolean");
      }
      if (obj.global.trainingSeatIndex !== undefined && (!Number.isInteger(obj.global.trainingSeatIndex) || obj.global.trainingSeatIndex < -1 || obj.global.trainingSeatIndex > 10000)) {
        errors.push("global.trainingSeatIndex must be an integer in -1..10000");
      }
    }
    if (obj.dismiss !== undefined) {
      if (!isPlainObject(obj.dismiss)) errors.push("dismiss must be an object");
      else {
        if (obj.dismiss.belowFraction !== undefined && (typeof obj.dismiss.belowFraction !== "number" || !Number.isFinite(obj.dismiss.belowFraction) || obj.dismiss.belowFraction < 0 || obj.dismiss.belowFraction > 1)) errors.push("dismiss.belowFraction must be a number in [0, 1]");
        if (obj.dismiss.soldierUpkeep !== undefined && (typeof obj.dismiss.soldierUpkeep !== "number" || !Number.isFinite(obj.dismiss.soldierUpkeep) || obj.dismiss.soldierUpkeep < 0 || obj.dismiss.soldierUpkeep > 1e9)) errors.push("dismiss.soldierUpkeep must be a number in [0, 1e9]");
        if (obj.dismiss.maxListed !== undefined && (!Number.isInteger(obj.dismiss.maxListed) || obj.dismiss.maxListed < 0 || obj.dismiss.maxListed > 100000)) errors.push("dismiss.maxListed must be an integer in 0..100000");
      }
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
    // exports written by an older app version are migrated like stored settings
    return { ok: true, settings: applyMigrations(deepMerge(defaultSettings(), doc.settings), doc.version), errors: [] };
  }

  function loadSettings(storage) {
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      if (!raw) return sanitizeSettings(deepMerge(defaultSettings(), {}));
      const doc = JSON.parse(raw);
      // localStorage is user-writable, so corrupted values are sanitized
      // (coerced back to defaults) instead of trusted; settings saved by an
      // older app version get migrated first (see MIGRATIONS)
      const saved = isPlainObject(doc) && isPlainObject(doc.settings) ? doc.settings : doc;
      const merged = applyMigrations(deepMerge(defaultSettings(), saved), isPlainObject(doc) ? doc.version : undefined);
      return sanitizeSettings(merged);
    } catch (e) {
      return sanitizeSettings(deepMerge(defaultSettings(), {}));
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
    sanitizeSettings,
    compareVersions,
    applyMigrations,
    MIGRATIONS,
    validateSettings,
    mergeSettings,
    serialize,
    deserialize,
    loadSettings,
    saveSettings,
    clearNamespace,
  };
});
