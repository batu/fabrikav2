# Mage Master — developer handoff

Written 2026-09-03. State: playable vertical slice on iPhone, on TestFlight as
build 1.0 (1). This page is enough to get from clone to a running build on your
own phone and to know what is done, what is not, and where the traps are.

## 1. Get the code

Mage Master lives in the `fabrikav2` monorepo (npm workspaces, Node 26, npm 11).
All work is on branch **`feat/mage-master`**, which is local to Batu's Mac and
not pushed yet. Ask him to push it, then:

```bash
git clone <fabrikav2 remote> fabrikav2 && cd fabrikav2
git checkout feat/mage-master
npm install
cd games/mage_master
```

Directory: `games/mage_master/`. Workspace name: `@fabrikav2/mage_master`.
Native bundle id: `com.basegamelab.magemaster` (no underscore; App Store Connect
rejects underscores). The internal id `mage_master` is deliberate and stays.

## 2. Run it

```bash
# from games/mage_master
npx vite --host 0.0.0.0 --port 5199 --strictPort     # dev server (LAN)
npm run typecheck -w @fabrikav2/mage_master          # from repo root
npm run test:unit -w @fabrikav2/mage_master          # 21 tests incl. a 30-min pacing bot
npm run audit                                        # repo linters (must stay green)
```

Open `http://<your-mac-ip>:5199` in a browser to poke at it, but **the phone is
the target**. Web renders are not evidence for this project; every visual claim
is verified on a real iPhone.

## 3. Phone build (iOS)

`ios/` is gitignored and generated. First time on a new machine:

```bash
npx cap add ios
npx cap sync ios
cp -R native-resources/ios/App/ ios/App/App/     # committed Info.plist, icons, splash
```

Then either open `ios/App/App.xcodeproj` in Xcode and run on your device with
your own team, or use the scripts in `tools/mage-master-dev/` (repo root):

- `mm-install.sh` — standalone build (bundled `dist`, no dev server) → install → launch.
- `mm-install-dev.sh` — same, but the app loads from the Vite server for live reload
  and the dev drive.

**Those scripts hardcode Batu's machine**: phone UDID `00008101-000410EC3EF9001E`,
team `42L77JAX72`, LAN IP `192.168.1.74`, and a pymobiledevice3 tunnel. Edit those
constants for your setup before running them. Screenshots (`mm-shot.sh`) go through
`pymobiledevice3 developer dvt screenshot --rsd …`; on Wi-Fi-only phones you need
the `--rsd` values from the tunnel daemon.

Signing over SSH fails with `errSecInternalComponent` until the login keychain is
unlocked. Derived data goes in `.work/DerivedData` (a `build/` directory fails the
structure audit). If you copy derived data between checkouts, delete
`.work/DerivedData/SourcePackages` first or SPM artifacts point at the old path.

## 4. Dev drive (on-device automation)

With the dev build, `src/dev/devDrive.ts` polls the Vite server for commands and
posts results back. `tools/mage-master-dev/mm-drive.sh OP ARGS_JSON`:

- `driveTo '["win"]'` / `'["level"]'` / `'["settings"]'` — jump to a harness state
- `verb '["pull"]'`, `'["openShop"]'`, `'["home"]'` … — harness verbs
- `eval '["<js>"]'` — run JS on the phone; `window.__MM_DEV = {controller, screen, harness}`
- `inspect '[".selector"]'` — computed style + rect (the CDP substitute on iOS)
- `frames '[10,80]'` — burst of canvas frames; `snapshot`; `reload`

`eval` uses `new Function`, so no top-level `await`. Fast-forward a battle with
`controller.advanceBattle(0.25)` in a loop. `controller.grantResources({...})`
**sets** values, it does not add. Dev-only: `import.meta.env.DEV` gates it, it
never ships.

Soak: `mm-soak.sh MINUTES OUTDIR` plays like a player for N minutes with periodic
screenshots and error checks; `mm-soak-summary.py OUTDIR` writes the summary.

## 5. How it is built

Read `README.md` for the layout. The shape that matters:

- **Content is data.** Everything tunable is in `content/*.ts`: mages, enemies,
  levels + `LEVEL_SCALING`, rarity ages, item rolls, Rift odds/timers, energy,
  offline income, arena geometry, gem packs. Change numbers there, not in code.
- **Pure sim.** `src/game/sim/battle.ts` is a fixed 30 Hz tick with a seeded RNG
  (mulberry32), an event queue, projectiles, statuses (burn/chill/chain/pierce),
  unit separation, and stage advance. No DOM, no Phaser. `simulateBattle` runs it
  headless; tests and the pacing bot use that.
- **Pure meta.** `src/game/economy/` — items/loadouts/stat math and the save
  reducers (tick, offline, enterLevel, complete/fail, pull, use/discard, upgrade,
  skip). `save.ts` is the source of truth for progression rules.
- **One state owner.** `src/game/MageMasterController.ts` holds save + surface +
  active battle. DOM shell, renderer, and harness all call it; nothing else
  mutates state.
- **Renderer.** `src/battle/BattleScene.ts` is Phaser 3.90 drawing the sim's view:
  camera follows the camp line, painted ground plates, props, unit visuals, floats,
  banners. One static PNG per unit, animated in code (bob/squash/flash). Mage look
  is a composite in `mageComposite.ts`: base body + magenta-garment layer tinted by
  armor rarity + element staff at per-class anchors (`design/assets.ts`).
- **Shell.** `src/shell/MageMasterScreen.ts` composes `@fabrikav2/ui` kit surfaces
  (modals, result cards, saga map, settings page, shop page, toaster). Pages:
  menu / rift / mages / shop / battle. `mage-master.css` is all token-based
  (`--fab-mm-*`), framed chrome via `border-image` 9-slices.
