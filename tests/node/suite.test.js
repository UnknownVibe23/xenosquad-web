/*
 * tests/node/suite.test.js — runs the SAME test files as tests/tests.html
 * under `node --test`. The browser suite (tests.html) is the canonical one;
 * this is the documented Node convenience:
 *
 *     node --test tests/node/
 *
 * Logic modules are UMD-style: requiring them attaches to globalThis.XS and
 * also sets module.exports, so they import cleanly in Node without a DOM.
 */
"use strict";
const { test } = require("node:test");

globalThis.XS = globalThis.XS || {};

// bind the shared helpers to node:test BEFORE loading any test file
globalThis.XSTest = require("../helpers.js");
globalThis.XSTest.bindNode(test);

// logic modules under test (side effect: attach to globalThis.XS)
require("../../domain/models.js");
require("../../parser/saveParser.js");
require("../../scoring/hungarian.js");
require("../../scoring/scoring.js");
require("../../settings/store.js");
require("../../tools/fixture-generator.js");

// the same test files the browser page loads
require("../parser.test.js");
require("../scoring.test.js");
require("../hungarian.test.js");
require("../settings.test.js");
require("../assignment.test.js");
