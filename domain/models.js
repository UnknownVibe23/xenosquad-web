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
  const APP_VERSION = "0.16.0";

  /*
   * Changelog, newest first. Rendered as a table at the bottom of the Help
   * tab; keep each note to one line. APP_VERSION must match the first entry.
   */
  const VERSION_HISTORY = [
    { version: "0.16.0", note: "Soldiers tab: explicit status column (red = wounded, with the threshold shown); recruits are never marked wounded — in-game they are at full HP, and the float in their save block is a different field, now treated as unknown. Slimmer Help tab with this version history. Mission-template cards: tidier spacing + seat count." },
    { version: "0.15.0", note: "Recruits mode is tri-state: off (default) / fill only empty seats / all seats. Recruit picks still get the \"hire first\" badge." },
    { version: "0.14.0", note: "Official in-game class names (Rifleman, Assault, Sniper, Scout, Shield, Heavy weapons, Rocketeer, Specialist); template editor with per-role +/- counters; seat builder with quick-add buttons and chips; new title \"Xeno Squad\"." },
    { version: "0.13.0", note: "Calibrate tab and save-format UI hidden (the GOG build is final; code kept, re-enable documented in README). Settings grouped; roster table layout fixed." },
    { version: "0.12.0", note: "Meta-aligned role weights; game-accurate encumbrance (capacity = 8 + 0.3 x STR kg, TU penalty above the limit, STR trains past 80%)." },
    { version: "0.11.0", note: "Recruits picked for a squad are marked \"recruit — hire first\"." },
    { version: "0.10.0", note: "Roles editor: one column per stat (name, value box, slider)." },
    { version: "0.9.0", note: "Calibration verified against real saves; settings groups; roster table polish." },
    { version: "0.8.0", note: "\"Plan squad\" button jumps to the result; result header shows seats filled; tagline removed." },
    { version: "0.7.0", note: "Fixed missing script tags (crash on load); 60-soldier scale test; platform-neutral save-location docs." },
    { version: "0.6.0", note: "Team vs recruit detection (weapon.* string); recruits excluded from planning by default; verified stat order TU,HP,STR,ACC,RFL,BRV and current-HP float." },
    { version: "0.5.0", note: "Full adjustability: Roles/Settings editors, templates, persistence, export/import, resets, Clear all my data, CSP, Help tab, responsive layout." },
    { version: "0.4.0", note: "Hand-written Hungarian (Kuhn-Munkres) solver replaces greedy; per-pick \"why\" lines; bench; brute-force optimality tests." },
    { version: "0.3.0", note: "Scoring core: exclusions, normalization, weighted role scores, provisional greedy assignment." },
    { version: "0.2.0", note: "Binary save parser (marker scan, record extraction), Calibrate tab, synthetic fixture generator, first tests." },
    { version: "0.1.0", note: "Static skeleton: tabs, drag-and-drop, save inspector; deployable to GitHub Pages." },
  ];

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
   * Seeded role doctrine — aligned with community meta (Xenonauts Wiki, the
   * Steam "Essential Weapon Class Tactics" guide, Arqade squad guides):
   * rifle/scout/assault priorities per weapon class, heavy weapons aiming with
   * min(STR, ACC), reaction fire = RFL x weapon modifier x %TU left, BRV being
   * the scarcest (hardest-to-train) stat. Everything is editable in the Roles
   * tab and stored in settings — these are only the fallback defaults.
   *
   * Note on the MG STR floor: the game only adds a heavy-weapon aiming penalty
   * below 70 STR (it does not forbid it), and early-game rosters rarely have
   * anyone at 70+, so the hard floor stays a sanity bar (55); the STR 3 / ACC 3
   * weights make the optimizer pick the best min(STR,ACC) soldier anyway.
   *
   * Role display names are the OFFICIAL in-game loadout class names players
   * see in the game (the save's own role strings: Rifleman, Assault, Sniper,
   * Scout, Shield, Heavy weapons, Rocketeer, Specialist). Our doctrine roles
   * map onto them: breacher -> Shield (shield carrier does the doors), mg ->
   * Heavy weapons, medic -> Specialist (the specialist carries the extra
   * medkits/ammo/grenades). Ids stay stable so saved seats/templates keep
   * working.
   * weights: stat -> weight; floors: minimum raw stats; kitWeight: equipment
   * weight in kg for the encumbrance check; trains: stats the seat trains
   * (tie-breaker); frontline: subject to the BRV floor in the psi era;
   * strengthTraining: invert the encumbrance check to train STR.
   */
  function defaultRoles() {
    return [
      makeRole({ id: "rifleman", name: "Rifleman", weights: { ACC: 3, RFL: 2, TU: 2, BRV: 1 }, floors: {}, kitWeight: 8, trains: ["ACC", "RFL"], frontline: true }),
      makeRole({ id: "scout", name: "Scout", weights: { TU: 3, HP: 3, RFL: 2 }, floors: { TU: 55, HP: 50 }, kitWeight: 6, trains: ["TU", "HP"], frontline: true }),
      makeRole({ id: "sniper", name: "Sniper", weights: { ACC: 4, RFL: 2, TU: 2, BRV: 1.5 }, floors: { ACC: 55 }, kitWeight: 9, trains: ["ACC", "RFL"], frontline: false }),
      makeRole({ id: "mg", name: "Heavy weapons", weights: { STR: 3, ACC: 3, TU: 1.5 }, floors: { STR: 55 }, kitWeight: 16, trains: ["STR", "ACC"], frontline: false }),
      makeRole({ id: "breacher", name: "Shield", weights: { RFL: 3, HP: 3, TU: 2, STR: 2 }, floors: { HP: 55, RFL: 50 }, kitWeight: 18, trains: ["RFL", "HP"], frontline: true }),
      makeRole({ id: "assault", name: "Assault", weights: { RFL: 3, TU: 2.5, ACC: 1.5, HP: 2 }, floors: { TU: 55 }, kitWeight: 10, trains: ["TU", "RFL"], frontline: true }),
      makeRole({ id: "rocketeer", name: "Rocketeer", weights: { STR: 3, ACC: 3, BRV: 1.5 }, floors: { STR: 55, ACC: 55, BRV: 50 }, kitWeight: 15, trains: ["STR", "BRV"], frontline: false }),
      makeRole({ id: "medic", name: "Specialist", weights: { BRV: 2, TU: 2, STR: 1 }, floors: {}, kitWeight: 9, trains: ["BRV", "TU"], frontline: false }),
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
    VERSION_HISTORY,
    makeSoldier,
    defaultRoles,
    defaultTemplates,
    hpFraction,
  };
});
