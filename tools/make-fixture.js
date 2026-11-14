#!/usr/bin/env node
/*
 * tools/make-fixture.js — write a synthetic save file to disk.
 *
 * Usage: node tools/make-fixture.js [outPath] [--soldiers N] [--seed S]
 * Default outPath: fixtures/synthetic-planner.sav
 *
 * The output is a FAKE save (invented names like "Test Soldier 1") with the
 * same binary encoding, marker and record layout as a real Xenonauts save,
 * so the parser has realistic test input and no real save ever enters the
 * repository. Regenerate with: node tools/make-fixture.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

globalThis.XS = globalThis.XS || {};
require("./fixture-generator.js");
const { buildFixtureSave } = globalThis.XS.fixture;

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const outPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "fixtures/synthetic-planner.sav";
const soldiers = parseInt(arg("soldiers", "12"), 10);
const seed = parseInt(arg("seed", "1"), 10);

const { bytes, spec } = buildFixtureSave({ seed, soldiers, saveName: "planner-test", gameDate: "00:00 01 Sep 1979" });
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, bytes);
console.log("wrote " + outPath + " (" + bytes.length + " bytes, " + spec.soldiers.length + " synthetic soldiers, seed " + seed + ")");
console.log("names: " + spec.soldiers.map((s) => s.name).join(", "));
