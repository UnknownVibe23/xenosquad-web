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
        ...(state.notices || []).map((n) => h("p", { class: "note-inline", text: "Note: " + n })),
        h("p", { class: "muted legend", text: "Legend: badge = team member (with transport seat) or recruit · red row = wounded, below the wounded threshold (Settings) · columns TU/HP/STR/ACC/RFL/BRV are the six stats" }),
      ])
    );

    const head = h("tr", {}, [
      h("th", { text: "Name" }),
      h("th", { text: "Team" }),
      h("th", { text: "Nationality" }),
      h("th", { text: "Game role" }),
      ...XS.domain.STATS.map((s) => h("th", { text: s })),
      h("th", { text: "HP" }),
      h("th", { text: "Wound" }),
      h("th", { text: "Rank" }),
      h("th", { text: "Loadout" }),
    ]);

    const rows = state.roster.map((s) => {
      const frac = XS.domain.hpFraction(s);
      const woundPct = frac == null ? "—" : Math.round(frac * 100) + "%";
      const wounded = frac != null && frac < (state.settings.global ? state.settings.global.woundedThreshold : 0.5);
      const teamLabel = s.inTeam === false ? "recruit" : s.seat ? "team · " + s.seat : "team";
      return h("tr", { class: (wounded ? "wounded" : "") + (s.inTeam === false ? " recruit" : "") }, [
        h("td", { text: s.name }),
        h("td", { text: teamLabel, class: s.inTeam === false ? "recruit-badge" : "" }),
        h("td", { text: s.nationality }),
        h("td", { text: s.equipmentRole || "—" }),
        ...XS.domain.STATS.map((st) => h("td", { class: "num", text: statCell(s.stats[st]) })),
        h("td", { class: "num", text: s.currentHP == null ? "—" : s.currentHP + " / " + statCell(s.stats.HP) }),
        h("td", { text: woundPct }),
        h("td", { class: "num", text: String(s.rank) }),
        h("td", { class: "small", text: s.loadout.join(", ") }),
      ]);
    });

    const wrap = h("div", { class: "table-wrap" }, [h("table", { class: "roster" }, [h("thead", {}, [head]), h("tbody", {}, rows)])]);
    main.appendChild(h("section", { class: "panel" }, [wrap]));
  }

  XS.ui = XS.ui || {};
  XS.ui.soldiers = renderSoldiers;
})(typeof self !== "undefined" ? self : globalThis);
