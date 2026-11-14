/*
 * ui/tabs-soldiers.js — Soldiers tab: the parsed roster with stats and wound
 * status. Rendering only; all parsing/scoring lives in the pure modules.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h } = XS.dom;

  function statCell(v) {
    return v == null ? "—" : String(v);
  }

  function renderSoldiers(main, state) {
    if (!state.roster || state.roster.length === 0) {
      main.appendChild(
        h("section", { class: "panel muted" }, [
          h("h2", { text: "Soldiers" }),
          h("p", { text: "No save loaded yet. Drop a .sav file anywhere on the page to see the roster here." }),
        ])
      );
      return;
    }

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Roster — " + state.roster.length + " soldiers (" + state.roster.filter((s) => s.inTeam !== false).length + " in team, " + state.roster.filter((s) => s.inTeam === false).length + " recruitable)" }),
        (state.notices || []).length > 0 ? h("div", { class: "note-box" }, (state.notices || []).map((n) => h("p", { class: "note-inline", text: "Note: " + n }))) : null,
        h("p", { class: "muted legend", text: "badge = team member (with transport seat) or recruit · red = wounded below the threshold (Settings) · stat columns are TU ACC RFL BRV STR HP" }),
      ])
    );

    // Compact, non-wrapping stat columns; name carries the game role as a
    // sub-line; HP column merges current/max and wound %.
    const head = h("tr", {}, [
      h("th", { text: "Name", class: "wrap" }),
      h("th", { text: "Team" }),
      h("th", { text: "Nationality", class: "wrap" }),
      ...XS.domain.STATS.map((s) => h("th", { text: s, class: "num" })),
      h("th", { text: "HP cur/max · wound", class: "num" }),
      h("th", { text: "Rank", class: "num" }),
      h("th", { text: "Loadout", class: "wrap" }),
    ]);

    const rows = state.roster.map((s) => {
      const frac = XS.domain.hpFraction(s);
      const woundPct = frac == null ? "—" : Math.round(frac * 100) + "%";
      const wounded = frac != null && frac < (state.settings.global ? state.settings.global.woundedThreshold : 0.5);
      const teamLabel = s.inTeam === false ? "recruit" : s.seat ? s.seat : "team";
      const hpText = s.currentHP == null || s.stats.HP == null ? "—" : Math.round(s.currentHP) + "/" + statCell(s.stats.HP) + " · " + woundPct;
      return h("tr", { class: (wounded ? "wounded" : "") + (s.inTeam === false ? " recruit" : "") }, [
        h("td", { class: "wrap" }, [h("span", { text: s.name }), s.equipmentRole ? h("div", { class: "sub", text: s.equipmentRole }) : null]),
        h("td", { text: teamLabel, class: s.inTeam === false ? "recruit-badge" : "team-badge" }),
        h("td", { class: "wrap", text: s.nationality }),
        ...XS.domain.STATS.map((st) => h("td", { class: "num", text: statCell(s.stats[st]) })),
        h("td", { class: "num" + (wounded ? " wounded" : ""), text: hpText }),
        h("td", { class: "num", text: String(s.rank) }),
        h("td", { class: "small wrap", text: s.loadout.join(", ") }),
      ]);
    });

    const wrap = h("div", { class: "table-wrap" }, [h("table", { class: "roster" }, [h("thead", {}, [head]), h("tbody", {}, rows)])]);
    main.appendChild(h("section", { class: "panel" }, [wrap]));
  }

  XS.ui = XS.ui || {};
  XS.ui.soldiers = renderSoldiers;
})(typeof self !== "undefined" ? self : globalThis);