- **Design.** `design/tokens.css`, `design/copy.ts` (every user-facing string —
  the audit rejects string literals in DOM sinks), `design/assets.ts` (glob
  bindings), `design/assets/` (~70 generated PNG/JPG + SVG, see `PROVENANCE.md`).
- **Harness.** `src/shell/harness.ts` implements the testkit contract (snapshot,
  verbs, winLevel/failLevel, driveTo). `main.ts` installs it when
  `VITE_ENABLE_TEST_HARNESS=true`; the TestFlight build was made **without** it.

Adding things: new enemy = one row in `content/enemies.ts` + `unit-<kind>.png`.
New element/status = `ELEMENT_EFFECTS` in `content/items.ts` + the branch in
`battle.ts`. New copy = `design/copy.ts` key first, then use it.

## 6. What is done and verified on device

Evidence folders under `evidence/` have captures and a `JOURNAL.md` each.

- Full loop: energy → levels (10 × 4 stages) → three mages auto-fight → drops →
  win/lose → Rift pulls with visible odds → use/discard with class gate → Rift
  upgrade timer + gem skip → offline income → gem shop (sandbox provider).
- Ten rarity ages, four elements with statuses, melee/ranged and single/AoE.
- 30-minute on-device soak (2026-09-02): 0 runtime errors, level 9, 30 pulls.
  A headless 30-minute pacing bot is a unit test on the shipped tuning.
- Requirements audit vs the design doc: 32 of 36 MET, 4 PARTIAL, 0 MISSING
  (`docs/requirements-audit.md`).
- Visual bar: judged with pixelsmith (multi-model consensus) per screen; last
  round passed home, rift, mages, battle, victory, shop, settings.

## 7. What is not done (start here)

1. **Real purchases.** Gems run on the SDK's sandbox `FakePurchaseProvider`
   (`src/game/shop.ts`, `content/shop.ts`). No StoreKit/RevenueCat, no products
   in App Store Connect. Product ids are `com.basegamelab.magemaster.gems.{small,medium,large}`.
2. **Boss readability.** Melee mages stand inside the boss silhouette in boss
   stages. Fix is a boss-scaled separation radius in `battle.ts` (`separate()`,
   `ARENA.separation`); it interacts with melee reach, so capture a 15 fps burst
   before/after.
3. **Re-soak.** The device soak predates the ramp retune (`LEVEL_SCALING`,
   energy regen 45 s). Run `mm-soak.sh 30 <dir>` on a dev build and compare
   against `evidence/2026-09-02-03-device-soak/SUMMARY.md`.
4. **Deliberate design-doc deviations** (audit PARTIALs): defeat card offers
   Retry; armor substat pool includes a small ATK roll. Keep or revert, your call.
5. No ads, no analytics backend (events go to a ring sink), no cloud save.

## 8. Traps that already cost time

- Kit token overrides must be declared on `:root, .fab-ui` or the kit's own
  defaults win. But **runtime-bound art variables** (`--fab-mm-frame-*`,
  `--fab-mm-scene-*`) must default on `:root` **only** — nested kit roots also carry
  `.fab-ui` and would reset the inherited URL to `none`. That one broke every
  modal button. See `docs/solutions/logic-errors/kit-token-scope-and-svg-inlining.md`.
- Small SVGs get inlined as data URIs with quotes that break the kit's
  `url(${sprite})`. Import with `?url`; `assetsInlineLimit: 0` is set.
- 9-slice frames from generated art must be alpha-trimmed (`mm-trim.py`) or the
  plate renders as a sliver.
- WebKit keeps a blank paint for a rewritten image at the same URL; dev asset URLs
  carry a boot stamp (`BOOT_STAMP` in `design/assets.ts`).
- The audit rejects hex/rgb literals and copy strings in `src/shell` — use tokens
  and `copy.ts`. It also rejects a `build/` dir and `/__drive.json` literals outside
  `src/dev`.
- `localhost:5199` on Batu's Mac is a different project's Vite; always use the LAN IP.
- The controller's `energyNextIn` once hardcoded 60 s while regen is 45 s. Tunables
  live in `content/`; if a number appears twice, one of them is a bug.

## 9. App Store Connect / TestFlight

- App: Mage Master, id `6808146812`, bundle `com.basegamelab.magemaster`.
- Build 1.0 (1) uploaded 2026-09-03, state `IN_BETA_TESTING`, internal group
  "Internal" with access to all builds. Internal testers need no beta review.
- Release build recipe: `env -u VITE_ENABLE_TEST_HARNESS npx vite build` →
  `cap sync` → copy `native-resources` → `xcodebuild archive` (Release, automatic
  signing, `-allowProvisioningUpdates` + ASC API key) → `-exportArchive`
  (method `app-store-connect`) → `xcrun altool --upload-app`. Bump
  `CURRENT_PROJECT_VERSION` for each upload. `ITSAppUsesNonExemptEncryption=false`
  is in the committed Info.plist so export compliance auto-clears.
- Creating a **new** app record cannot be done through the API; it needs a
  logged-in App Store Connect web session.

## 10. Where to read more

- `docs/research.md` — reference games (Forge Master, Epic Stickman, Dicero,
  Capybara Go, Cell Survivor; Kingdom Rush for art).
- `docs/requirements-audit.md` — line-by-line vs the concept doc.
- `docs/plans/2026-09-02-001-feat-mage-master-mvp-plan.md` (repo root) — the
  build plan, amendments, and status log.
- `refs/notes/` — the concept PDF and pitch; `refs/art/` — storyboard.
- `evidence/2026-09-03-06-night/REPORT.html` — latest status report with captures.
