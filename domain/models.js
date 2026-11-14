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
  const APP_VERSION = "0.2.0";

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
      equipmentRole: init.equipmentRole || null,
      regiment: init.regiment || null,
      experience: init.experience || null,
      loadout: Array.isArray(init.loadout) ? init.loadout.slice() : [],
      raw: init.raw || null,
    };
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
    hpFraction,
  };
});
