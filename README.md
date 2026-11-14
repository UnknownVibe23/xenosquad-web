# xenosquad-web

A squad planner for **Xenonauts 1** (Goldhawk Interactive, 2014) that runs entirely in your
browser as a static website. Drag a save file onto the page, get the mathematically optimal
soldier-to-role assignment for a configurable set of squad seats.

## Privacy - the headline feature

- **No backend, no uploads.** The save file is opened with the browser File API and parsed
  locally in memory. There is nowhere for it to be uploaded to.
- **No analytics, no cookies, no external requests of any kind** - no fonts, images, scripts
  or fetches from CDNs. The page carries a strict `Content-Security-Policy` meta tag
  (`connect-src 'none'`, `script-src 'self'`, …) that makes any network request impossible.
- **Settings only** are stored, in `localStorage` under the `xenosquad-web.` prefix. The
  soldier roster (names are personal data) is **never** persisted - it lives in memory for
  the session only. Use **Clear all my data** (Settings tab) to wipe the namespace.

## Running it

The site is plain HTML/CSS/JS with **zero dependencies and zero build step**:

- open `index.html` directly from the filesystem (`file://` works - classic scripts, not ES
  modules, are used for exactly this reason), or
- serve the folder with any static server, or
- publish it on **GitHub Pages** (below).

### Publishing on GitHub Pages (via GitHub Actions - recommended)

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
- Day-to-day flow (chosen by the repo owner): all work accumulates on ONE integration
  branch `vibe/work-2aa8b1` → CI runs on every push to it → when satisfied, merge
  `vibe/work-2aa8b1` into `main` (squash or merge commit) and delete the branch; the
  next round starts from a fresh `vibe/work-2aa8b1` created from the new `main`.
  Enable "Automatically delete head branches" in Settings → General as a safety net.
  (Per-change PR branches are the alternative for bigger teams; this repo uses the
  single integration branch.)

## Using the app

1. Find the save file your game writes: any `.sav` from your save slots (a dedicated slot
   producing `planner.sav` is handy). It sits in the Xenonauts save folder
   `Documents/Xenonauts/` - under Windows your user Documents folder; through Proton/Wine it
   is `drive_c/users/<user>/Documents/Xenonauts/` inside the Wine prefix.
2. Drag the `.sav` anywhere onto the page (or use the file picker; the `accept=".sav"`
   attribute is only a hint - content is verified by scanning for the `SoldierFlags` marker).
3. The **Squad** tab shows the save inspector, templates, seat builder and the planned squad;
   **Soldiers** shows the roster; **Roles** is your doctrine editor; **Settings** holds global
   parameters, export/import and resets (plus **Clear all my data**); **Help** documents
   everything and lists the version history. (A Calibrate tab exists in the repo but is hidden:
   the verified stat mapping is built in, see below.)

## Save format notes (verified against real `planner.sav` files + in-game screenshots)

Binary serialization: 4-byte LE length + ASCII bytes for strings, 4-byte LE int32, 4-byte
LE IEEE-754 float; `FF FF FF FF` is -1/null. Soldier records are located by scanning for the
ASCII marker `SoldierFlags` (once per soldier - active team **and** recruitment pool alike). A record
contains the nationality, full name, portrait string + int, the marker, a short nationality string,
then **twelve** int32 stat values (six stats, each appearing twice - first copy current, second base),
a zero-padding run containing one float at **stats-end + 40 bytes** (the current HP as a float; the
HP stat itself is the max), then `regiment.*`, `experience.*`, an optional transport-seat string
(`Charlie - 1/13`), the in-game equipment role string, `armour.*` and loadout strings. Loadout
strings (`weapon.*`/`ammo.*`) appear twice per block in real saves; the parser keeps the first
occurrence of each for display.

**Stat slot order, verified against roster screenshots: slot0=TU, slot1=HP, slot2=STR, slot3=ACC,
slot4=RFL, slot5=BRV** (HP is slot 1, not slot 5 - the save data overrides the assumed order; the
Calibrate tab can remap everything). **Team membership**: a block containing a `weapon.*` string is
an active-team soldier; recruitment-pool soldiers have armour only (in the inspected saves this
splits 22 soldiers into exactly 10 team / 12 recruits, matching the in-game screens). **Recruit HP**:
the recruit screen shows pool soldiers at full HP, so the float at the HP offset in a recruit block is
a different field, not current HP - recruits are treated as HP-unknown and never wounded
(`format.recruitHpIsFloat`, default false). Rank is not
cleanly locatable in the block, so the rank tie-breaker stays disabled with a visible notice unless
mapped in Calibrate. The header stores the save name and in-game date. All offsets/counts/prefixes
are settings, never hardcoded.

**Calibrate tab / save-format UI are intentionally hidden for now** (the GOG build of Xenonauts 1
is final - no patches are expected, so the verified mapping never needs changing). The parser
still reads the mapping and all format parameters from the settings object, so nothing was
deleted: to re-expose the UI after a hypothetical future build, re-add the `calibrate` entry to
`TABS` in `ui/main.js`, the `ui/tabs-calibrate.js` script tag in `index.html`, and add a
format-parameters section back to `ui/tabs-settings.js` (the `settings.format` object still
carries marker/statCount/hpFloatOffset/stringScanBytes/teamStringPrefix/recruitHpIsFloat and is
what the parser reads). If more save files ever show
a different layout, share one (as `.txt`, never committed) and we decide then whether to bring the
calibration UI back.

