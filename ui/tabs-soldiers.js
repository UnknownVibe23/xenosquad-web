/*
 * ui/tabs-soldiers.js - Soldiers tab: the parsed roster with stats and wound
 * status. Rendering only; all parsing/scoring lives in the pure modules.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h } = XS.dom;

  function statCell(v) {
    return v == null ? "n/a" : String(v);
  }

  /* Loadout cell: weapon/ammo strings with their prefixes stripped, or the
   * armour string for recruits (they carry armour only), or "none". */
  function loadoutCell(s) {
    if (s.loadout && s.loadout.length > 0) return s.loadout.map((v) => v.replace(/^(weapon|ammo)\./, "")).join(", ");
    if (s.armour) return "armour only (" + s.armour.replace(/^armour\./, "") + ")";
    return "none";
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
        h("h2", { text: "Roster: " + state.roster.length + " soldiers (" + state.roster.filter((s) => s.inTeam !== false).length + " in team, " + state.roster.filter((s) => s.inTeam === false).length + " recruitable)" }),
        (state.anomalies || []).length > 0
          ? h("div", { class: "note-box warn-box" }, [
              h("p", { class: "note-inline", text: "Warning: this file failed " + state.anomalies.length + " sanity check(s) and may not be a vanilla Xenonauts 1 save; the numbers below may be wrong (see the Squad tab banner)." }),
              ...(state.anomalies || []).slice(0, 5).map((a) => h("p", { class: "note-inline", text: a })),
            ])
          : null,
        (state.notices || []).length > 0 ? h("div", { class: "note-box" }, (state.notices || []).map((n) => h("p", { class: "note-inline", text: "Note: " + n }))) : null,
        h("ul", { class: "legend" }, [
          h("li", { text: "badge = team member (with transport seat, e.g. Charlie - 1/13) or recruit (recruitment pool)" }),
          h("li", { text: "HP column = current/max HP and wound % (current HP is the int stored right before the role string in the save block)" }),
          h("li", { text: "recruits are at full HP in-game and are never marked wounded" }),
          h("li", { text: "stat columns = TU ACC RFL BRV STR HP, shown as in-game (the PVT to CPL promotion adds +2 to every stat; rank points from the save drive it)" }),
          h("li", { text: "rank = in-game rank from the save's rank points (PVT 0, CPL 3, SGT 9, ...)" }),
          h("li", { text: "loadout = equipment strings from the save (armour only for recruits)" }),
        ]),
      ])
    );

    // Compact, non-wrapping stat columns; name carries the game role as a
    // sub-line; HP column merges current/max and wound %; the Status column
    // says in words why a row is red (or that it is fine / unknown).
    const head = h("tr", {}, [
      h("th", { text: "Name", class: "wrap" }),
      h("th", { text: "Team" }),
      h("th", { text: "Nationality", class: "wrap" }),
      ...XS.domain.STATS.map((s) => h("th", { text: s, class: "num" })),
      h("th", { text: "HP cur/max", class: "num" }),
      h("th", { text: "Status" }),
      h("th", { text: "Rank", class: "num" }),
      h("th", { text: "Loadout", class: "wrap" }),
    ]);

    const rows = state.roster.map((s) => {
      const isRecruit = s.inTeam === false;
      const frac = XS.domain.hpFraction(s);
      const threshold = state.settings.global ? state.settings.global.woundedThreshold : 0.5;
      const wounded = !isRecruit && frac != null && frac < threshold;
      const woundPct = frac == null ? "n/a" : Math.round(frac * 100) + "%";
      const teamLabel = isRecruit ? "recruit" : s.seat ? s.seat : "team";
      const hpText = frac != null ? s.currentHP + "/" + statCell(s.stats.HP) + " · " + woundPct : statCell(s.stats.HP) + " max";
      let statusText;
      let statusClass = "";
      if (isRecruit) statusText = "recruit: full HP in-game";
      else if (frac == null) statusText = "wound data not in save (check off)";
      else if (wounded) {
        statusText = "wounded: " + Math.round(frac * 100) + "% < " + Math.round(threshold * 100) + "% threshold";
        statusClass = " wounded";
      } else statusText = "ok (" + Math.round(frac * 100) + "%)";
      return h("tr", { class: (wounded ? "wounded" : "") + (isRecruit ? " recruit" : "") }, [
        h("td", { class: "wrap" }, [h("span", { text: s.name }), s.equipmentRole ? h("div", { class: "sub", text: s.equipmentRole }) : null]),
        h("td", { text: teamLabel, class: isRecruit ? "recruit-badge" : "team-badge" }),
        h("td", { class: "wrap", text: s.nationality }),
        ...XS.domain.STATS.map((st) => h("td", { class: "num", text: statCell(s.stats[st]) })),
        h("td", { class: "num" + (wounded ? " wounded" : ""), text: hpText }),
        h("td", { class: "status" + statusClass, text: statusText }),
        h("td", { class: "num", text: XS.domain.rankLabel(s.rank) + " " + s.rank }),
        h("td", { class: "small wrap", text: loadoutCell(s) }),
      ]);
    });

    const wrap = h("div", { class: "table-wrap" }, [h("table", { class: "roster" }, [h("thead", {}, [head]), h("tbody", {}, rows)])]);
    main.appendChild(h("section", { class: "panel" }, [wrap]));
  }

  XS.ui = XS.ui || {};
  XS.ui.soldiers = renderSoldiers;
})(typeof self !== "undefined" ? self : globalThis);
