/*
 * ui/main.js — application shell: tab bar, drag-and-drop / file picker for
 * the save file, global UI state, and the render loop.
 *
 * WHY THIS SHAPE: all logic modules are pure and stateless; the only mutable
 * state in the app lives here (current roster + last parsed buffer + current
 * settings). The roster is kept in memory ONLY — soldier names are personal
 * data and are never written to localStorage. Only settings are persisted.
 *
 * PRIVACY: this file performs no network requests of any kind. The save file
 * is read with file.arrayBuffer() into memory and parsed locally.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h, clear } = XS.dom;

  const TABS = [
    { id: "squad", label: "Squad" },
    { id: "soldiers", label: "Soldiers" },
    { id: "roles", label: "Roles" },
    { id: "settings", label: "Settings" },
    { id: "calibrate", label: "Calibrate" },
    { id: "help", label: "Help" },
  ];

  /* UI state. `settings` is the single source of truth and is persisted;
   * `roster`/`lastBuffer`/`parseInfo` are session-only. */
  const state = {
    settings: XS.settings ? XS.settings.loadSettings(localStorage) : null,
    activeTab: "squad",
    roster: null, // calibrated domain soldiers
    parseInfo: null, // result of parser.inspectSave / parseSave
    lastBuffer: null, // ArrayBuffer of the last dropped file (for re-calibration)
    lastFileName: null,
    error: null,
    notices: [],
  };

  function persistSettings() {
    if (XS.settings && state.settings) XS.settings.saveSettings(localStorage, state.settings);
  }

  /*
   * Re-parse the last dropped file with the current settings (used when the
   * calibration mapping changes). The roster is rebuilt in memory only.
   */
  function reparse() {
    if (!state.lastBuffer) return;
    const res = XS.parser.parseSaveWithSettings(state.lastBuffer, state.settings);
    state.parseInfo = res;
    if (res.ok) {
      state.error = null;
      state.roster = res.soldiers || [];
      state.notices = res.notices || [];
    } else {
      state.error = res.error;
      state.roster = null;
    }
  }

  /* Called by editor tabs after mutating state.settings. */
  function settingsChanged() {
    persistSettings();
    reparse();
    rerender();
  }

  function rerender() {
    renderTabBar();
    const main = document.getElementById("tab-content");
    clear(main);
    const renderer = XS.ui[state.activeTab];
    if (renderer) renderer(main, state);
    else main.appendChild(h("p", { class: "placeholder", text: "This tab is built in a later milestone." }));
  }

  function renderTabBar() {
    const bar = document.getElementById("tab-bar");
    clear(bar);
    for (const tab of TABS) {
      bar.appendChild(
        h("button", {
          class: "tab" + (state.activeTab === tab.id ? " active" : ""),
          type: "button",
          text: tab.label,
          on: {
            click: () => {
              state.activeTab = tab.id;
              rerender();
            },
          },
        })
      );
    }
  }

  /* ---- save file input: drag-and-drop anywhere + file picker ---- */

  function handleFile(file) {
    state.lastFileName = file.name;
    state.error = null;
    // File API only: the bytes are read into memory and parsed locally.
    file
      .arrayBuffer()
      .then((buf) => {
        state.lastBuffer = buf;
        const res = XS.parser.parseSaveWithSettings(buf, state.settings);
        state.parseInfo = res;
        if (!res.ok) {
          state.error = res.error;
          state.roster = null;
        } else {
          state.error = null;
          state.roster = res.soldiers || [];
          state.notices = res.notices || [];
          state.activeTab = "squad";
        }
        rerender();
      })
      .catch((err) => {
        state.error = "Could not read the file: " + (err && err.message ? err.message : String(err));
        rerender();
      });
  }

  function setupDropZone() {
    const overlay = document.getElementById("drop-overlay");
    let dragDepth = 0;
    document.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragDepth++;
      overlay.classList.add("visible");
    });
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) overlay.classList.remove("visible");
    });
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      overlay.classList.remove("visible");
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) handleFile(files[0]);
    });
  }

  function boot() {
    document.getElementById("app-version").textContent = XS.domain.APP_VERSION;
    document.getElementById("repo-link").setAttribute("href", XS.domain.REPO_URL);
    // if a script failed to load, say so clearly instead of throwing later
    const missing = ["domain", "parser", "hungarian", "scoring", "settings", "dom"].filter((m) => !XS[m]);
    if (missing.length > 0) {
      document.getElementById("tab-content").appendChild(
        XS.dom.h("section", { class: "panel error" }, [
          XS.dom.h("h2", { text: "Scripts failed to load" }),
          XS.dom.h("p", { text: "Missing modules: " + missing.join(", ") + ". The page must be served as-is (all files present); check the browser console for the failing file." }),
        ])
      );
      return;
    }
    setupDropZone();
    rerender();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // exposed for the tab modules
  XS.ui = XS.ui || {};
  XS.app = { state, handleFile, persistSettings, settingsChanged, rerender };
})(typeof self !== "undefined" ? self : globalThis);
