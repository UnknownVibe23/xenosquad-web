/*
 * tests/hungarian.test.js — tests for the hand-written Hungarian solver.
 *
 * Includes the "two roles want the same soldier" case (where greedy fails),
 * and — in TESTS ONLY — a brute-force check of optimality on small random
 * matrices by enumerating all permutations. The brute-force path never ships
 * in the production solver; scoring.js only ever calls hungarianMax.
 */
(function (root) {
  "use strict";
  const { test } = root.XSTest;
  const XS = root.XS;

  /* TEST-ONLY brute force: max total over all permutations of columns. */
  function bruteForceMax(matrix) {
    const n = matrix.length;
    let best = -Infinity;
    const perm = Array.from({ length: n }, (_, i) => i);
    function* permutations(arr) {
      if (arr.length <= 1) { yield arr.slice(); return; }
      for (let i = 0; i < arr.length; i++) {
        const rest = arr.slice(0, i).concat(arr.slice(i + 1));
        for (const p of permutations(rest)) yield [arr[i]].concat(p);
      }
    }
    for (const p of permutations(perm)) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += matrix[i][p[i]];
      if (sum > best) best = sum;
    }
    return best;
  }

  /* Deterministic PRNG (same as the fixture generator's). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test("hungarian: empty matrix -> empty assignment", (t) => {
    t.deepEqual(XS.hungarian.hungarianMax([]), []);
  });

  test("hungarian: simple 2x2 maximization picks the optimal pairing", (t) => {
    // row0: [10, 9], row1: [8, 1]. Optimal: row0->col1 (9) + row1->col0 (8) = 17.
    const m = [
      [10, 9],
      [8, 1],
    ];
    const rowCol = XS.hungarian.hungarianMax(m);
    t.equal(XS.hungarian.totalScore(m, rowCol), 17);
    t.equal(rowCol[0], 1);
    t.equal(rowCol[1], 0);
  });

  test("hungarian: 'two roles want the same soldier' — beats greedy", (t) => {
    // Soldier A is the best sniper AND the best scout; greedy (sniper seat
    // first) assigns A to sniper and gets B for scout = 10 + 1 = 11.
    // Optimal: A takes scout (9), B takes sniper (8) = 17.
    const m = [
      [10, 9], // soldier A: sniper 10, scout 9
      [8, 1], //  soldier B: sniper 8,  scout 1
    ];
    const greedy = XS.scoring.greedyAssign(m);
    const hung = XS.hungarian.hungarianMax(m);
    t.equal(XS.hungarian.totalScore(m, greedy), 11, "greedy total is 11 here");
    t.equal(XS.hungarian.totalScore(m, hung), 17, "hungarian finds the global optimum 17");
    t.notEqual(hung[0], greedy[0], "hungarian does NOT give the sniper seat to A");
  });

  test("hungarian: 3x3 hand-checked optimum", (t) => {
    const m = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    // brute force says: row0->col0(4), row1->col2(5), row2->col1(2) = 11
    const rowCol = XS.hungarian.hungarianMax(m);
    t.equal(XS.hungarian.totalScore(m, rowCol), 11);
    t.equal(XS.hungarian.totalScore(m, rowCol), bruteForceMax(m));
  });

  test("hungarian: matches brute force on many random small matrices (with forbidden cells)", (t) => {
    const rnd = mulberry32(20261114);
    for (let trial = 0; trial < 60; trial++) {
      const n = 1 + Math.floor(rnd() * 5); // sizes 1..5 (permutations stay cheap)
      const m = [];
      for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j < n; j++) {
          // mostly small scores, sometimes a forbidden cell
          row.push(rnd() < 0.15 ? -1e9 : Math.floor(rnd() * 20));
        }
        m.push(row);
      }
      const hung = XS.hungarian.hungarianMax(m);
      const total = XS.hungarian.totalScore(m, hung);
      const brute = bruteForceMax(m);
      t.approx(total, brute, 1e-6, "trial " + trial + " n=" + n + " matrix " + JSON.stringify(m));
      // assignment must be a valid one-to-one matching
      const cols = hung.filter((x) => x >= 0);
      t.equal(new Set(cols).size, cols.length, "no column used twice (trial " + trial + ")");
    }
  });

  test("hungarian: rectangular matrices are padded and still optimal", (t) => {
    // 2 rows x 3 cols: one seat must go unfilled (dummy column absorbs it)
    const m = [
      [5, 1, 4],
      [2, 9, 3],
    ];
    const rowCol = XS.hungarian.hungarianMax(m);
    t.equal(rowCol.length, 2);
    // optimal on the padded square: row0->col0 (5), row1->col1 (9) = 14
    t.equal(XS.hungarian.totalScore(m, rowCol), 14);
    // 3 rows x 2 cols: one soldier benched
    const m2 = [
      [5, 1],
      [2, 9],
      [7, 7],
    ];
    const rowCol2 = XS.hungarian.hungarianMax(m2);
    t.equal(XS.hungarian.totalScore(m2, rowCol2), 16, "row0->col0(5) + row2->col1(7)... optimum is 5+9 or 7+9 -> check");
  });

  test("hungarian: determinism — same matrix, same assignment", (t) => {
    const rnd = mulberry32(7);
    const m = [];
    for (let i = 0; i < 6; i++) {
      const row = [];
      for (let j = 0; j < 6; j++) row.push(Math.floor(rnd() * 50));
      m.push(row);
    }
    t.deepEqual(XS.hungarian.hungarianMax(m), XS.hungarian.hungarianMax(m));
  });

  test("hungarian: planSquad with the solver beats greedy and fills every fillable seat", (t) => {
    const { bytes } = XS.fixture.buildFixtureSave({ seed: 101, soldiers: 12 });
    const settings = XS.settings.defaultSettings();
    settings.global.woundedThreshold = 0;
    const res = XS.parser.parseSaveWithSettings(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), settings);
    const sum = (r) => r.picks.reduce((s, p) => s + (p && p.soldier && typeof p.score === "number" ? p.score : 0), 0);
    const hung = XS.scoring.planSquad(res.soldiers, settings, { seats: settings.seats, solver: XS.hungarian.hungarianMax });
    const greedy = XS.scoring.planSquad(res.soldiers, settings, { seats: settings.seats, solver: XS.scoring.greedyAssign });
    const hungFilled = hung.picks.filter((p) => p && p.soldier).length;
    const greedyFilled = greedy.picks.filter((p) => p && p.soldier).length;
    t.ok(hungFilled >= greedyFilled, "hungarian fills at least as many seats as greedy (" + hungFilled + " vs " + greedyFilled + ")");
    t.ok(sum(hung) >= sum(greedy) - 1e-9, "hungarian total score >= greedy total");
    t.equal(new Set(hung.picks.filter((p) => p && p.soldier).map((p) => p.soldier.id)).size, hungFilled, "one soldier per seat");
    // with floors removed, all 12 soldiers are eligible for every seat, so
    // all 8 seats MUST be filled — this is the true optimal fill count
    const noFloors = XS.settings.defaultSettings();
    noFloors.global.woundedThreshold = 0;
    noFloors.roles = noFloors.roles.map((r) => XS.domain.makeRole(Object.assign({}, r, { floors: {}, kitWeight: 0 })));
    const res2 = XS.parser.parseSaveWithSettings(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), noFloors);
    const all = XS.scoring.planSquad(res2.soldiers, noFloors, { seats: noFloors.seats, solver: XS.hungarian.hungarianMax });
    t.equal(all.picks.filter((p) => p && p.soldier).length, 8, "all 8 seats filled when everyone is eligible");
  });
})(typeof self !== "undefined" ? self : globalThis);
