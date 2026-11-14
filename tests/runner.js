/*
 * tests/runner.js — browser test runner for tests.html.
 * Executes the registered suite (XSTest.runAll) and prints pass/fail per
 * test plus a summary into the page. Exposes window.__TEST_RESULTS__ so the
 * run can be inspected programmatically.
 */
(function (root) {
  "use strict";
  const { h, clear } = root.XS.dom;

  function boot() {
    const results = root.XSTest.runAll();
    root.__TEST_RESULTS__ = results;
    const passed = results.filter((r) => r.ok).length;
    const main = document.getElementById("results");
    clear(main);
    main.appendChild(
      h("h2", {
        class: passed === results.length ? "pass" : "fail",
        text: passed + " / " + results.length + " tests passed",
      })
    );
    for (const r of results) {
      main.appendChild(
        h("div", { class: "test " + (r.ok ? "pass" : "fail") }, [
          h("span", { class: "mark", text: r.ok ? "PASS" : "FAIL" }),
          h("span", { class: "name", text: r.name }),
          r.ok ? null : h("pre", { class: "err", text: r.error }),
        ])
      );
    }
    document.title = passed === results.length ? "tests: all " + results.length + " passed" : "tests: " + (results.length - passed) + " failed";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof self !== "undefined" ? self : globalThis);
