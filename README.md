# xenosquad-web

A squad planner for **Xenonauts 1** (Goldhawk Interactive, 2014) that runs entirely in your
browser as a static website. Drag a save file onto the page, get the mathematically optimal
soldier-to-role assignment for a configurable set of squad seats.

## Privacy — the headline feature

- **No backend, no uploads.** The save file is opened with the browser File API and parsed
  locally in memory. There is nowhere for it to be uploaded to.
- **No analytics, no cookies, no external requests of any kind** — no fonts, images, scripts
  or fetches from CDNs. The page carries a strict `Content-Security-Policy` meta tag
  (`connect-src 'none'`, `script-src 'self'`, …) that makes any network request impossible.
- **Settings only** are stored, in `localStorage` under the `xenosquad-web.` prefix. The
  soldier roster (names are personal data) is **never** persisted — it lives in memory for
  the session only. Use **Clear all my data** (Settings tab) to wipe the namespace.

## Running it

The site is plain HTML/CSS/JS with **zero dependencies and zero build step**:

- open `index.html` directly from the filesystem (`file://` works — classic scripts, not ES
  modules, are used for exactly this reason), or
- serve the folder with any static server, or
- publish it on **GitHub Pages** (below).

### Publishing on GitHub Pages (via GitHub Actions — recommended)

No build step is needed: the deployed site is exactly the files in this repo.

1. Merge `.github/workflows/pages.yml` into `main`.
2. One-time switch in the repo UI: **Settings → Pages → Build and deployment → Source:
   _GitHub Actions_** (replaces the legacy "Deploy from a branch" mode).
3. Every push to `main` runs the test suite first, then deploys the whole repo to
   `https://<owner>.github.io/xenosquad-web/` (a few minutes). PRs run CI only.

(Legacy alternative: Settings → Pages → Source: Deploy from a branch → `main` → `/ (root)`.)

### CI and branch protection (team workflow)

- `.github/workflows/ci.yml` runs `node --test tests/node/suite.test.js` plus a syntax
  check of every JS file on every PR to `main` and every push.
- Recommended ruleset on `main` (Settings → Rulesets → New branch ruleset, target:
  *Default branch*): **Require a pull request before merging**, **Restrict updates**,
  **Restrict deletions**, **Block force pushes**, and once the CI workflow has run at
  least once, **Require status checks to pass** → add the `test (node 22)` check.
  Allowed merge methods: *squash* (clean linear history). Approvals: 0 for a solo repo,
  raise to 1 when a teammate joins. Leave signed commits / code scanning off for now.
- Day-to-day flow: work on a short-lived `vibe/<slug>` branch → open a PR to `main` →
  CI green → squash-merge → delete the head branch (enable "Automatically delete head
  branches" in Settings → General).

## Using the app

1. Find the save file your game writes: any `.sav` from your save slots (a dedicated slot
   producing `planner.sav` is handy). It sits in the Xenonauts save folder
   `Documents/Xenonauts/` — under Windows your user Documents folder; through Proton/Wine it
   is `drive_c/users/<user>/Documents/Xenonauts/` inside the Wine prefix.
2. Drag the `.sav` anywhere onto the page (or use the file picker; the `accept=".sav"`
   attribute is only a hint — content is verified by scanning for the `SoldierFlags` marker).
3. The **Squad** tab shows the parsed squad request; the **Soldiers** tab shows the roster;
   **Roles** is your doctrine editor; **Settings** holds global parameters, export/import and
   reset; **Calibrate** maps raw save slots to the six stats; **Help** documents everything.

## Save format notes (verified against real `planner.sav` files + in-game screenshots)

Binary serialization: 4-byte LE length + ASCII bytes for strings, 4-byte LE int32, 4-byte
LE IEEE-754 float; `FF FF FF FF` is -1/null. Soldier records are located by scanning for the
ASCII marker `SoldierFlags` (once per soldier — active team **and** recruitment pool alike). A record
contains the nationality, full name, portrait string + int, the marker, a short nationality string,
then **twelve** int32 stat values (six stats, each appearing twice — first copy current, second base),
a zero-padding run containing one float at **stats-end + 40 bytes** (the current HP as a float; the
HP stat itself is the max), then `regiment.*`, `experience.*`, an optional transport-seat string
(`Charlie - 1/13`), the in-game equipment role string, `armour.*` and loadout strings.

**Stat slot order, verified against roster screenshots: slot0=TU, slot1=HP, slot2=STR, slot3=ACC,
slot4=RFL, slot5=BRV** (HP is slot 1, not slot 5 — the save data overrides the assumed order; the
Calibrate tab can remap everything). **Team membership**: a block containing a `weapon.*` string is
an active-team soldier; recruitment-pool soldiers have armour only (in the inspected saves this
splits 22 soldiers into exactly 10 team / 12 recruits, matching the in-game screens). Rank is not
cleanly locatable in the block, so the rank tie-breaker stays disabled with a visible notice unless
mapped in Calibrate. The header stores the save name and in-game date. All offsets/counts/prefixes
are settings, never hardcoded.

## Testing

- **Browser (canonical):** open `tests/tests.html` — runs the whole suite (50 tests) and
  prints pass/fail per test. No server needed; works from `file://`.
- **Node (convenience):** `node --test tests/node/suite.test.js` runs the same test files
  headlessly (the logic modules import cleanly in Node without a DOM).

Covered: the parser against the synthetic fixture (marker scan, string/int/float decoding,
record layout, calibration, robustness), exclusions/normalization/role scoring, the Hungarian
solver (including the "two roles want the same soldier" case and — in tests only — brute-force
optimality over random small matrices; the brute-force path never ships in production),
assignment edge cases, and settings merge + export/import round-trip + namespaced storage.

Tests are hand-written and zero-dependency. Save-file test input is **synthetic**: generate it
with `node tools/make-fixture.js` (writes `fixtures/synthetic-planner.sav`, invented names
like "Test Soldier 1"). Never commit a real save or real soldier names.

## Architecture

- `parser/` — binary save extraction (pure: buffer in, data out)
- `domain/` — plain-object models (Soldier, Role, SquadTemplate) + seeded defaults + version
- `scoring/` — exclusions, normalization, role scoring, assignment; `scoring/hungarian.js`
  is the hand-written Kuhn–Munkres solver
- `settings/` — defaults, validation, merge, export/import, localStorage (storage injected)
- `ui/` — rendering only; logic modules never touch the DOM
- `tests/`, `tools/` — test suite + synthetic fixture generator

All logic modules are importable by Node without a DOM. Every file uses a tiny UMD-style
wrapper (classic `<script>` in the browser → works from `file://`; `module.exports` in Node).

## Feature map

| Tab | What it does |
| --- | --- |
| Squad | save inspector, mission templates, seat builder (per-seat roles, add/remove, default 8), optimal squad with per-pick "why", bench, ineligible list — all live; recruits excluded by default with a notice |
| Soldiers | parsed roster: team/recruit badge + transport seat, stats, HP/wound status, game role, rank, loadout |
| Roles | doctrine editor: weights, floors, kit weight, trains, frontline, strength training; add/duplicate/rename/delete |
| Settings | global parameters (wounded threshold, encumbrance, psi era, training seat), save-format parameters, export/import JSON, per-section resets, reset all, **Clear all my data** |
| Calibrate | raw save slots → the six stats, current-HP and rank sources; per-soldier raw value table |
| Help | usage guide, calibration flow, scoring pipeline, privacy note, version |
