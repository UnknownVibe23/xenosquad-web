/*
 * tools/fixture-generator.js — synthetic Xenonauts save fixture generator.
 *
 * WHY: the repository must never contain a real save file or real soldier
 * names, so all parser tests use a fake save built here with invented names
 * ("Test Soldier 1", ...). The generator reproduces the exact binary
 * encoding observed in a real planner.sav: length-prefixed ASCII strings,
 * LE int32, LE float32, the "SoldierFlags" marker per soldier, the record
 * layout, and a small header. It is a pure module (bytes in memory out), so
 * the browser test suite can build fixtures without any file, and Node can
 * write one to disk via tools/make-fixture.js.
 *
 * Determinism: a seeded PRNG (mulberry32) makes every test run identical.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  XS.fixture = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function (XS) {
  "use strict";

  /* Small deterministic PRNG so fixtures are reproducible. */
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

  /* Byte writer mirroring the engine's serialization. */
  function ByteWriter() {
    this.parts = [];
    this.length = 0;
  }
  ByteWriter.prototype.u8 = function (b) {
    this.parts.push(Uint8Array.of(b & 0xff));
    this.length += 1;
  };
  ByteWriter.prototype.i32 = function (v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    this.parts.push(b);
    this.length += 4;
  };
  ByteWriter.prototype.f32 = function (v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.parts.push(b);
    this.length += 4;
  };
  ByteWriter.prototype.str = function (s) {
    const bytes = new TextEncoder().encode(s);
    this.i32(bytes.length);
    this.parts.push(bytes);
    this.length += bytes.length;
  };
  ByteWriter.prototype.raw = function (u8) {
    this.parts.push(u8);
    this.length += u8.length;
  };
  ByteWriter.prototype.toUint8Array = function () {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const p of this.parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  };

  const PORTRAITS = ["med", "nor", "afri", "cust"];
  const ROLES = ["Rifleman", "Assault", "Sniper", "Scout", "Shield", "Heavy weapons", "Rocketeer", "Specialist"];
  const WEAPONS = ["weapon.rifle", "weapon.shotgun", "weapon.machinegun", "weapon.sniper", "weapon.rocket.frag"];
  const AMMOS = ["ammo.ballistic.rifle", "ammo.ballistic.shotgun", "ammo.ballistic.machinegun", "ammo.ballistic.sniper"];
  const GRENADES = ["weapon.grenade.frag", "weapon.grenade.smoke", "weapon.grenade.flashbang", "weapon.grenade.medipack"];

  /*
   * Build a synthetic save. Options: { seed, soldiers, saveName, gameDate,
   * recruitEvery, rankPoints, woundEvery } — with recruitEvery = N, every N-th
   * soldier is a RECRUIT (armour only, no weapon.* strings, no seat),
   * mimicking the recruitment pool; everyone else is active team with a
   * loadout. rankPoints sets postInts[0] (the rank-point field; >= 3 means
   * promoted past PVT, so the parser applies the +2 promotion bonus).
   * woundEvery = N makes every N-th TEAM soldier wounded (current HP halved).
   * Returns { bytes, spec } — `spec` exposes exactly what was written (incl.
   * inTeam and currentHP) so tests can assert against it.
   */
  function buildFixtureSave(options) {
    const opts = options || {};
    const seed = opts.seed == null ? 1 : opts.seed;
    const count = opts.soldiers == null ? 10 : opts.soldiers;
    const recruitEvery = opts.recruitEvery == null ? 0 : opts.recruitEvery;
    const rankPoints = opts.rankPoints == null ? 0 : opts.rankPoints;
    const woundEvery = opts.woundEvery == null ? 0 : opts.woundEvery;
    const saveName = opts.saveName || "planner-test";
    const gameDate = opts.gameDate || "00:00 01 Sep 1979";
    const rnd = mulberry32(seed);
    const w = new ByteWriter();
    const spec = { header: { saveName, gameDate }, soldiers: [] };

    // header: magic, version, save name, in-game date, real date, file name
    w.raw(new TextEncoder().encode("onex"));
    w.i32(256);
    w.str(saveName);
    w.str(gameDate);
    w.str("12:00 14 Nov 2026");
    w.str("2026-11-14_12.00.00");
    for (let i = 0; i < 24; i++) w.u8(Math.floor(rnd() * 256)); // junk

    for (let i = 0; i < count; i++) {
      const n = i + 1;
      const nationality = "Testland";
      const name = "Test Soldier " + n;
      const portrait = PORTRAITS[Math.floor(rnd() * PORTRAITS.length)];
      const portraitIndex = Math.floor(rnd() * 20);
      const shortNat = "tst";
      // six base stats; the "current" copy differs slightly so tests can tell
      // the two copies apart when selecting current vs base in Calibrate
      const base = [];
      for (let s = 0; s < 6; s++) base.push(35 + Math.floor(rnd() * 36)); // 35..70
      const current = base.map((v) => Math.max(20, v - Math.floor(rnd() * 5)));
      const statInts = current.concat(base); // 12 ints: current copy, then base copy
      const hpFloat = 20 + Math.floor(rnd() * 20); // current HP as float, < HP stat
      const role = ROLES[i % ROLES.length];
      const regiment = "regiment.tst" + (1 + (i % 3));
      const experience = i % 4 === 0 ? "experience.none" : "experience.tst" + (1 + (i % 3));
      const weapon = WEAPONS[i % WEAPONS.length];
      const ammo = AMMOS[i % AMMOS.length];
      const grenade = GRENADES[i % GRENADES.length];
      const seat = i % 3 === 0 ? "Charlie - " + n + "/13" : null;
      const isRecruit = recruitEvery > 0 && n % recruitEvery === 0;

      // junk between soldiers (never contains the marker: 12 fixed ASCII
      // bytes have a negligible chance of matching by accident, and the
      // seed is fixed for tests)
      for (let j = 0; j < 16 + Math.floor(rnd() * 32); j++) w.u8(Math.floor(rnd() * 256));

      // pre-marker fields
      w.str(nationality);
      w.str(name);
      w.str(portrait);
      w.i32(portraitIndex);
      w.str("SoldierFlags"); // the marker is itself a length-prefixed string

      // post-marker fields
      w.u8(0); // flag byte
      w.str(shortNat);
      for (const v of statInts) w.i32(v);
      // ten small ints between the stats and the float (float lands at
      // stats-end + 40, 4-aligned). Recruits get zeros; team soldiers get
      // plausible mission/kill-ish counters so Calibrate has raw candidates.
      const postInts = isRecruit
        ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        : [rankPoints, i % 3, 1, 1, 30 + (i % 40), 0, 0, 0, 0, 0]; // postInts[0] = rank points
      for (const v of postInts) w.i32(v);
      w.f32(hpFloat); // the one float among the padding (current HP)
      w.str(regiment);
      w.str(experience);
      w.i32(0);
      // transport seat region, matching the real layout (verified byte-level):
      // seat string (empty when none), seat-index int (-1 = no seat), then the
      // CURRENT HP int32, then a flag byte, then the role string. Recruits
      // store 0 as HP (they are always at full HP in-game).
      if (seat && !isRecruit) w.str(seat); else w.str("");
      w.i32(seat && !isRecruit ? n : -1);
      const inGameMaxHP = statInts[1] + (rankPoints >= 3 ? 2 : 0); // HP slot + promotion bonus
      const wounded = !isRecruit && woundEvery > 0 && n % woundEvery === 0;
      const curHP = isRecruit ? 0 : wounded ? Math.max(1, Math.floor(inGameMaxHP / 2)) : inGameMaxHP;
      w.i32(curHP);
      w.u8(1);
      w.str(role);
      w.str("Corporation.DeadSoldiersImplemented");
      w.u8(0);
      w.u8(0);
      w.str("LastMissionEnum");
      w.i32(0);
      w.str("DeadSoldier.UnknownLoc");
      w.str("armour.basic");
      w.str("armour.basic");
      if (!isRecruit) {
        // active-team soldiers carry equipment; recruits have armour only
        w.str(weapon);
        w.str("Inventory.SaveAmmoType");
        w.u8(0);
        w.str(ammo);
        w.str(weapon);
        w.i32(1);
        w.u8(0);
        w.str(grenade);
      }

      spec.soldiers.push({
        name, nationality, portrait, portraitIndex, statInts, hpFloat, postInts, role, regiment, experience,
        loadout: isRecruit ? [] : [weapon, ammo, weapon, grenade],
        seat: isRecruit ? null : seat,
        inTeam: !isRecruit,
        currentHP: curHP,
      });
    }

    // trailing junk
    for (let i = 0; i < 64; i++) w.u8(Math.floor(rnd() * 256));

    return { bytes: w.toUint8Array(), spec };
  }

  return { buildFixtureSave, mulberry32, ByteWriter };
});
