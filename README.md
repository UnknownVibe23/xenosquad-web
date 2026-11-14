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
a zero-padding run containing one float at **stats-end + 40 bytes** (NOT current HP - see below; the
HP stat itself is the max), then `regiment.*`, `experience.*`, an optional transport-seat string
(`Charlie - 1/13`), the in-game equipment role string, `armour.*` and loadout strings. Loadout
strings (`weapon.*`/`ammo.*`) appear twice per block in real saves; the parser keeps the first
occurrence of each for display.

**Stat slot order, verified against roster screenshots: slot0=TU, slot1=HP, slot2=STR, slot3=ACC,
slot4=RFL, slot5=BRV** (HP is slot 1, not slot 5 - the save data overrides the assumed order; the
Calibrate tab can remap everything). **Team membership**: a block containing a `weapon.*` string is
an active-team soldier; recruitment-pool soldiers have armour only (in the inspected saves this
splits 22 soldiers into exactly 10 team / 12 recruits, matching the in-game screens). **Current HP / wounds**: LOCATED and verified (0.27.0) - the int32 stored 9 bytes before the role
string's content (right after the transport-seat index; layout: seat string, seatIndex i32,
currentHP i32, flag u8, roleLen, role) is the soldier's current HP on the in-game scale (it
includes the PVT->CPL +2 bonus, so it divides cleanly by the bonus-adjusted HP stat). Verified
across three real saves: everyone reads full HP except one soldier in the latest save (35 of max
50). Recruits' field reads 0 and they are always at full HP in-game, so they are never marked
wounded. The wounded check is therefore ON by default (threshold 0.75). The float at stats-end+40
remains NOT current HP (it drifts by small fractions between re-saves of the same game).
`calibration.currentHP` can still be switched to `none` (wound check off), `float` or a slot
(hidden Calibrate) for other layouts. **Rank**: postInts[0] (the first small int after the
stats) is the soldier's rank POINTS (gameconfig.xml `soldierRanks`: PVT 0, CPL 3, SGT 9, LT 16,
CPT 30, ...), and the first promotion PVT -> CPL adds **+2 to every stat** (Arqade/gameconfig) -
verified against roster screenshots: the in-game screen shows stat-int + 2 for CPL+ soldiers while
the save's stat ints do not include the bonus. The parser therefore adds the bonus from the rank
points (`calibration.promotionBonus`, default on), so app numbers match the in-game screen, and the
rank tie-breaker uses the points. The header stores the save name and in-game date. All
offsets/counts/prefixes are settings, never hardcoded.

**Calibrate tab / save-format UI are intentionally hidden for now** (the GOG build of Xenonauts 1
is final - no patches are expected, so the verified mapping never needs changing). The parser
still reads the mapping and all format parameters from the settings object, so nothing was
deleted: to re-expose the UI after a hypothetical future build, re-add the `calibrate` entry to
`TABS` in `ui/main.js`, the `ui/tabs-calibrate.js` script tag in `index.html`, and add a
format-parameters section back to `ui/tabs-settings.js` (the `settings.format` object still
carries marker/statCount/hpFloatOffset/stringScanBytes/teamStringPrefix/sanity and is
what the parser reads). If more save files ever show
a different layout, share one (as `.txt`, never committed) and we decide then whether to bring the
calibration UI back.

**Verified sample matrix** (all shared as `.txt` in conversation, never committed): 4 vanilla GOG
saves from the same `planner` slot (game date Sep 1979, 22 soldier blocks each = 10 team + 12
recruits, early and mid campaign, including one where a team soldier is wounded at 35/50). All four
share the identical header (`onex`, version 256) and record layout, parse with 0 errors and 0 sanity
anomalies. Not yet verified against a real file: mid-ground-combat saves (same soldier blocks are
expected, but they were the crash-prone saves in vanilla), late-game rosters (more than 22 soldiers,
higher stats/ranks), dead soldiers, and X:CE/modded saves (the sanity check warns on those). If you
have a late-game or mid-combat save, sharing it as `.txt` extends the verification.

**Supported saves / reliability.** Vanilla Xenonauts 1 (final 1.06 GOG/Steam build) is the verified
target: every real save inspected so far has the identical header (`onex`, version 256) and
soldier-block layout, Goldhawk stated the patches did not break saves, and the game has been in
maintenance mode since 2017, so no vanilla format change is expected. X:CE saves written with
`saveCompatibility="gh15x"` in `assets/gameconfig.xml` are meant to match the vanilla layout and
should work; plain X:CE or heavily modded saves can differ. On load the app runs a sanity check over
the parsed values (header magic/version, stat value ranges, rank points, role strings, team marker;
thresholds live in `settings.format.sanity`) and shows a prominent warning when a file looks
different, instead of silently showing wrong numbers. Prefer geoscape saves (save slot / Quicksave /
Autosave) over saves taken mid-ground-combat, which were the crash-prone ones in vanilla.

