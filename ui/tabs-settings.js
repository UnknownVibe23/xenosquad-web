/*
 * ui/tabs-settings.js — Settings tab: every global parameter, the save-format
 * parameters, settings export/import (JSON round-trip), per-section resets,
 * reset-all, and the prominent "Clear all my data" button.
 *
 * Privacy: settings are the ONLY thing persisted (localStorage, namespaced
 * "xenosquad-web.", never cookies). The roster is never persisted. Export
 * produces a user-initiated download; import reads a user-picked file and is
 * validated with clear errors. "Clear all my data" wipes the whole namespace
 * and the in-memory roster.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h } = XS.dom;

  function numField(label, value, onChange, attrs) {
    return h("label", { class: "set-row" }, [
      h("span", { text: label }),
      h("input", Object.assign({ type: "number", step: "any", value: String(value), on: { change: (e) => onChange(parseFloat(e.target.value)) } }, attrs || {})),
    ]);
  }

  function checkField(label, checked, onChange) {
    return h("label", { class: "set-row check" }, [
      h("input", { type: "checkbox", checked, on: { change: (e) => onChange(e.target.checked) } }),
      h("span", { text: label }),
    ]);
  }

  function renderSettings(main, state) {
    const app = XS.app;
    const s = state.settings;
    const g = s.global;
    const f = s.format;

    // ---- global behavior (grouped) ----
    const thresholdOut = h("output", { class: "w-out", text: String(g.woundedThreshold) });
    const encOut = h("output", { class: "w-out", text: String(g.encumbranceLimit) });
    const sliderRow = (label, value, out, min, max, step, onInput) =>
      h("label", { class: "set-row" }, [
        h("span", { text: label }),
        h("input", {
          type: "range", min: String(min), max: String(max), step: String(step), value: String(value),
          on: {
            input: (e) => { onInput(parseFloat(e.target.value)); out.textContent = e.target.value; app.persistSettings(); },
            change: () => app.settingsChanged(),
          },
        }),
        out,
      ]);
    const group = (title, children) => h("div", { class: "set-group" }, [h("h3", { text: title }), h("div", { class: "set-grid" }, children)]);

    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Global behavior" }),
        group("Eligibility", [
          sliderRow("Wounded threshold — soldiers below this fraction of HP cannot be fielded", g.woundedThreshold, thresholdOut, 0, 1, 0.05, (v) => { g.woundedThreshold = v; }),
        ]),
        group("Encumbrance & strength — capacity = base + coef × STR (kg)", [
          sliderRow("Encumbrance limit — kit above this fraction of capacity costs TUs (1.0 = only when over full capacity)", g.encumbranceLimit, encOut, 0, 1, 0.05, (v) => { g.encumbranceLimit = v; }),
          numField("Capacity base (kg)", g.strCapacityBase, (v) => { if (Number.isFinite(v)) { g.strCapacityBase = v; app.settingsChanged(); } }),
          numField("Capacity per STR point (kg) — game default 0.3", g.strCapacityCoef, (v) => { if (Number.isFinite(v)) { g.strCapacityCoef = v; app.settingsChanged(); } }),
          numField("STR training threshold (fraction of capacity; strength-training roles load past this to train STR)", g.strTrainThreshold, (v) => { if (Number.isFinite(v)) { g.strTrainThreshold = v; app.settingsChanged(); } }),
        ]),
        group("Psi era (late game)", [
          checkField("Psi era — frontline roles then require the BRV floor below", g.psiEra, (v) => { g.psiEra = v; app.settingsChanged(); }),
          numField("BRV floor for frontline roles while psi era is on", g.psiBrvFloor, (v) => { if (Number.isFinite(v)) { g.psiBrvFloor = v; app.settingsChanged(); } }),
        ]),
        group("Training seat", [
          checkField("Reserve one seat for the lowest-composite healthy soldier (rookies ride along)", g.trainingSeat, (v) => { g.trainingSeat = v; app.settingsChanged(); }),
          numField("Which seat is the training seat (-1 = first seat)", g.trainingSeatIndex, (v) => { if (Number.isFinite(v)) { g.trainingSeatIndex = Math.trunc(v); app.settingsChanged(); } }),
        ]),
        group("Recruits", [
          checkField("Include recruitable soldiers in the calculation (off = active team only; picked recruits are marked 'hire first')", !!g.includeRecruits, (v) => { g.includeRecruits = v; app.settingsChanged(); }),
        ]),
        h("p", {}, [h("button", { type: "button", text: "Reset global to defaults", on: { click: () => { XS.settings.resetSection(s, "global"); app.settingsChanged(); } } })]),
      ])
    );

    // ---- sections: calibration/roles/templates/seats resets ----
    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Sections" }),
        h("p", { class: "muted", text: "Reset individual sections to their built-in defaults. Calibration is edited in the Calibrate tab; roles in Roles; templates and seats in the Squad tab." }),
        h("div", { class: "btn-row" }, [
          ["calibration", "Reset calibration"],
          ["roles", "Reset roles"],
          ["templates", "Reset templates"],
          ["seats", "Reset seats"],
        ].map(([sec, label]) =>
          h("button", {
            type: "button",
            text: label,
            on: { click: () => { XS.settings.resetSection(s, sec); app.settingsChanged(); } },
          })
        )),
      ])
    );

    // ---- data: export / import / reset all / clear all ----
    const status = h("p", { class: "muted", text: "" });
    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Data & privacy" }),
        h("p", {
          class: "muted",
          text: "Only settings are stored (localStorage, prefix \"xenosquad-web.\", never cookies). The roster is never persisted. The app makes no network requests at all. Export downloads a JSON file you initiate; import validates it and reports errors.",
        }),
        h("div", { class: "btn-row" }, [
          h("button", {
            type: "button",
            text: "Export settings as JSON",
            on: {
              click: () => {
                const blob = new Blob([XS.settings.serialize(s)], { type: "application/json" });
                const a = h("a", { href: URL.createObjectURL(blob), download: "xenosquad-web-settings.json" });
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(a.getAttribute("href")), 5000);
                status.textContent = "Exported settings to xenosquad-web-settings.json.";
              },
            },
          }),
          h("label", {
            class: "button-like",
            text: "Import settings from JSON…",
          }, [
            h("input", {
              type: "file",
              accept: ".json,application/json",
              style: "display:none",
              on: {
                change: (e) => {
                  const file = e.target.files && e.target.files[0];
                  e.target.value = "";
                  if (!file) return;
                  file.text().then((text) => {
                    const res = XS.settings.deserialize(text);
                    if (!res.ok) {
                      status.textContent = "Import failed: " + res.errors.join("; ");
                      status.className = "error-text";
                      return;
                    }
                    state.settings = res.settings;
                    app.settingsChanged();
                    status.textContent = "Imported settings successfully.";
                    status.className = "ok-text";
                  });
                },
              },
            }),
          ]),
          h("button", {
            type: "button",
            text: "Reset all to defaults",
            on: {
              click: () => {
                if (!root.confirm("Reset ALL settings (roles, templates, seats, format, calibration, global) to defaults?")) return;
                state.settings = XS.settings.defaultSettings();
                app.settingsChanged();
                status.textContent = "All settings reset to defaults.";
                status.className = "ok-text";
              },
            },
          }),
          h("button", {
            type: "button",
            class: "danger",
            text: "Clear all my data",
            on: {
              click: () => {
                if (!root.confirm("Wipe everything this site stored (the xenosquad-web.* localStorage namespace) and clear the loaded roster from memory?")) return;
                XS.settings.clearNamespace(localStorage);
                state.settings = XS.settings.defaultSettings();
                state.roster = null;
                state.lastBuffer = null;
                state.parseInfo = null;
                state.lastFileName = null;
                state.error = null;
                state.notices = [];
                app.rerender();
                status.textContent = "All local data cleared. Settings are back to defaults; drop a save file to start over.";
                status.className = "ok-text";
              },
            },
          }),
        ]),
        status,
      ])
    );
  }

  XS.ui = XS.ui || {};
  XS.ui.settings = renderSettings;
})(typeof self !== "undefined" ? self : globalThis);
