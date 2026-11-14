/*
 * domain/models.js — shared constants and plain-data factories for xenosquad-web.
 *
 * WHY THIS FILE EXISTS
 * The whole app passes around plain objects (Soldier, Role, SquadTemplate).
 * Keeping their shapes, the stat list, and the single version constant in one
 * pure module means parser, scoring and UI all agree on the same vocabulary,
 * and Node can require() this file headlessly (no DOM, no localStorage).
 *
 * Every file in this project uses the same tiny UMD-style wrapper so that:
 *   - in the browser it is loaded as a classic <script> and attaches to the
 *     global namespace window.XS (classic scripts also work when the page is
 *     opened directly from the filesystem via file://, where ES modules are
 *     blocked by CORS);
 *   - in Node it sets module.exports, so `node --test` can require() it.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  XS.domain = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (XS) {
  "use strict";

  /*
   * Single version constant. Bumped once per milestone; shown in the footer
   * and the Help tab so users can tell which build they are running.
   */
  const APP_VERSION = "0.8.0";

  /* Repository URL shown in the footer (a plain link — the app itself never
   * makes any network request). */
  const REPO_URL = "https://github.com/UnknownVibe23/xenosquad-web";

  /*
   * The six Xenonauts 1 soldier stats. Roles weight these; the Calibrate tab
   * maps raw save slots onto them. Order here is only the display/UI order.
   */
  const STATS = ["TU", "ACC", "RFL", "BRV", "STR", "HP"];

  const STAT_LABELS = {
    TU: "Time Units",
    ACC: "Accuracy",
    RFL: "Reflexes",
    BRV: "Bravery",
    STR: "Strength",
    HP: "Health",
  };

  /*
   * In-game equipment roles as they appear as strings inside a soldier block
   * ("Rifleman", "Heavy weapons", ...). Display hint only — squad selection
   * is purely stats-based via the Roles tab.
   */
  const EQUIPMENT_ROLES = [
    "Rifleman",
    "Assault",
    "Sniper",
    "Scout",
    "Shield",
    "Heavy weapons",
    "Rocketeer",
    "Specialist",
  ];

  function makeRole(init) {
    const role = {
      id: init.id || "role-" + Math.random().toString(36).slice(2, 9),
      name: init.name || "New role",
      weights: Object.assign({}, init.weights || {}),
      floors: Object.assign({}, init.floors || {}),
      kitWeight: typeof init.kitWeight === "number" ? init.kitWeight : 8,
      trains: Array.isArray(init.trains) ? init.trains.slice() : [],
      frontline: !!init.frontline,
      strengthTraining: !!init.strengthTraining,
    };
    return role;
  }

  function makeTemplate(init) {
    return {
      id: init.id || "template-" + Math.random().toString(36).slice(2, 9),
      name: init.name || "New template",
      seats: Array.isArray(init.seats) ? init.seats.slice() : [],
    };
  }

  function makeSoldier(init) {
    return {
      id: init.id,
      name: init.name || "?",
      nationality: init.nationality || "",
      portrait: init.portrait || "",
      stats: Object.assign({ TU: null, ACC: null, RFL: null, BRV: null, STR: null, HP: null }, init.stats || {}),
      currentHP: typeof init.currentHP === "number" ? init.currentHP : null,
      rank: typeof init.rank === "number" ? init.rank : 0,
      /* inTeam: false for soldiers that are only in the recruitment pool
       * (detected via the teamStringPrefix format setting, e.g. "weapon.*"). */
      inTeam: init.inTeam !== undefined ? !!init.inTeam : true,
      seat: init.seat || null, // transport seat string, e.g. "Charlie - 1/13"
      equipmentRole: init.equipmentRole || null,
      regiment: init.regiment || null,
      experience: init.experience || null,
      loadout: Array.isArray(init.loadout) ? init.loadout.slice() : [],
      raw: init.raw || null,
    };
  }

  /*
   * Seeded role doctrine (the user's own weights; everything is editable in
   * the Roles tab and stored in settings — these are only the fallback
   * defaults). weights: stat -> weight; floors: minimum raw stats; kitWeight:
   * approximate equipment weight for the encumbrance check; trains: stats the
   * seat trains (tie-breaker); frontline: subject to the BRV floor in the psi
   * era; strengthTraining: invert the encumbrance check to train STR.
   */
  function defaultRoles() {
    return [
      makeRole({ id: "rifleman", name: "Rifleman", weights: { ACC: 3, RFL: 2, TU: 2, BRV: 1 }, floors: {}, kitWeight: 8, trains: ["ACC", "RFL"], frontline: true }),
      makeRole({ id: "scout", name: "Scout", weights: { TU: 3, HP: 3, RFL: 2 }, floors: { TU: 55, HP: 50 }, kitWeight: 6, trains: ["TU", "HP"], frontline: true }),
      makeRole({ id: "sniper", name: "Sniper", weights: { ACC: 4, BRV: 2, TU: 1.5, RFL: 1.5 }, floors: { ACC: 55 }, kitWeight: 9, trains: ["ACC", "BRV"], frontline: false }),
      makeRole({ id: "mg", name: "MG", weights: { STR: 3, ACC: 2, TU: 2 }, floors: { STR: 55 }, kitWeight: 16, trains: ["STR", "ACC"], frontline: false }),
      makeRole({ id: "breacher", name: "Breacher", weights: { RFL: 3, HP: 3, TU: 2, STR: 2 }, floors: { HP: 55, RFL: 50 }, kitWeight: 18, trains: ["RFL", "HP"], frontline: true }),
      makeRole({ id: "assault", name: "Assault", weights: { TU: 3, HP: 2, ACC: 2, RFL: 1.5 }, floors: { TU: 55 }, kitWeight: 10, trains: ["TU", "HP"], frontline: true }),
      makeRole({ id: "rocketeer", name: "Rocketeer", weights: { STR: 3, ACC: 2.5, BRV: 1.5 }, floors: { ACC: 55, BRV: 50 }, kitWeight: 15, trains: ["STR", "BRV"], frontline: false }),
      makeRole({ id: "medic", name: "Medic", weights: { BRV: 2, TU: 2, STR: 1 }, floors: {}, kitWeight: 9, trains: ["BRV", "TU"], frontline: false }),
    ];
  }

  /*
   * Seeded mission templates (community consensus for Xenonauts 1). Data,
   * not code: stored in settings, editable in the template editor on the
   * Squad tab. No seeded template includes a medic seat — the community
   * distributes medkits across all soldiers; the medic role stays available
   * in the Roles tab and can be swapped into any template.
   */
  function defaultTemplates() {
    return [
      makeTemplate({ id: "crash-site", name: "Crash site", seats: ["breacher", "breacher", "assault", "assault", "rifleman", "rifleman", "sniper", "mg"] }),
      makeTemplate({ id: "ufo-landing", name: "UFO landing", seats: ["breacher", "breacher", "assault", "rifleman", "rifleman", "sniper", "sniper", "mg"] }),
      makeTemplate({ id: "terror-site", name: "Terror site", seats: ["breacher", "assault", "assault", "rifleman", "rifleman", "sniper", "mg", "rocketeer"] }),
      makeTemplate({ id: "alien-base", name: "Alien base assault", seats: ["breacher", "breacher", "assault", "assault", "rifleman", "rifleman", "sniper", "mg"] }),
      makeTemplate({ id: "base-defense", name: "Base defense", seats: ["breacher", "breacher", "assault", "assault", "rifleman", "rifleman", "rifleman", "mg"] }),
    ];
  }

  /* hpFraction: current HP as a fraction of the HP stat (max HP), or null. */
  function hpFraction(soldier) {
    const max = soldier.stats && soldier.stats.HP;
    if (typeof soldier.currentHP !== "number" || typeof max !== "number" || max <= 0) return null;
    return soldier.currentHP / max;
  }

  return {
    APP_VERSION,
    REPO_URL,
    STATS,
    STAT_LABELS,
    EQUIPMENT_ROLES,
    makeRole,
    makeTemplate,
    makeSoldier,
    defaultRoles,
    defaultTemplates,
    hpFraction,
  };
});
