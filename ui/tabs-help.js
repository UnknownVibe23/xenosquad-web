/*
 * ui/tabs-help.js — Help tab: short usage guide, the calibration flow, the
 * scoring pipeline (including why the Hungarian algorithm), the data-privacy
 * note, and the version. Every feature of the site is documented here.
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
          text: "xenosquad-web " + v + " — a squad planner for Xenonauts 1 (2014, Goldhawk Interactive). It reads a save file, shows your soldiers, and computes the mathematically optimal assignment of soldiers to role seats for a squad you define. It is a static website with no backend.",
        }),
        h("p", {}, [h("a", { href: XS.domain.REPO_URL, text: "Source repository on GitHub" })]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Quick start" }),
        h("ol", {}, [
          h("li", { text: "Find your save file. On Linux via the Heroic Games Launcher through Proton it lives at drive_c/users/steamuser/Documents/Xenonauts/ inside the Wine prefix. Keep a dedicated save slot that produces planner.sav." }),
          h("li", { text: "Drag the .sav file anywhere onto this page (or use the file picker on the Squad tab). The file is read locally with the File API and parsed in your browser." }),
          h("li", { text: "Squad tab: pick a mission template (or build your own seat list — each seat has its own role; add/remove freely, default 8 seats like the CH-48 Charlie). The suggested squad, bench and a one-line \"why\" per pick update live." }),
          h("li", { text: "Soldiers tab: the parsed roster with stats and wound status. Roles tab: edit your doctrine. Settings tab: global parameters, export/import, resets. Calibrate tab: map raw save slots to stats." }),
        ]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Calibration flow (first run)" }),
        h("p", { text: "The save's soldier block holds raw values whose meaning is only known after calibration — nothing is hardcoded. The Calibrate tab shows every soldier next to its raw ints and the padding float, with dropdowns assigning each of the six stats (TU, ACC, RFL, BRV, STR, HP) to a raw slot, plus sources for current HP and rank. The default mapping (slots 0..5 = TU..HP of the first copy; the float = current HP) matches the inspected sample save; adjust it there if your game version differs, and the roster re-parses live. If a field cannot be located (e.g. rank), the dependent feature is disabled with a visible notice instead of inventing values." }),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "How the squad is computed" }),
        h("ol", {}, [
          h("li", { text: "Exclusions: soldiers below the wounded HP-fraction threshold are ineligible; frontline roles additionally need the BRV floor while the psi era is on." }),
          h("li", { text: "Normalization: each stat is min-max normalized across the eligible roster, so picks stay sensible as the team improves." }),
          h("li", { text: "Per-role score: weighted sum of normalized stats for candidates passing the role's floors and the encumbrance check (kit weight vs the limit fraction of STR capacity; strength-training roles invert it on purpose)." }),
          h("li", { text: "Assignment: one global assignment problem over the soldier × seat score matrix, solved optimally by a hand-written Hungarian (Kuhn-Munkres) algorithm — never greedy per-seat picking, which would let the best sniper steal the scout seat. Tie-breakers: military rank first, then how well the seat trains the soldier." }),
          h("li", { text: "Training seat (optional setting): one seat is reserved for the lowest-composite healthy soldier so rookies ride along." }),
        ]),
        h("p", { class: "muted", text: "Determinism contract: the same save and the same settings always produce the same squad. All logic modules are pure functions." }),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Data privacy — read this" }),
        h("ul", {}, [
          h("li", { text: "No backend, no uploads: the save file is opened with the File API and parsed locally in memory. There is nowhere for it to be sent to." }),
          h("li", { text: "No analytics, no cookies, no external requests of any kind (no CDN fonts/scripts/images, no fetch/XHR/WebSocket). The Content-Security-Policy meta tag in index.html locks this down (connect-src 'none', script-src 'self')." }),
          h("li", { text: "The only thing stored is your settings, in localStorage under the xenosquad-web. prefix — never in cookies, and the roster (soldier names are personal data) is never persisted; it lives in memory for the session only." }),
          h("li", { text: "The app never writes to your filesystem except downloads you explicitly start (Export settings as JSON)." }),
          h("li", { text: "Use \"Clear all my data\" in the Settings tab to wipe the localStorage namespace and clear the in-memory roster." }),
        ]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Version" }),
        h("p", { text: "xenosquad-web version " + v + ". The version constant lives in domain/models.js and is shown in the footer; it is bumped with each milestone." }),
      ])
    );
  }

  XS.ui = XS.ui || {};
  XS.ui.help = renderHelp;
})(typeof self !== "undefined" ? self : globalThis);