## Testing

- **Browser (canonical):** open `tests/tests.html` - runs the whole suite and
  prints pass/fail per test. No server needed; works from `file://`.
- **Node (convenience):** `node --test tests/node/suite.test.js` runs the same test files
  headlessly (the logic modules import cleanly in Node without a DOM).

Covered: the parser against the synthetic fixture (marker scan, string/int/float decoding,
record layout, calibration, robustness), exclusions/normalization/role scoring, the Hungarian
solver (including the "two roles want the same soldier" case and - in tests only - brute-force
optimality over random small matrices; the brute-force path never ships in production),
assignment edge cases, settings merge + export/import round-trip + namespaced storage, text
guards, and a security/redteam suite (`tests/security.test.js`): parser fuzzing (random buffers,
truncations, hostile field values), hostile settings imports (prototype pollution, wrong types,
out-of-range numbers), source scans (no fetch/XHR/WebSocket, no eval/new Function/document.write,
no cookies, no innerHTML, CSP meta present, all referenced local files exist), determinism fuzzing
across random fixtures x settings, and Hungarian-vs-brute-force on hundreds of random matrices.

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

**6 + Hunter templates.** The Hunter scout car fills exactly 2 transport seats, so a full CH-48
Charlie is either 8 soldiers or 6 soldiers + 1 Hunter (GameFAQs; Xenonauts wiki). Each seeded
8-seat template has a "(6 + Hunter, draft)" 6-seat companion (researched community meta, marked
draft because compositions are judgment calls): the Hunter's own MG/rockets replace the Heavy
weapons or Rocketeer seat where that helps (crash site, UFO landing, terror site), it cannot
fit into tight UFO/base interiors so it overlooks the entrance instead (alien base), it is
immune to reapers' attacks (terror site), and on base defense its MG seals a corner while the
soldiers hold the command area. The Hunter has +2 sight range and soaks reaction fire early,
but is weakest in clogged urban maps and obsolete once soldiers wear Wolf/Buzzard armour. All
templates are plain data in Settings; edit or delete freely.

Everything remains plain data in the Roles tab/Settings - change anything live.

## Architecture

- `parser/` - binary save extraction (pure: buffer in, data out)
- `domain/` - plain-object models (Soldier, Role, SquadTemplate) + seeded defaults + version
- `scoring/` - exclusions, normalization, role scoring, assignment; `scoring/hungarian.js`
  is the hand-written Kuhn–Munkres solver
- `settings/` - defaults, validation, merge, export/import, localStorage (storage injected)
- `ui/` - rendering only; logic modules never touch the DOM
- `assets/icons/` - the 8 official in-game class icons (85x85 PNGs extracted from the repo
  owner's own game screenshot, included with permission); referenced by relative path, which
  the CSP (`img-src 'self' data:`) allows and `file://` supports
- `tests/`, `tools/` - test suite + synthetic fixture generator

All logic modules are importable by Node without a DOM. Every file uses a tiny UMD-style
wrapper (classic `<script>` in the browser → works from `file://`; `module.exports` in Node).

## Feature map

| Tab | What it does |
| --- | --- |
| Squad | save inspector, mission templates, seat builder (per-seat roles, add/remove, default 8), optimal squad with per-pick "why", bench, ineligible list - all live; recruits tri-state (off by default / fill only empty seats / all seats) with notices and "hire first" badges |
| Soldiers | parsed roster: team/recruit badge + transport seat, stats, HP cur/max, explicit Status column (red = wounded, with the threshold; recruits are never wounded - full HP in-game), game role, rank, loadout; plus a **dismiss-candidates list** (hired soldiers below a fraction of the team median composite, default 70%, with the flat $10,000/month vanilla salary) and a **hire-candidates list** (recruits at/above a fraction of the team median, default 90% since recruits are PVT without the +2 promotion bonus yet, best first, with the $10,000 hire cost); both adjustable in Settings |
| Roles | doctrine editor: weights, floors, kit weight, trains, frontline, strength training; add/duplicate/rename/delete |
| Settings | global parameters (wounded threshold, encumbrance & strength, psi era, training seat, recruits mode, dismissal list threshold/upkeep/cap), export/import JSON, per-section resets, reset all, **Clear all my data** |
| Calibrate | *hidden* (kept in the repo, re-enable per the note above): raw save slots → the six stats, current-HP and rank sources |
| Help | quick start, recruits & wound status, scoring pipeline in brief, privacy note, full version history |
