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

    // ---- global behavior ----
    const thresholdOut = h("output", { class: "w-out", text: String(g.woundedThreshold) });
    const encOut = h("output", { class: "w-out", text: String(g.encumbranceLimit) });
    main.appendChild(
      h("section", { class: "panel" }, [
        h("h2", { text: "Global behavior" }),
        h("div", { class: "set-grid" }, [
          h("label", { class: "set-row" }, [
            h("span", { text: "Wounded threshold (HP fraction)" }),
            h("input", {
              type: "range", min: "0", max: "1", step: "0.05", value: String(g.woundedThreshold),
              on: {
                input: (e) => { g.woundedThreshold = parseFloat(e.target.value); thresholdOut.textContent = e.target.value; app.persistSettings(); },
                change: () => app.settingsChanged(),
              },
            }),
            thresholdOut,
          ]),
          h("label", { class: "set-row" }, [
            h("span", { text: "Encumbrance limit (fraction of capacity; 1.0 = TU penalty only above full capacity)" }),
            h("input", {
              type: "range", min: "0", max: "1", step: "0.05", value: String(g.encumbranceLimit),
              on: {
                input: (e) => { g.encumbranceLimit = parseFloat(e.target.value); encOut.textContent = e.target.value; app.persistSettings(); },
                change: () => app.settingsChanged(),
              },
            }),
            encOut,
          ]),
          numField("STR capacity base (kg)", g.strCapacityBase, (v) => { if (Number.isFinite(v)) { g.strCapacityBase = v; app.settingsChanged(); } }),
          numField("STR capacity per STR point (kg) — capacity = base + coef × STR (game: 8 + 0.3×STR)", g.strCapacityCoef, (v) => { if (Number.isFinite(v)) { g.strCapacityCoef = v; app.settingsChanged(); } }),
          numField("STR training threshold (fraction of capacity; used by strength-training roles)", g.strTrainThreshold, (v) => { if (Number.isFinite(v)) { g.strTrainThreshold = v; app.settingsChanged(); } }),
          checkField("Psi era (late-game psi threats)", g.psiEra, (v) => { g.psiEra = v; app.settingsChanged(); }),
          numField("Psi-era BRV floor for frontline roles", g.psiBrvFloor, (v) => { if (Number.isFinite(v)) { g.psiBrvFloor = v; app.settingsChanged(); } }),
          checkField("Training seat (lowest-composite healthy soldier rides along)", g.trainingSeat, (v) => { g.trainingSeat = v; app.settingsChanged(); }),
          numField("Training seat index (-1 = first seat)", g.trainingSeatIndex, (v) => { if (Number.isFinite(v)) { g.trainingSeatIndex = Math.trunc(v); app.settingsChanged(); } }),
          checkField("Include recruitable soldiers in planning (default: active team only)", !!g.includeRecruits, (v) => { g.includeRecruits = v; app.settingsChanged(); }),
        ]),
        h("p", {}, [h("button", { type: "button", text: "Reset global to defaults", on: { click: () => { XS.settings.resetSection(s, "global"); app.settingsChanged(); } } })]),
      ])
    );

    // ---- save format (advanced, collapsed: verified, rarely touched) ----
    main.appendChild(
      h("details", { class: "panel advanced" }, [
        h("summary", { text: "Advanced — save format parameters (verified against the current game build; only change if your game version differs)" }),
        h("p", { class: "muted", text: "These describe the binary layout the parser scans for. They live in settings so a game patch that shifts offsets never needs a code change. Changing them re-parses the loaded file immediately." }),
        h("div", { class: "set-grid" }, [
          h("label", { class: "set-row" }, [
            h("span", { text: 'Marker string (scanned in raw bytes)' }),
            h("input", { type: "text", value: f.marker, on: { change: (e) => { f.marker = e.target.value || "SoldierFlags"; app.settingsChanged(); } } }),
          ]),
          numField("Expected stat count (ints per soldier block)", f.statCount, (v) => { if (Number.isInteger(v) && v >= 0 && v <= 64) { f.statCount = v; app.settingsChanged(); } }),
          numField("Current-HP float offset (bytes after the stats)", f.hpFloatOffset, (v) => { if (Number.isInteger(v) && v >= 0 && v <= 4096) { f.hpFloatOffset = v; app.settingsChanged(); } }),
          numField("Float scan window (bytes after stats, fallback)", f.floatScanBytes, (v) => { if (Number.isFinite(v) && v >= 0) { f.floatScanBytes = Math.trunc(v); app.settingsChanged(); } }),
          numField("String scan window (bytes after stats)", f.stringScanBytes, (v) => { if (Number.isFinite(v) && v >= 0) { f.stringScanBytes = Math.trunc(v); app.settingsChanged(); } }),
          h("label", { class: "set-row" }, [
            h("span", { text: "Team string prefix (block containing it = active team; empty = no distinction)" }),
            h("input", {
              type: "text",
              value: f.teamStringPrefix,
              placeholder: "weapon.",
              on: { change: (e) => { f.teamStringPrefix = e.target.value; app.settingsChanged(); } },
            }),
          ]),
          h("label", { class: "set-row" }, [
            h("span", { text: "Equipment role names (comma-separated)" }),
            h("input", {
              type: "text",
              value: (f.roleNames || []).join(", "),
              on: {
                change: (e) => {
                  f.roleNames = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                  app.settingsChanged();
                },
              },
            }),
          ]),
        ]),
        h("p", {}, [h("button", { type: "button", text: "Reset format to defaults", on: { click: () => { XS.settings.resetSection(s, "format"); app.settingsChanged(); } } })]),
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
