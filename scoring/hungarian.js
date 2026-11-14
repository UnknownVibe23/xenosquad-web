/*
 * scoring/hungarian.js — hand-written Hungarian algorithm (Kuhn-Munkres).
 *
 * WHY HAND-WRITTEN: this is the educational centerpiece of the project and
 * the app has zero dependencies, so the solver is implemented here in plain
 * JavaScript. It solves the ASSIGNMENT PROBLEM: given a square matrix of
 * scores (rows = soldiers, columns = seats), find the one-to-one assignment
 * of rows to columns that MAXIMIZES the total score. Greedy per-seat picking
 * is not optimal — the best sniper is often also the best scout, and greedy
 * steals him for the first seat and shafts the second. The Hungarian
 * algorithm considers all seats at once and is guaranteed optimal.
 *
 * HOW IT WORKS (the version with potentials, O(n^3)):
 * We convert maximization to minimization (cost = -score) and grow a matching
 * row by row. Potentials u[i] (rows) and v[j] (columns) are dual variables that
 * keep a "reduced cost"  c'(i,j) = c(i,j) - u[i] - v[j]  >= 0 for every cell,
 * with equality on the edges of the current alternating tree. Each iteration
 * finds the cheapest column reachable from the new row through equality
 * edges, shifts the potentials by the minimum slack `delta` (which makes at
 * least one new edge tight), and augments the matching along the recorded
 * `way` pointers. After n iterations every row is matched. Because all
 * reduced costs stay >= 0 and matched edges are tight, the resulting matching
 * is a minimum-cost (here: maximum-score) perfect matching — this is the
 * Hungarian theorem.
 *
 * Forbidden cells (a soldier who cannot take a seat) are passed in as very
 * negative scores (-1e9); their cost is huge, so the solver avoids them
 * unless it is forced to (more constrained seats than candidates).
 *
 * Purity: pure function, matrix in -> assignment out. Deterministic.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  XS.hungarian = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  /*
   * hungarianMax(matrix) -> rowCol
   * matrix: square (or rectangular — padded to square with 0 dummy cells,
   * which for a maximization means "worth 0", i.e. absorb leftovers) array of
   * arrays of numbers, matrix[i][j] = score of assigning row i to column j.
   * Returns rowCol where rowCol[i] = column assigned to row i (-1 if none).
   */
  function hungarianMax(matrix) {
    if (!matrix || matrix.length === 0) return [];
    // Defensively pad to square with 0s (production always passes square
    // matrices from buildScoreMatrix; tests may pass rectangular ones).
    const rows = matrix.length;
    const cols = matrix[0].length;
    const n = Math.max(rows, cols);
    const a = [];
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      for (let j = 0; j < Math.min(cols, n); j++) row[j] = matrix[i] ? matrix[i][j] : 0;
      a.push(row);
    }

    const INF = Infinity;
    // 1-indexed working arrays (index 0 is a sentinel).
    const u = new Array(n + 1).fill(0); // row potentials
    const v = new Array(n + 1).fill(0); // column potentials
    const p = new Array(n + 1).fill(0); // p[j] = row currently matched to column j
    const way = new Array(n + 1).fill(0); // way[j] = previous column on the path to j

    for (let i = 1; i <= n; i++) {
      p[0] = i; // start a new alternating tree from row i
      let j0 = 0;
      const minv = new Array(n + 1).fill(INF); // min reduced cost per column
      const used = new Array(n + 1).fill(false); // columns already in the tree
      do {
        used[j0] = true;
        const i0 = p[j0]; // row matched to column j0 (i0 = i for j0 = 0)
        let delta = INF;
        let j1 = 0;
        // Scan all columns not yet in the tree: relax reduced costs.
        for (let j = 1; j <= n; j++) {
          if (used[j]) continue;
          const cur = -a[i0 - 1][j - 1] - u[i0] - v[j]; // reduced cost of edge (i0, j)
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
        // Shift potentials by delta: tight edges stay tight, the cheapest
        // edge becomes tight too, and all reduced costs remain >= 0.
        for (let j = 0; j <= n; j++) {
          if (used[j]) {
            u[p[j]] += delta;
            v[j] -= delta;
          } else {
            minv[j] -= delta;
          }
        }
        j0 = j1; // grow the tree through the cheapest column
      } while (p[j0] !== 0); // until we reach a free column
      // Augment: walk the recorded path backwards and flip the matching.
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0 !== 0);
    }

    // p[j] = row matched to column j -> invert into rowCol.
    const rowCol = new Array(n).fill(-1);
    for (let j = 1; j <= n; j++) {
      if (p[j] > 0) rowCol[p[j] - 1] = j - 1;
    }
    // Trim back to the original number of rows.
    return rowCol.slice(0, rows);
  }

  /* Total score of an assignment rowCol for matrix. */
  function totalScore(matrix, rowCol) {
    let sum = 0;
    for (let i = 0; i < rowCol.length; i++) {
      const j = rowCol[i];
      if (j >= 0 && matrix[i] && j < matrix[i].length) sum += matrix[i][j];
    }
    return sum;
  }

  return { hungarianMax, totalScore };
});
