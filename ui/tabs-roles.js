/*
 * ui/tabs-roles.js — Roles tab: the role doctrine editor.
 *
 * Roles are data, not code: every property (weights, floors, kit_weight,
 * trains, frontline, strength_training) is editable here with live controls,
 * and roles can be added, duplicated, renamed and deleted. Changes persist to
 * settings immediately; slider 'input' events update the model + storage
 * without re-rendering (so dragging stays smooth), 'change' events trigger a
 * full re-parse + re-render.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h } = XS.dom;

  function renderRoles(main, state) {
    const app = XS.app;
    const roles = state.settings.roles;

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Role doctrine (" + roles.length + " roles)" }),
        h("p", {
          class: "muted",
          text: "Each role defines stat weights (how much each stat matters for the seat), floors (minimum raw stats), kit weight (for the encumbrance check — STR capacity must cover it up to the encumbrance limit, unless strength training inverts the check), trains (stats the seat trains — second tie-breaker), and frontline (subject to the BRV floor while the psi era is on). Selection is purely stats-based; the game's own equipment role is only a display hint.",
        }),
        h("p", {}, [
          h("button", {
            type: "button",
            text: "+ Add role",
            on: {
              click: () => {
                roles.push(XS.domain.makeRole({ name: "New role " + (roles.length + 1), weights: { ACC: 1 } }));
                app.settingsChanged();
              },
            },
          }),
        ]),
      ])
    );

    for (const role of roles) {
      // Layout: [stat name][value box][slider] on ONE row per stat, single
      // column — the value always directly follows its own stat name, never
      // lands beside the next stat's label.
      const weightRows = XS.domain.STATS.map((st) => {
        const out = h("output", { class: "w-out", text: String(role.weights[st] || 0) });
        return h("label", { class: "w-row" }, [
          h("span", { class: "w-name", text: st }),
          out,
          h("input", {
            type: "range",
            min: "0",
            max: "5",
            step: "0.5",
            value: String(role.weights[st] || 0),
            "aria-label": "weight of " + st + " for " + role.name,
            on: {
              input: (e) => {
                role.weights[st] = parseFloat(e.target.value);
                out.textContent = e.target.value;
                app.persistSettings(); // live persist without re-render (smooth dragging)
              },
              change: () => app.settingsChanged(),
            },
          }),
        ]);
      });

      const floorInputs = XS.domain.STATS.map((st) =>
        h("label", { class: "f-row" }, [
          h("span", { class: "w-name", text: st }),
          h("input", {
            type: "number",
            value: role.floors[st] != null ? String(role.floors[st]) : "",
            placeholder: "none",
            "aria-label": "floor of " + st + " for " + role.name,
            on: {
              change: (e) => {
                const v = e.target.value.trim();
                if (v === "") delete role.floors[st];
                else role.floors[st] = parseFloat(v);
                app.settingsChanged();
              },
            },
          }),
        ])
      );

      const trainBoxes = XS.domain.STATS.map((st) =>
        h("label", { class: "t-box" }, [
          h("input", {
            type: "checkbox",
            checked: role.trains.indexOf(st) !== -1,
            on: {
              change: (e) => {
                if (e.target.checked) { if (role.trains.indexOf(st) === -1) role.trains.push(st); }
                else role.trains = role.trains.filter((x) => x !== st);
                app.settingsChanged();
              },
            },
          }),
          h("span", { text: st }),
        ])
      );

      const card = h("section", { class: "panel role-card" }, [
        h("div", { class: "role-head" }, [
          h("input", {
            type: "text",
            class: "role-name",
            value: role.name,
            "aria-label": "role name",
            on: { change: (e) => { role.name = e.target.value || role.id; app.settingsChanged(); } },
          }),
          h("span", { class: "muted small", text: "id: " + role.id }),
          h("span", { class: "role-btns" }, [
            h("button", {
              type: "button",
              text: "Duplicate",
              on: {
                click: () => {
                  const copy = XS.domain.makeRole(Object.assign({}, role, { id: role.id + "-copy-" + Date.now() % 100000, name: role.name + " (copy)" }));
                  roles.splice(roles.indexOf(role) + 1, 0, copy);
                  app.settingsChanged();
                },
              },
            }),
            h("button", {
              type: "button",
              class: "danger",
              text: "Delete",
              disabled: roles.length <= 1,
              on: {
                click: () => {
                  if (roles.length <= 1) return;
                  if (!root.confirm('Delete role "' + role.name + '"? Seats using it will have no role.')) return;
                  roles.splice(roles.indexOf(role), 1);
                  app.settingsChanged();
                },
              },
            }),
          ]),
        ]),
        h("h3", { text: "Weights (stat → weight)" }),
        h("div", { class: "w-grid" }, weightRows),
        h("h3", { text: "Floors (minimum raw stat, empty = none)" }),
        h("div", { class: "f-grid" }, floorInputs),
        h("div", { class: "role-misc" }, [
          h("label", { class: "f-row" }, [
            h("span", { class: "w-name", text: "kit weight", title: "Approximate equipment weight for the encumbrance check — editable, since your equipment (and so kit weight) changes over the campaign" }),
            h("input", {
              type: "number",
              min: "0",
              step: "1",
              value: String(role.kitWeight),
              "aria-label": "kit weight",
              on: { change: (e) => { role.kitWeight = parseFloat(e.target.value) || 0; app.settingsChanged(); } },
            }),
          ]),
          h("label", { class: "t-box" }, [
            h("input", {
              type: "checkbox",
              checked: role.frontline,
              on: { change: (e) => { role.frontline = e.target.checked; app.settingsChanged(); } },
            }),
            h("span", { text: "frontline (psi-era BRV floor)" }),
          ]),
          h("label", { class: "t-box" }, [
            h("input", {
              type: "checkbox",
              checked: role.strengthTraining,
              on: { change: (e) => { role.strengthTraining = e.target.checked; app.settingsChanged(); } },
            }),
            h("span", { text: "strength training (invert encumbrance check)" }),
          ]),
        ]),
        h("h3", { text: "Trains (tie-breaker)" }),
        h("div", { class: "t-grid" }, trainBoxes),
      ]);
      main.appendChild(card);
    }
  }

  XS.ui = XS.ui || {};
  XS.ui.roles = renderRoles;
})(typeof self !== "undefined" ? self : globalThis);
