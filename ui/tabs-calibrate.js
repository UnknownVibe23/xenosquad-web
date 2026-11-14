/*
 * ui/tabs-calibrate.js — Calibrate tab: first-run stat mapping.
 *
 * The save block's raw values (statCount ints + the padding float) are shown
 * per soldier next to their names, and the user assigns each stat (and the
 * current-HP / rank sources) to a raw slot with dropdowns. The mapping is
 * saved to settings and applied to every soldier from then on — nothing
 * about the block layout is hardcoded.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h } = XS.dom;

  function option(value, text, selected) {
    const attrs = { value: String(value), text };
    if (selected) attrs.selected = true;
    return h("option", attrs);
  }

  function renderCalibrate(main, state) {
    const app = XS.app;
    const cal = state.settings.calibration;
    const statCount = state.settings.format.statCount;

    const statSelect = (st) =>
      h("select", {
        on: {
          change: (e) => {
            cal.statSlots[st] = parseInt(e.target.value, 10);
            app.settingsChanged();
          },
        },
      }, Array.from({ length: statCount }, (_, i) => option(i, "slot " + i, cal.statSlots[st] === i)));

    const hpSelect = h("select", {
      on: {
        change: (e) => {
          const v = e.target.value;
          cal.currentHP = v === "float" ? { kind: "float" } : { kind: "slot", slot: parseInt(v, 10) };
          app.settingsChanged();
        },
      },
    }, [
      option("float", "the float in the padding", cal.currentHP.kind === "float"),
      ...Array.from({ length: statCount }, (_, i) => option(i, "slot " + i, cal.currentHP.kind === "slot" && cal.currentHP.slot === i)),
    ]);

    const postCount = (state.roster && state.roster[0] && state.roster[0].raw && state.roster[0].raw.postInts ? state.roster[0].raw.postInts.length : 10);
    const rankSelect = h("select", {
      on: {
        change: (e) => {
          const v = e.target.value;
          cal.rank =
            v === "none" ? { kind: "none" }
            : v === "experience" ? { kind: "experience" }
            : v.indexOf("post") === 0 ? { kind: "postInt", index: parseInt(v.slice(4), 10) }
            : { kind: "slot", slot: parseInt(v, 10) };
          app.settingsChanged();
        },
      },
    }, [
      option("none", "— not locatable —", cal.rank.kind === "none"),
      option("experience", "number in the experience.* string", cal.rank.kind === "experience"),
      ...Array.from({ length: statCount }, (_, i) => option(i, "slot " + i, cal.rank.kind === "slot" && cal.rank.slot === i)),
      ...Array.from({ length: postCount }, (_, i) => option("post" + i, "after-stats int #" + i, cal.rank.kind === "postInt" && cal.rank.index === i)),
    ]);

    const controls = h("section", { class: "panel" }, [
      h("h2", { text: "Stat mapping (applies to every soldier)" }),
      h("p", {
        class: "muted",
        text: "Each dropdown assigns one of the six stats to a raw value slot in the save block (the block holds " + statCount + " ints — in the inspected save, six stats appearing twice, likely current then base). The float in the zero padding is a separate value. Change anything and the roster below re-parses live.",
      }),
      h("div", { class: "cal-grid" }, [
        ...XS.domain.STATS.map((st) =>
          h("label", { class: "cal-row" }, [h("span", { text: st + " (" + XS.domain.STAT_LABELS[st] + ")" }), statSelect(st)])
        ),
        h("label", { class: "cal-row" }, [h("span", { text: "Current HP (wound check)" }), hpSelect]),
        h("label", { class: "cal-row" }, [h("span", { text: "Rank (tie-breaker)" }), rankSelect]),
      ]),
    ]);
    main.appendChild(controls);

    if (!state.roster || state.roster.length === 0) {
      main.appendChild(h("section", { class: "panel muted" }, [h("p", { text: "Load a save file first — the raw values of each soldier appear here for calibration." })]));
      return;
    }

    const raw0 = state.roster[0].raw || { statInts: [], postInts: [] };
    const postCount2 = raw0.postInts ? raw0.postInts.length : 0;
    const headCells = [h("th", { text: "Soldier" })];
    for (let i = 0; i < statCount; i++) headCells.push(h("th", { text: "slot " + i }));
    headCells.push(h("th", { text: "float" }));
    for (let i = 0; i < postCount2; i++) headCells.push(h("th", { text: "post#" + i, title: "int after the stats #" + i + " (candidate for missions/kills/rank)" }));

    const rows = state.roster.map((s) => {
      const r = s.raw || { statInts: [], hpFloat: null, postInts: [] };
      const cells = [h("td", { text: s.name })];
      for (let i = 0; i < statCount; i++) {
        const mapped = XS.domain.STATS.find((st) => state.settings.calibration.statSlots[st] === i);
        cells.push(h("td", { class: "num" + (mapped ? " mapped" : ""), text: r.statInts[i] != null ? String(r.statInts[i]) : "—", title: mapped ? "mapped to " + mapped : "" }));
      }
      cells.push(h("td", { class: "num", text: r.hpFloat != null ? String(Math.round(r.hpFloat * 100) / 100) : "—" }));
      for (let i = 0; i < postCount2; i++) {
        const isRank = cal.rank.kind === "postInt" && cal.rank.index === i;
        cells.push(h("td", { class: "num" + (isRank ? " mapped" : ""), text: r.postInts && r.postInts[i] != null ? String(r.postInts[i]) : "—", title: isRank ? "mapped to rank" : "" }));
      }
      return h("tr", {}, cells);
    });

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Raw values per soldier (" + state.roster.length + ")" }),
        h("p", { class: "muted", text: "Highlighted slots are currently mapped to a stat. The float column is the float in the padding after the stats (current HP). The post# columns are the small ints between the stats and the float — not certainly identified (candidates for missions/kills/rank), so they are only used if you map rank to one." }),
        h("div", { class: "table-wrap" }, [h("table", { class: "roster" }, [h("thead", {}, [h("tr", {}, headCells)]), h("tbody", {}, rows)])]),
      ])
    );
  }

  XS.ui = XS.ui || {};
  XS.ui.calibrate = renderCalibrate;
})(typeof self !== "undefined" ? self : globalThis);
