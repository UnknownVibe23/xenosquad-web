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
  const APP_VERSION = "0.31.0";

  /*
   * Changelog, newest first. Rendered as a table at the bottom of the Help
   * tab; keep each note to one line. APP_VERSION must match the first entry.
   */
  const VERSION_HISTORY = [
    { version: "0.31.0", note: "New dismiss-candidates list on the Soldiers tab: hired (active-team) soldiers whose composite stat score is below a fraction of the team's median composite (default 70%) are listed worst-first with rank, HP, and the flat $10,000/month vanilla salary they cost, since they are not worth the upkeep. Recruits are never listed. Threshold, upkeep and list cap are adjustable in Settings (new 'dismiss' section, resettable, validated on import). Pure logic XS.scoring.dismissList, deterministic." },
    { version: "0.30.0", note: "UI/UX polish: in-game role icons are bigger everywhere (seat chips, quick-add and template counters 20px, pick cards 22px, Roles tab 28px) and align via vertical-align middle; header with the tab bar is now sticky so tabs stay reachable on long pages (incl. vertical 1080x1920); hover states on tabs/buttons/summaries, visible keyboard focus outlines, slightly larger touch targets for the +/- counters and seat remove buttons." },
    { version: "0.29.0", note: "New seeded mission templates: a 6-soldier + Hunter draft variant for each of the 5 default templates (the Hunter scout car fills 2 transport seats, so 6 + Hunter = a full CH-48 Charlie). Compositions researched from community meta per mission type (Hunter's gun/rockets replace the mg/rocketeer seat where useful, reapers cannot hurt it, it cannot enter tight UFO/base interiors, open maps favor the sniper). Existing installs get the new templates appended on upgrade without losing their custom ones." },
    { version: "0.28.0", note: "Save-reading hardening: current HP also falls back to the seat-anchored int when a soldier block has no known role string; the load-time sanity check additionally flags duplicate soldier names and a malformed header in-game date. README now lists the verified real-save sample matrix. All 4 real vanilla saves still parse with zero anomalies." },
    { version: "0.27.0", note: "Current HP located and verified on a new real save: the int32 stored 9 bytes before the role string (right after the transport-seat index) is the soldier's in-game current HP; in the latest save one soldier reads 35 of max 50 while everyone else reads full. The wounded check is ON by default again (threshold 0.75): the roster shows current/max HP and wound %, red rows are wounded, and recruits are never wounded. The sanity check now also flags a current HP above max HP. Calibration migrates on upgrade." },
    { version: "0.26.0", note: "Save reliability: on load the parser now sanity-checks the parsed values (header magic/version, stat ranges, rank points, role strings, team marker; thresholds in settings.format.sanity) and shows a prominent warning when a file is not a vanilla Xenonauts 1 save, so an X:CE/modded/corrupted save can no longer produce silently wrong numbers. Help and README document the supported saves (vanilla 1.06, X:CE with saveCompatibility gh15x) and recommend geoscape saves." },
    { version: "0.25.0", note: "Wound check fixed: verified on a fresh-game save that the padding float is NOT current HP (everyone is at full HP in-game while the float reads 22-35), so current HP is now treated as not locatable, the wounded check is off by default with a notice, and the roster shows max HP only. Calibration migrates on upgrade." },
    { version: "0.24.0", note: "Bug fix: settings saved by older versions no longer stick (version migrations now reset corrected sections, so the 0.23.0 rank mapping + promotion bonus actually apply on upgrade); imports from old export files migrate too." },
    { version: "0.23.0", note: "Save format update verified against a fresh-game save + roster screenshot: postInts[0] is rank POINTS (gameconfig soldierRanks; PVT 0, CPL 3, SGT 9, LT 16, CPT 30), and the first promotion (PVT -> CPL) adds +2 to EVERY stat without storing it in the stat ints, so the app now adds that bonus to displayed/used stats (calibration.promotionBonus). Rank is now located: shown as a name in the roster and the rank tie-breaker is enabled." },
    { version: "0.22.0", note: "Full hardening pass (redteam): new tests/security.test.js (parser fuzzing, hostile settings imports, source scans for network/eval/cookie/HTML sinks + CSP checks, determinism fuzz, Hungarian vs brute force). Real bug found and fixed: the training seat could reserve a soldier who fails the seat's floors; it now picks the lowest-composite soldier among those eligible for the seat. Settings imports are validated and corrupted localStorage is sanitized." },
    { version: "0.21.0", note: "Squad tab decluttered: core flow is now load -> squad request -> suggested squad at the top; save inspection and the template editor moved into collapsed panels below (template apply dropdown stays visible)." },
    { version: "0.20.0", note: "Official in-game class icons (assets/icons/, extracted from the owner's own screenshot with permission) shown next to roles in the seat builder, template counters, pick cards and Roles tab." },
    { version: "0.19.0", note: "Empty seats are now explained directly on their seat card in the suggested squad (\"no eligible soldier for this seat\"), instead of as separate notice lines." },
    { version: "0.18.0", note: "Veteran doctrine update (verified meta): new weights/floors/frontline/trains per role; hard sourced floors STR 70 (Heavy weapons, Rocketeer recoil), ACC 65 (Sniper), STR 55 (Shield), ACC 40 (Assault); trains never list BRV/HP; wounded threshold default 0.5 -> 0.75. Roster table tightened so it fits the panel without inner scrolling." },
    { version: "0.17.0", note: "README reworked (no stale references). Soldiers tab: legend is now a line-per-entry list and the loadout column is cleaned up (save stores loadout strings twice; now deduped, prefixes stripped, no truncation; recruits show their armour). All user-facing texts are em-dash-free, guarded by a test. No em dashes in UI sources, enforced." },
    { version: "0.16.0", note: "Soldiers tab: explicit status column (red = wounded, with the threshold shown); recruits are never marked wounded (in-game they are at full HP; the float in their save block is a different field, now treated as unknown). Slimmer Help tab with this version history. Mission-template cards: tidier spacing + seat count." },
    { version: "0.15.0", note: "Recruits mode is tri-state: off (default) / fill only empty seats / all seats. Recruit picks still get the \"hire first\" badge." },
    { version: "0.14.0", note: "Official in-game class names (Rifleman, Assault, Sniper, Scout, Shield, Heavy weapons, Rocketeer, Specialist); template editor with per-role +/- counters; seat builder with quick-add buttons and chips; new title \"Xeno Squad\"." },
    { version: "0.13.0", note: "Calibrate tab and save-format UI hidden (the GOG build is final; code kept, re-enable documented in README). Settings grouped; roster table layout fixed." },
    { version: "0.12.0", note: "Meta-aligned role weights; game-accurate encumbrance (capacity = 8 + 0.3 x STR kg, TU penalty above the limit, STR trains past 80%)." },
    { version: "0.11.0", note: "Recruits picked for a squad are marked \"recruit: hire first\"." },
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
    "Reserve", // the game's "no loadout assigned" state; appears in real saves
  ];

  /*
   * In-game class icon for one of OUR role ids (assets/icons/<id>.png,
   * extracted from the owner's own game screenshot, included with permission;
   * CSP img-src 'self' allows same-origin images, relative path works from
   * file://). Ids are stable, so saved roles keep their icon.
   */
  function roleIcon(roleId) {
    return "assets/icons/" + roleId + ".png";
  }

  /*
   * Rank tiers: rank points -> in-game rank name (gameconfig.xml soldierRanks;
   * 0/3/9/16/30 verified against the wiki/community for PVT/CPL/SGT/LT/CPT, the
   * higher tiers follow the same table's order). The PVT -> CPL promotion also
   * grants +2 to every stat (Arqade/gameconfig) - that bonus is NOT stored in
   * the stat ints, so the parser adds it via calibration.promotionBonus.
   */
  const RANK_TIERS = [
    [0, "PVT"],
    [3, "CPL"],
    [9, "SGT"],
    [16, "LT"],
    [30, "CPT"],
    [50, "MAJ"],
    [75, "CMDR"],
    [100, "COL"],
  ];

  /* Rank label for a rank-point value, e.g. 9 -> "SGT". */
  function rankLabel(rankPoints) {
    const p = typeof rankPoints === "number" && Number.isFinite(rankPoints) ? rankPoints : 0;
    let label = RANK_TIERS[0][1];
    for (const [min, name] of RANK_TIERS) if (p >= min) label = name;
    return label;
  }

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
      armour: init.armour || null, // armour.* string (recruits carry armour only)
      loadout: Array.isArray(init.loadout) ? init.loadout.slice() : [], // weapon.*/ammo.* strings, deduped by the parser
      raw: init.raw || null,
    };
  }

  /*
   * Seeded role doctrine - VETERAN META (verified against the Darkfireslide
   * weapon-class guide, Arqade squad composition, GameFAQs ground-combat and
   * strategy guides, and the Xenonauts wiki). Hard sourced numbers used as
   * floors: STR 70 recoil breakpoint for Heavy weapons / Rocketeer (never
   * fixable, even with Predator armour), ACC 65 for Sniper, STR 55 for Shield,
   * ACC 40 for Assault. Reaction fire = RFL x weapon modifier x %TU left, so
   * door/flanker roles weight RFL highest; high RFL on an MG is a
   * friendly-fire liability and rockets cannot reaction-fire, so both weight
   * RFL 0. Trains rules: never BRV (panic events/medals only) and never HP
   * (passive); TU is the only stat that can gain +2 per mission. Judgment
   * weights (no exact veteran number, tune freely in the Roles tab): Sniper
   * BRV 1, Shield BRV 2, Assault BRV 1, Rocketeer BRV 0.5, Scout BRV 1.
   * Known late-game variant NOT modeled (no per-era weight switch exists,
   * only the psi-era BRV floor): Heavy weapons would drop to STR 1 / TU 2.5.
   * Everything is editable in the Roles tab and stored in settings - these
   * are only the fallback defaults.
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
      makeRole({ id: "rifleman", name: "Rifleman", weights: { TU: 2, ACC: 3, RFL: 2, BRV: 1 }, floors: {}, kitWeight: 8, trains: ["ACC", "TU"], frontline: false }),
      makeRole({ id: "scout", name: "Scout", weights: { TU: 3, RFL: 2, HP: 1.5, ACC: 1, BRV: 1 }, floors: {}, kitWeight: 6, trains: ["TU", "RFL"], frontline: true }),
      makeRole({ id: "sniper", name: "Sniper", weights: { ACC: 4, RFL: 2, TU: 2.5, BRV: 1 }, floors: { ACC: 65 }, kitWeight: 9, trains: ["ACC", "TU"], frontline: false }),
      makeRole({ id: "mg", name: "Heavy weapons", weights: { STR: 3, ACC: 3, TU: 1.5 }, floors: { STR: 70 }, kitWeight: 16, trains: ["STR", "ACC"], frontline: false }),
      makeRole({ id: "breacher", name: "Shield", weights: { RFL: 3, HP: 3, TU: 2, STR: 2, BRV: 2, ACC: 0.5 }, floors: { STR: 55 }, kitWeight: 18, trains: ["TU", "RFL"], frontline: true }),
      makeRole({ id: "assault", name: "Assault", weights: { RFL: 3, TU: 3, HP: 2, ACC: 1, STR: 1, BRV: 1 }, floors: { ACC: 40 }, kitWeight: 10, trains: ["TU", "RFL"], frontline: true }),
      makeRole({ id: "rocketeer", name: "Rocketeer", weights: { STR: 3, ACC: 3, TU: 1.5, BRV: 0.5 }, floors: { STR: 70 }, kitWeight: 15, trains: ["STR", "TU"], frontline: false }),
      makeRole({ id: "medic", name: "Specialist", weights: { TU: 3, BRV: 2, STR: 1 }, floors: {}, kitWeight: 9, trains: ["TU"], frontline: false }),
    ];
  }

  /*
   * Seeded mission templates (community consensus for Xenonauts 1). Data,
   * not code: stored in settings, editable in the template editor on the
   * Squad tab. No seeded template includes a medic seat — the community
   * distributes medkits across all soldiers; the medic role stays available
   * in the Roles tab and can be swapped into any template.
   *
   * The five "(6 + Hunter, draft)" variants are 6-seat versions for a squad
   * with the Hunter scout car, which fills exactly 2 transport seats (the
   * CH-48 Charlie carries 8 = 8 soldiers or 6 soldiers + 1 vehicle). DRAFT
   * meta researched from community guides (GameFAQs dpelectric strategy
   * guide, Arqade squad-composition thread, Steam/reddit loadout threads,
   * Xenonauts wiki): the Hunter has +2 sight range, is immune to psi/panic,
   * soaks reaction fire, and can HMG/rocket UFO doors itself; reapers cannot
   * hurt it; it cannot fit into tight UFO/base interiors or upper floors and
   * is weakest in clogged urban maps. So per mission the 2 dropped seats are:
   * crash site: mg (Hunter's own gun covers suppression/door) + one breacher,
   * keep the sniper for the open killing fields;
   * UFO landing: mg + one breacher (Hunter busts the front door, two snipers
   * cover the exits, one shield opens);
   * terror site: rocketeer (Hunter with rockets/laser = the explosives, and
   * reapers are useless against it) + one rifleman; shields weak vs reapers,
   * so only one shield, but two assaults for the tight spaces;
   * alien base: sniper (no long sightlines in corridors) + one rifleman;
   * two shields + two assaults + mg for the close fight, Hunter overlooks
   * the entrance;
   * base defense: one breacher + one rifleman; aliens breach in, so fight in
   * the base (1 shield, 2 assaults, 2 rifles, 1 mg) while the Hunter's MG
   * seals a corner of the command area.
   */
  function defaultTemplates() {
    return [
      makeTemplate({ id: "crash-site", name: "Crash site", seats: ["breacher", "breacher", "assault", "assault", "rifleman", "rifleman", "sniper", "mg"] }),
      makeTemplate({ id: "ufo-landing", name: "UFO landing", seats: ["breacher", "breacher", "assault", "rifleman", "rifleman", "sniper", "sniper", "mg"] }),
      makeTemplate({ id: "terror-site", name: "Terror site", seats: ["breacher", "assault", "assault", "rifleman", "rifleman", "sniper", "mg", "rocketeer"] }),
      makeTemplate({ id: "alien-base", name: "Alien base assault", seats: ["breacher", "breacher", "assault", "assault", "rifleman", "rifleman", "sniper", "mg"] }),
      makeTemplate({ id: "base-defense", name: "Base defense", seats: ["breacher", "breacher", "assault", "assault", "rifleman", "rifleman", "rifleman", "mg"] }),
      makeTemplate({ id: "crash-site-6h", name: "Crash site (6 + Hunter, draft)", seats: ["breacher", "assault", "assault", "rifleman", "rifleman", "sniper"] }),
      makeTemplate({ id: "ufo-landing-6h", name: "UFO landing (6 + Hunter, draft)", seats: ["breacher", "assault", "rifleman", "rifleman", "sniper", "sniper"] }),
      makeTemplate({ id: "terror-site-6h", name: "Terror site (6 + Hunter, draft)", seats: ["breacher", "assault", "assault", "rifleman", "sniper", "mg"] }),
      makeTemplate({ id: "alien-base-6h", name: "Alien base assault (6 + Hunter, draft)", seats: ["breacher", "breacher", "assault", "assault", "rifleman", "mg"] }),
      makeTemplate({ id: "base-defense-6h", name: "Base defense (6 + Hunter, draft)", seats: ["breacher", "assault", "assault", "rifleman", "rifleman", "mg"] }),
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
    roleIcon,
    RANK_TIERS,
    rankLabel,
    makeRole,
    makeTemplate,
    VERSION_HISTORY,
    makeSoldier,
    defaultRoles,
    defaultTemplates,
    hpFraction,
  };
});
