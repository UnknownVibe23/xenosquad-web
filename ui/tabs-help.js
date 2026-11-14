/*
 * ui/tabs-help.js - Help tab: quick start, recruits & wound status, the
 * scoring pipeline in brief, the data-privacy note, and the version history
 * (rendered from XS.domain.VERSION_HISTORY). Kept short on purpose.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h } = XS.dom;

  function renderHelp(main, state) {
    const v = XS.domain.APP_VERSION;
    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "What this is" }),
        h("p", {
          text: "Xeno Squad " + v + ", a squad planner for Xenonauts 1 (2014). It reads a save file locally in your browser, shows your soldiers, and computes the mathematically optimal assignment of soldiers to the role seats you define. Static website, no backend. ",
        }, [h("a", { href: XS.domain.REPO_URL, text: "Source on GitHub" })]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Quick start" }),
        h("ol", {}, [
          h("li", { text: "Grab a .sav from your Xenonauts save folder (Documents/Xenonauts/; inside the Wine prefix at drive_c/users/<user>/Documents/Xenonauts/ when playing via Proton). A dedicated slot producing planner.sav is handy." }),
          h("li", { text: "Drag the file anywhere onto this page (or use the picker on the Squad tab). It is parsed locally and never uploaded." }),
          h("li", { text: "Squad tab, top to bottom: load the save, build the squad request (+ role buttons with icons, per-seat role dropdown, × to remove; default 8 seats like the CH-48 Charlie), read the suggested squad, bench and the \"why\" per pick (all live). Mission templates (apply dropdown; editor collapsed) and the save inspection sit in collapsed panels below." }),
          h("li", { text: "Soldiers: the parsed roster, plus a dismiss-candidates list: hired soldiers whose composite stats are below a fraction of the team median (default 70%), each costing a flat $10,000/month in vanilla, so not worth the upkeep. Roles: your doctrine (weights, floors, kit weight). Settings: global parameters incl. the dismissal threshold, export/import, resets, Clear all my data." }),
        ]),
        h("p", { class: "muted", text: "The save format was verified against real saves and in-game screenshots and is built in (the Calibrate/save-format UI is hidden because the GOG build is final; see README to re-enable it). Stats are shown as in-game: the PVT to CPL promotion adds +2 to every stat and is not stored in the stat ints, so the app adds it from the rank points. If a field cannot be located, its feature is disabled with a notice instead of inventing values." }),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Which save files work" }),
        h("ul", {}, [
          h("li", { text: "Supported: vanilla Xenonauts 1, final GOG/Steam build (1.06). Every real save inspected so far has the identical header (\"onex\", version 256) and soldier-block layout, and the game has had no patches since 2017, so the vanilla format is stable." }),
          h("li", { text: "Xenonauts: Community Edition (X:CE) saves written with saveCompatibility=\"gh15x\" in assets/gameconfig.xml are meant to match the vanilla layout and should work. Plain X:CE or heavily modded saves can differ." }),
          h("li", { text: "Verified on several vanilla saves (early and mid campaign, 22 soldiers each, including a wounded soldier at 35 of 50 max HP); saves taken mid-ground-combat use the same soldier blocks. On load the app sanity-checks what it parsed (header magic/version/date, stat ranges, rank points, role strings, team marker, duplicate names, HP above max; thresholds in the settings). If anything looks implausible, a prominent warning appears on the Squad and Soldiers tabs, because wrong numbers are worse than a warning." }),
          h("li", { text: "Which file to drop: any .sav from a save slot, Quicksave or Autosave, preferably taken on the geoscape (ground-combat saves were the crash-prone ones in vanilla). The save folder is Documents/Xenonauts/ in the user's Documents folder; through Proton/Wine that is drive_c/users/<user>/Documents/Xenonauts/ inside the Wine prefix, and on the native Linux port ~/.local/share/Goldhawk Interactive/Xenonauts/." }),
        ]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Recruits & wounded soldiers" }),
        h("ul", {}, [
          h("li", { text: "The save holds your active team AND the recruitment pool: a block with a weapon.* string is in your team; recruits carry armour only. The Soldiers tab badges each one (team seat like \"Charlie - 1/13\", or recruit)." }),
          h("li", { text: "Recruits mode (Squad result panel or Settings → Recruits): off (default) / only empty seats (recruits fill just seats no team soldier can fill) / all seats. A recruit in the suggested squad gets a \"recruit: hire first\" badge." }),
          h("li", { text: "Wounds: current HP is in the save: the int32 stored right before the equipment-role string (after the transport-seat field) is the soldier's in-game current HP (verified on real saves, including one where a soldier reads 35 of max 50 while everyone else reads full). The roster shows current/max HP and wound %, soldiers below the threshold (Settings → Eligibility, default 75%) are red and excluded from planning, and recruits are at full HP in-game so they are never marked wounded." }),
        ]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "How the squad is computed" }),
        h("ol", {}, [
          h("li", { text: "Exclusions: wounded soldiers (HP fraction below threshold) are out; frontline roles also need the BRV floor in the psi era." }),
          h("li", { text: "Normalization: each stat is min-max scaled over the eligible roster, so picks stay sensible as the team improves." }),
          h("li", { text: "Score: per role, a weighted sum of normalized stats, only for soldiers passing the role's floors and the encumbrance check (kit weight vs STR capacity; strength-training roles invert it to train STR)." }),
          h("li", { text: "Assignment: one global soldier × seat problem solved optimally by a hand-written Hungarian (Kuhn-Munkres) algorithm; never greedy, which would let the best sniper steal the scout seat. Ties: rank first, then training fit." }),
          h("li", { text: "Optional training seat: one seat reserved for the lowest-composite healthy soldier so rookies ride along." }),
        ]),
        h("p", { class: "muted", text: "Determinism contract: same save + same settings = same squad. All logic is pure functions, tested headlessly (tests/tests.html, or node --test tests/node/suite.test.js)." }),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Data privacy" }),
        h("ul", {}, [
          h("li", { text: "No backend, no uploads, no analytics, no cookies, no network requests at all (locked down by the CSP meta tag: connect-src 'none', script-src 'self'). The save file is read with the File API into memory only." }),
          h("li", { text: "Only your settings are stored (localStorage, xenosquad-web. prefix, never cookies). The roster is never persisted; soldier names are personal data. Export settings as JSON is a download you start; \"Clear all my data\" wipes the namespace and the in-memory roster." }),
        ]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Version history" }),
        h("div", { class: "table-wrap" }, [
          h("table", { class: "roster" }, [
            h("thead", {}, [h("tr", {}, [h("th", { text: "Version" }), h("th", { text: "What changed", class: "wrap" })])]),
            h("tbody", {}, XS.domain.VERSION_HISTORY.map((e) => h("tr", {}, [
              h("td", { class: "num", text: e.version + (e.version === v ? " (current)" : "") }),
              h("td", { class: "wrap", text: e.note }),
            ]))),
          ]),
        ]),
      ])
    );
  }

  XS.ui = XS.ui || {};
  XS.ui.help = renderHelp;
})(typeof self !== "undefined" ? self : globalThis);
