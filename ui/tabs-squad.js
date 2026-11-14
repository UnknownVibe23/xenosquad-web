/*
 * ui/tabs-squad.js — Squad tab: save inspector, seat builder, and the planned
 * squad. Rendering only — the plan itself is computed by the pure
 * XS.scoring.planSquad (milestone 3 uses the provisional greedy solver;
 * milestone 4 swaps in the Hungarian solver without touching this file).
 *
 * The seat builder is the squad request: one row per seat, each with its own
 * role dropdown, freely addable/removable, no hardcoded maximum (the CH-48
 * Charlie carries 8 by default, but transports and mods change that).
 * The result re-plans live on every change.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h } = XS.dom;

  function renderInspector(main, state) {
    const info = state.parseInfo;
    if (state.error) {
      main.appendChild(h("section", { class: "panel error" }, [h("h2", { text: "Could not read that file" }), h("p", { text: state.error })]));
      return;
    }
    if (!info || !info.ok) {
      main.appendChild(h("section", { class: "panel muted" }, [h("p", { text: "No save loaded yet. Drop a file (for example planner.sav) to inspect it." })]));
      return;
    }
    const header = info.header || {};
    const rows = [
      ["File name", state.lastFileName || "(unknown)"],
      ["File size", state.lastBuffer ? state.lastBuffer.byteLength.toLocaleString() + " bytes" : "—"],
      ["Save name (header)", header.saveName || "—"],
      ["In-game date (header)", header.gameDate || "—"],
      ['Marker "' + (info.format ? info.format.marker : "SoldierFlags") + '" occurrences', String(info.markerCount)],
      ["Soldier blocks found", String((info.soldiers || []).length)],
    ];
    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Save inspection" }),
        h("table", { class: "kv" }, rows.map((r) => h("tr", {}, [h("th", { text: r[0] }), h("td", { text: r[1] })]))),
      ])
    );
  }

  function renderLoadPanel(main, state) {
    const app = XS.app;
    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "1 · Load a save file" }),
        h("p", { text: "Drag a Xenonauts save file (.sav) anywhere onto this page, or pick one. The file is opened and parsed locally in your browser — it is never uploaded anywhere (there is no server)." }),
        h("p", {}, [
          h("label", { class: "button-like", text: "Choose a .sav file…" }, [
            h("input", {
              type: "file",
              accept: ".sav",
              style: "display:none",
              on: {
                // The extension is only a hint: content is verified by marker scan.
                change: (e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) app.handleFile(f);
                  e.target.value = "";
                },
              },
            }),
          ]),
        ]),
      ])
    );
  }

  /*
   * Mission templates: named seat compositions stored in settings. The
   * dropdown applies one to the seat builder; the editor below it can add,
   * duplicate, rename, edit and delete templates.
   */
  /*
   * Mission templates: named seat compositions stored in settings. The
   * dropdown applies one to the seat builder; the editor uses per-role
   * +/- counter buttons (no free-text seat fields) plus add/duplicate/
   * rename/delete.
   */
  function renderTemplates(main, state) {
    const app = XS.app;
    const templates = state.settings.templates;
    const roles = state.settings.roles || [];

    const select = h("select", { "aria-label": "Mission template" }, [
      h("option", { value: "", text: "— apply a template…" }),
      ...templates.map((tp) => h("option", { value: tp.id, text: tp.name + " (" + tp.seats.length + " seats)" })),
    ]);

    const cards = templates.map((tp) => {
      const counts = {};
      for (const id of tp.seats) counts[id] = (counts[id] || 0) + 1;
      const counters = roles.map((r) => {
        const c = counts[r.id] || 0;
        return h("div", { class: "tpl-count" }, [
          h("span", { class: "tpl-role-name", text: r.name }),
          h("button", {
            type: "button", class: "count-btn", text: "−", disabled: c === 0,
            title: "remove one " + r.name + " seat",
            on: {
              click: () => {
                const i = tp.seats.indexOf(r.id);
                if (i !== -1) tp.seats.splice(i, 1);
                app.settingsChanged();
              },
            },
          }),
          h("span", { class: "tpl-num", text: String(c) }),
          h("button", {
            type: "button", class: "count-btn", text: "+",
            title: "add one " + r.name + " seat",
            on: { click: () => { tp.seats.push(r.id); app.settingsChanged(); } },
          }),
        ]);
      });
      return h("div", { class: "tpl-card" }, [
        h("input", {
          type: "text", class: "tpl-name", value: tp.name, "aria-label": "template name",
          on: { change: (e) => { tp.name = e.target.value || tp.id; app.settingsChanged(); } },
        }),
        h("div", { class: "tpl-counters" }, counters),
        h("span", { class: "btn-row" }, [
          h("button", { type: "button", text: "Apply", title: "Fill the seat builder with this template", on: { click: () => { state.settings.seats = tp.seats.slice(); app.settingsChanged(); } } }),
          h("button", {
            type: "button", text: "Duplicate",
            on: { click: () => { templates.splice(templates.indexOf(tp) + 1, 0, XS.domain.makeTemplate({ name: tp.name + " (copy)", seats: tp.seats.slice() })); app.settingsChanged(); } },
          }),
          h("button", {
            type: "button", class: "danger", text: "Delete", disabled: templates.length <= 1,
            on: { click: () => { if (templates.length <= 1) return; templates.splice(templates.indexOf(tp), 1); app.settingsChanged(); } },
          }),
        ]),
      ]);
    });

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Mission templates" }),
        h("p", { class: "muted", text: "Named seat compositions (community consensus for Xenonauts 1). Apply one, then tweak seats below. Edit a template with the +/− buttons per role — no typing needed." }),
        h("div", { class: "tpl-apply" }, [
          select,
          h("button", {
            type: "button", text: "Apply template",
            on: {
              click: () => {
                const tp = templates.find((x) => x.id === select.value);
                if (tp) { state.settings.seats = tp.seats.slice(); app.settingsChanged(); }
              },
            },
          }),
          h("button", {
            type: "button", text: "+ New template from current seats",
            on: { click: () => { templates.push(XS.domain.makeTemplate({ name: "Template " + (templates.length + 1), seats: state.settings.seats.slice() })); app.settingsChanged(); } },
          }),
        ]),
        h("div", { class: "tpl-list" }, cards),
      ])
    );
  }

  /*
   * Seat builder = the squad request. Quick-add buttons per role on top,
   * then one chip per seat with its own role dropdown and remove button.
   * No hardcoded maximum; defaults to 8 seats (CH-48 Charlie).
   */
  function renderSeatBuilder(main, state) {
    const app = XS.app;
    const roles = state.settings.roles || [];
    const seats = state.settings.seats;

    const roleSelect = (seatIdx) =>
      h("select", {
        class: "seat-role",
        "aria-label": "Role for seat " + (seatIdx + 1),
        on: {
          change: (e) => { seats[seatIdx] = e.target.value; app.settingsChanged(); },
        },
      }, roles.map((r) => {
        const attrs = { value: r.id, text: r.name };
        if (seats[seatIdx] === r.id) attrs.selected = true;
        return h("option", attrs);
      }));

    const chips = seats.map((roleId, i) =>
      h("div", { class: "seat-chip" }, [
        h("span", { class: "seat-num", text: "#" + (i + 1) }),
        roleSelect(i),
        h("button", {
          type: "button", class: "chip-x", text: "×", title: "Remove seat " + (i + 1),
          on: { click: () => { seats.splice(i, 1); app.settingsChanged(); } },
        }),
      ])
    );

    const quickAdd = roles.map((r) =>
      h("button", {
        type: "button",
        class: "quick-add",
        text: "+ " + r.name,
        title: "Add a " + r.name + " seat",
        on: { click: () => { seats.push(r.id); app.settingsChanged(); } },
      })
    );

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "2 · Squad request — " + seats.length + " seat" + (seats.length === 1 ? "" : "s") }),
        h("p", { class: "muted", text: "Build your squad: click a role to add a seat, change a seat's role in its dropdown, remove with ×. Team size is simply the number of seats (the CH-48 Charlie carries 8 by default). The squad below re-plans live." }),
        h("div", { class: "quick-add-row" }, quickAdd),
        h("div", { class: "seat-list" }, chips),
        h("p", { class: "btn-row" }, [
          h("button", {
            type: "button", class: "primary", text: "Plan squad ▼",
            title: "Compute the optimal assignment and jump to the result",
            on: {
              click: () => {
                const el = document.getElementById("squad-result");
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                  el.classList.remove("flash");
                  void el.offsetWidth;
                  el.classList.add("flash");
                }
              },
            },
          }),
        ]),
      ])
    );
  }

  function renderResult(main, state) {
    if (!state.roster || state.roster.length === 0) {
      main.appendChild(h("section", { class: "panel muted" }, [h("p", { text: "Load a save file to plan a squad." })]));
      return;
    }
    // One global assignment, solved optimally by the hand-written Hungarian
    // algorithm (Kuhn-Munkres) — never greedy per-seat picking.
    const result = XS.scoring.planSquad(state.roster, state.settings, {
      seats: state.settings.seats,
      solver: XS.hungarian.hungarianMax,
    });
    const filled = result.picks.filter((p) => p && p.soldier).length;
    const total = result.picks.length;
    const pickCards = result.picks.map((p) => {
      if (!p) return h("div", { class: "pick empty" }, [h("span", { text: "— empty seat —" })]);
      if (!p.soldier) {
        return h("div", { class: "pick empty" }, [
          h("span", { class: "pick-role", text: "Seat " + (p.seatIndex + 1) + " · " + (p.role ? p.role.name : p.roleId) }),
          h("span", { class: "muted", text: (p.why[0] || "unfilled") }),
        ]);
      }
      const s = p.soldier;
      const isRecruit = s.inTeam === false;
      return h("div", { class: "pick" + (p.training ? " training" : "") + (isRecruit ? " recruit-pick" : "") }, [
        h("div", { class: "pick-head" }, [
          h("span", { class: "pick-role", text: "Seat " + (p.seatIndex + 1) + " · " + p.role.name }),
          isRecruit ? h("span", { class: "recruit-flag", text: "recruit — hire first" }) : null,
          h("span", { class: "pick-name", text: s.name }),
        ]),
        h("div", { class: "pick-sub", text: (s.nationality || "") + (s.equipmentRole ? " · game role: " + s.equipmentRole : "") + (p.training ? " · training seat" : "") }),
        h("div", { class: "pick-why", text: p.why.join(" · ") }),
        h("div", {
          class: "pick-stats",
          text: XS.domain.STATS.map((st) => st + " " + (s.stats[st] == null ? "—" : s.stats[st])).join("  "),
        }),
      ]);
    });

    main.appendChild(
      h("section", { class: "panel", id: "squad-result" }, [
        h("h2", { text: "3 · Suggested squad — " + filled + " of " + total + " seats filled (optimal assignment via the Hungarian algorithm)" }),
        h("p", { class: "muted", text: "Updates live whenever seats, roles or settings change. Recruits are excluded by default." }),
        h("label", { class: "set-row check" }, [
          h("input", {
            type: "checkbox",
            checked: !!(state.settings.global && state.settings.global.includeRecruits),
            on: {
              change: (e) => {
                state.settings.global.includeRecruits = e.target.checked;
                XS.app.settingsChanged();
              },
            },
          }),
          h("span", { text: "include recruitable soldiers in the calculation (off by default — only your active team is considered)" }),
        ]),
        ...result.notices.map((n) => h("p", { class: "notice", text: n })),
        filled === 0 && total > 0
          ? h("p", { class: "notice", text: "No seat could be filled. Check the wounded threshold and role floors in Settings/Roles, or tick 'include recruitable soldiers' above." })
          : null,
        h("div", { class: "pick-grid" }, pickCards),
      ])
    );

    const bench = h("section", { class: "panel" }, [
      h("h2", { text: "Bench (" + result.bench.length + ")" }),
      result.bench.length === 0
        ? h("p", { class: "muted", text: "Nobody left on the bench." })
        : h("ul", { class: "bench" }, result.bench.map((b) => h("li", { text: b.soldier.name + " (composite " + b.composite.toFixed(2) + ")" }))),
    ]);
    main.appendChild(bench);

    if (result.ineligible.length > 0) {
      main.appendChild(
        h("section", { class: "panel" }, [
          h("h2", { text: "Ineligible (" + result.ineligible.length + ")" }),
          h("ul", { class: "bench" }, result.ineligible.map((e) => h("li", { text: e.soldier.name + " — " + e.reasons.join("; ") }))),
        ])
      );
    }
  }

  function renderSquad(main, state) {
    renderLoadPanel(main, state);
    renderInspector(main, state);
    renderTemplates(main, state);
    renderSeatBuilder(main, state);
    renderResult(main, state);
  }

  XS.ui = XS.ui || {};
  XS.ui.squad = renderSquad;
})(typeof self !== "undefined" ? self : globalThis);