## Testing

- **Browser (canonical):** open `tests/tests.html` - runs the whole suite and
  prints pass/fail per test. No server needed; works from `file://`.
- **Node (convenience):** `node --test tests/node/suite.test.js` runs the same test files
  headlessly (the logic modules import cleanly in Node without a DOM).

Covered: the parser against the synthetic fixture (marker scan, string/int/float decoding,
record layout, calibration, robustness), exclusions/normalization/role scoring, the Hungarian
solver (including the "two roles want the same soldier" case and - in tests only - brute-force
optimality over random small matrices; the brute-force path never ships in production),
assignment edge cases, and settings merge + export/import round-trip + namespaced storage.

Tests are hand-written and zero-dependency. Save-file test input is **synthetic**: generate it
with `node tools/make-fixture.js` (writes `fixtures/synthetic-planner.sav`, invented names
like "Test Soldier 1"). Never commit a real save or real soldier names.

## Doctrine basis (why the seeded role weights/floors look like this)

Veteran meta, verified against the Darkfireslide weapon-class guide, Arqade squad-composition
threads, GameFAQs ground-combat/strategy guides, and the Xenonauts wiki (Machine Gun, Morale,
Xenonaut Stats). Hard sourced numbers used as floors:

- **STR 70 recoil breakpoint** for Heavy weapons and Rocketeer (never fixable, even with
  Predator armour) → `STR: 70` floors on both. Heavy weapons aim with min(STR, ACC), so both
  weight STR 3 / ACC 3; high RFL on an MG is a friendly-fire liability and rockets cannot
  reaction-fire, so both weight RFL 0.
- **ACC 65** for Sniper, **STR 55** for Shield (veteran triage), **ACC 40** for Assault (never run
  sub-40 ACC shotgunners; 40 is the tightest reading of the sourced rule).
- Reaction fire is deterministic initiative = **RFL × weapon reaction modifier × %TU left** →
  door/flanker roles (Shield, Assault, Scout) weight RFL high.
- **Trains rules (sourced):** BRV only progresses from panic events and medals (+1-3, not
  farmable) and HP rises passively, so neither is ever listed in `trains`; TU is the only stat
  that can gain +2 per mission (~250 TU of movement per point).
- Judgment-based weights (no exact veteran number exists; tune freely): Sniper BRV 1, Shield
  BRV 2, Assault BRV 1, Rocketeer BRV 0.5, Scout BRV 1.
- **Carrying capacity = 8 kg + 0.3 kg × STR** (gameconfig.xml); the TU penalty starts above
  **100 %** of capacity, while **80 %** is the threshold at which moving trains STR (that's what
  `strength_training` roles invert to). The app models this with `strCapacityBase`,
  `strCapacityCoef`, `encumbranceLimit` (default 1.0) and `strTrainThreshold` (0.8) in Settings.
- **Wounded threshold default 0.75**: field only nearly-full soldiers (veteran default).
- 8-man squad meta is 2 shield / 2 assault / 2 riflemen / 1 sniper / 1 heavy → the seeded
  "Crash site" template.

Known late-game variant **not** modeled (there is no per-era weight switch in settings, only the
psi-era BRV floor): Heavy weapons would drop to STR 1 / TU 2.5 late-game.

Everything remains plain data in the Roles tab/Settings - change anything live.

## Architecture

- `parser/` - binary save extraction (pure: buffer in, data out)
- `domain/` - plain-object models (Soldier, Role, SquadTemplate) + seeded defaults + version
- `scoring/` - exclusions, normalization, role scoring, assignment; `scoring/hungarian.js`
  is the hand-written Kuhn–Munkres solver
- `settings/` - defaults, validation, merge, export/import, localStorage (storage injected)
- `ui/` - rendering only; logic modules never touch the DOM
- `tests/`, `tools/` - test suite + synthetic fixture generator

All logic modules are importable by Node without a DOM. Every file uses a tiny UMD-style
wrapper (classic `<script>` in the browser → works from `file://`; `module.exports` in Node).

## Feature map

| Tab | What it does |
| --- | --- |
| Squad | save inspector, mission templates, seat builder (per-seat roles, add/remove, default 8), optimal squad with per-pick "why", bench, ineligible list - all live; recruits tri-state (off by default / fill only empty seats / all seats) with notices and "hire first" badges |
| Soldiers | parsed roster: team/recruit badge + transport seat, stats, HP cur/max, explicit Status column (red = wounded, with the threshold; recruits are never wounded - full HP in-game), game role, rank, loadout |
| Roles | doctrine editor: weights, floors, kit weight, trains, frontline, strength training; add/duplicate/rename/delete |
| Settings | global parameters (wounded threshold, encumbrance & strength, psi era, training seat, recruits mode), export/import JSON, per-section resets, reset all, **Clear all my data** |
| Calibrate | *hidden* (kept in the repo, re-enable per the note above): raw save slots → the six stats, current-HP and rank sources |
| Help | quick start, recruits & wound status, scoring pipeline in brief, privacy note, full version history |
