/*
 * scoring/hungarian.js — placeholder until milestone 4.
 * The real hand-written Kuhn-Munkres solver lands in milestone 4; milestone 3
 * runs the pipeline with the provisional greedy in scoring.js.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  XS.hungarian = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";
  return {
    hungarianMax(matrix) {
      throw new Error("hungarian.js is implemented in milestone 4");
    },
  };
});
