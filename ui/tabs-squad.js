/*
 * ui/tabs-squad.js — Squad tab (milestone 1: save inspector).
 *
 * Shows what was found in the dropped file: file name and size, the save
 * name and in-game date from the header, how many SoldierFlags markers were
 * found, and how many soldier blocks that means — plus a readable error when
 * the file is not a Xenonauts save. Later milestones add the seat builder and
 * the planned squad below this panel.
 */
(function (root) {
  "use strict";
  const XS = root.XS;
  const { h } = XS.dom;

  function renderSquad(main, state) {
    const app = XS.app;

    const intro = h("section", { class: "panel" }, [
      h("h2", { text: "1 · Load a save file" }),
      h("p", {
        text: "Drag a Xenonauts save file (.sav) anywhere onto this page, or pick one. The file is opened and parsed locally in your browser — it is never uploaded anywhere (there is no server).",
      }),
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
    ]);
    main.appendChild(intro);

    if (state.error) {
      main.appendChild(h("section", { class: "panel error" }, [h("h2", { text: "Could not read that file" }), h("p", { text: state.error })]));
      return;
    }

    if (!state.parseInfo || !state.parseInfo.ok) {
      main.appendChild(
        h("section", { class: "panel muted" }, [h("p", { text: "No save loaded yet. Drop a file (for example planner.sav) to inspect it." })])
      );
      return;
    }

    const info = state.parseInfo;
    const header = info.header || {};
    const rows = [
      ["File name", state.lastFileName || "(unknown)"],
      ["File size", state.lastBuffer ? state.lastBuffer.byteLength.toLocaleString() + " bytes" : "—"],
      ["Save name (header)", header.saveName || "—"],
      ["In-game date (header)", header.gameDate || "—"],
      ["Real-world timestamp (header)", header.realDate || "—"],
      ['Marker "' + (info.format ? info.format.marker : "SoldierFlags") + '" occurrences', String(info.markerCount)],
      ["Soldier blocks found", String(info.markerCount)],
    ];
    const table = h(
      "table",
      { class: "kv" },
      rows.map((r) => h("tr", {}, [h("th", { text: r[0] }), h("td", { text: r[1] })]))
    );
    main.appendChild(h("section", { class: "panel" }, [h("h2", { text: "2 · Save inspection" }), table]));
  }

  XS.ui = XS.ui || {};
  XS.ui.squad = renderSquad;
})(typeof self !== "undefined" ? self : globalThis);
