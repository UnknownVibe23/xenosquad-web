/*
 * ui/tabs-help.js — Help tab: quick start, recruits & wound status, the
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
          text: "Xeno Squad " + v + " — a squad planner for Xenonauts 1 (2014). It reads a save file locally in your browser, shows your soldiers, and computes the mathematically optimal assignment of soldiers to the role seats you define. Static website, no backend. ",
        }, [h("a", { href: XS.domain.REPO_URL, text: "Source on GitHub" })]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Quick start" }),
        h("ol", {}, [
          h("li", { text: "Grab a .sav from your Xenonauts save folder (Documents/Xenonauts/ — inside the Wine prefix at drive_c/users/<user>/Documents/Xenonauts/ when playing via Proton). A dedicated slot producing planner.sav is handy." }),
          h("li", { text: "Drag the file anywhere onto this page (or use the picker on the Squad tab). It is parsed locally and never uploaded." }),
          h("li", { text: "Squad tab: apply a mission template or build your own seat list (+ role buttons, per-seat role dropdown, × to remove; default 8 seats like the CH-48 Charlie), then read the suggested squad, bench and the \"why\" per pick — all live, via the \"Plan squad\" button or automatically." }),
          h("li", { text: "Soldiers: the parsed roster. Roles: your doctrine (weights, floors, kit weight). Settings: global parameters, export/import, resets, Clear all my data." }),
        ]),
        h("p", { class: "muted", text: "The save format was verified against real saves and in-game screenshots and is built in (the Calibrate/save-format UI is hidden because the GOG build is final — see README to re-enable it). Fields we could not locate (rank) disable their feature with a notice instead of inventing values." }),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Recruits & wounded soldiers" }),
        h("ul", {}, [
          h("li", { text: "The save holds your active team AND the recruitment pool: a block with a weapon.* string is in your team; recruits carry armour only. The Soldiers tab badges each one (team seat like \"Charlie - 1/13\", or recruit)." }),
          h("li", { text: "Recruits mode (Squad result panel or Settings → Recruits): off (default) / only empty seats (recruits fill just seats no team soldier can fill) / all seats. A recruit in the suggested squad gets a \"recruit — hire first\" badge." }),
          h("li", { text: "Recruits are never wounded: in-game they are at full HP (verified on the recruit screen), and the float in their save block is a different field — so their current HP is shown as unknown, not as a wound." }),
          h("li", { text: "A red row in the roster = wounded team soldier: current HP below the threshold (Settings → Eligibility). The Status column spells out the numbers." }),
        ]),
      ])
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "How the squad is computed" }),
        h("ol", {}, [
          h("li", { text: "Exclusions: wounded soldiers (HP fraction below threshold) are out; frontline roles also need the BRV floor in the psi era." }),
          h("li", { text: "Normalization: each stat is min-max scaled over the eligible roster, so picks stay sensible as the team improves." }),
          h("li", { text: "Score: per role, a weighted sum of normalized stats — only for soldiers passing the role's floors and the encumbrance check (kit weight vs STR capacity; strength-training roles invert it to train STR)." }),
          h("li", { text: "Assignment: one global soldier × seat problem solved optimally by a hand-written Hungarian (Kuhn-Munkres) algorithm — never greedy, which would let the best sniper steal the scout seat. Ties: rank first, then training fit." }),
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
          h("li", { text: "Only your settings are stored (localStorage, xenosquad-web. prefix, never cookies). The roster is never persisted — soldier names are personal data. Export settings as JSON is a download you start; \"Clear all my data\" wipes the namespace and the in-memory roster." }),
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
