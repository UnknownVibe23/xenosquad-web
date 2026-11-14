/*
 * tests/helpers.js — tiny hand-written, zero-dependency test kit.
 *
 * A test file just calls test(name, fn). The fn receives an assert object `t`
 * (ok / notOk / equal / deepEqual / approx / throws) and throws on failure.
 *
 * Two runners use the SAME test files:
 *   - browser: tests/tests.html loads helpers.js + the test files, then
 *     tests/runner.js executes XSTest.runAll() and prints pass/fail per test
 *     into the page (the canonical suite);
 *   - Node: tests/node/suite.test.js calls XSTest.bindNode(node:test) before
 *     requiring the test files, so `node --test tests/node/` runs the same
 *     suite as a convenience.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  root.XSTest = api;
  XS.test = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const tests = [];
  let forward = null; // when set (Node mode), test() forwards to node:test

  function test(name, fn) {
    if (forward) forward(name, fn);
    else tests.push({ name, fn });
  }

  function deepEq(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a == null || b == null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
      return true;
    }
    if (typeof a === "object") {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (const k of ka) if (!deepEq(a[k], b[k])) return false;
      return true;
    }
    return false;
  }

  function fmt(v) {
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }

  /* Assert object handed to each test function. */
  function makeT() {
    function fail(msg) {
      throw new Error(msg || "assertion failed");
    }
    return {
      ok(v, msg) {
        if (!v) fail(msg || "expected truthy, got " + fmt(v));
      },
      notOk(v, msg) {
        if (v) fail(msg || "expected falsy, got " + fmt(v));
      },
      equal(a, b, msg) {
        if (a !== b) fail((msg ? msg + ": " : "") + "expected " + fmt(b) + " but got " + fmt(a));
      },
      deepEqual(a, b, msg) {
        if (!deepEq(a, b)) fail((msg ? msg + ": " : "") + "deepEqual failed\n  actual:   " + fmt(a) + "\n  expected: " + fmt(b));
      },
      approx(a, b, eps, msg) {
        if (typeof a !== "number" || Math.abs(a - b) > (eps == null ? 1e-9 : eps)) {
          fail((msg ? msg + ": " : "") + "expected ~" + fmt(b) + " but got " + fmt(a));
        }
      },
      throws(fn, msg) {
        let threw = false;
        try {
          fn();
        } catch (e) {
          threw = true;
        }
        if (!threw) fail(msg || "expected function to throw");
      },
    };
  }

  /* Browser runner: execute every registered test, return per-test results. */
  function runAll() {
    return tests.map(({ name, fn }) => {
      try {
        fn(makeT());
        return { name, ok: true, error: null };
      } catch (e) {
        return { name, ok: false, error: String((e && e.message) || e) };
      }
    });
  }

  /* Node mode: forward registrations to node:test. */
  function bindNode(nodeTest) {
    forward = (name, fn) => nodeTest(name, () => fn(makeT()));
  }

  return { test, runAll, makeT, bindNode, deepEq, list: tests };
});
