# Marble Run full bug-validation handoff

## Mission

Independently validate every reported Marble Run defect against the current isolated worktree and the physical iPhone. Do not implement fixes during the first pass. Produce an evidence-backed pass/fail matrix, with reproduction details for every failure and an explicit blocked state for anything that cannot be verified.

## Repository state

- Repository: `/Users/base/dev/appletolye/fabrikav2`
- Worktree: `/Users/base/dev/appletolye/fabrikav2/.worktrees/marble-run`
- Branch: `work/marble-run`
- Current base commit at handoff: `08942465bfb7eb40aaf83125046dd5011a6a1ff5`
- Game directory: `/Users/base/dev/appletolye/fabrikav2/.worktrees/marble-run/games/marble_run`
- Source workbook: `/Users/base/dev/appletolye/fabrikav2/games/marble_run/refs/bugs/Marble Run-BUGLIST.xlsx`
- The worktree contains substantial uncommitted user work. Preserve it. Do not reset, clean, stash, broadly stage, or switch branches.

Run `git status --short` before doing anything. Read the workbook and these existing records, but treat them as leads rather than proof:

- `games/marble_run/docs/evidence/2026-08-07-buglist-fixes/evidence.md`
- `games/marble_run/docs/evidence/2026-08-07-settings-polish/task-pack.md`
- `games/marble_run/docs/evidence/2026-08-07-settings-polish/journal.md`

## Device and build lane

- Physical device: Batu's iPhone 12
- Hardware UDID: `00008101-000410EC3EF9001E`
- CoreDevice identifier: `2D894791-A5A3-58BE-9C88-AE0AF08B8C09`
- Bundle ID: `com.basegamelab.marblerun`
- The latest local signed build was installed without launching at handoff time. Rebuild before validating so artifact provenance is unambiguous.
- Use the repository's canonical gameplay/device harness where possible. Browser captures are useful for geometry diagnostics but do not replace physical-device evidence.
- Never enable or ship the in-situ tour/test harness in a production/TestFlight archive.

Build/install commands from the game directory:

```sh
npm run test:unit
npm run typecheck
npm run lint
npm run build
npm run ios:sync
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'id=00008101-000410EC3EF9001E' -derivedDataPath /private/tmp/marble-run-validation-derived-data -allowProvisioningUpdates build
xcrun devicectl device install app --device 2D894791-A5A3-58BE-9C88-AE0AF08B8C09 /private/tmp/marble-run-validation-derived-data/Build/Products/Debug-iphoneos/App.app
```

## Required validation matrix

Validate every item separately. A passing unit test or build is not sufficient when the symptom is visual, interactive, temporal, native, or external.

1. **Cold/fresh startup**
   - Delete the app, reinstall the exact freshly built artifact, and record cold launch through first complete Home screen.
   - Confirm it does not stop at the purple/background-only shell.
   - Measure first visible Home paint. Previous evidence reported about 691 ms after switching the lightweight Phaser shell to Canvas; obtain a fresh measurement rather than repeating that claim.

2. **Ball entry-point lifecycle**
   - Find a board where multiple collected balls are simultaneously travelling to the entry point.
   - Record the sequence. The entry point must remain visible after the first in-flight ball enters and disappear only after the final travelling ball enters.
   - This is a motion claim, so use a recording or timed frame sequence, not one settled screenshot.

3. **Workbook interaction defects**
   - Level 13 tap targeting must align with the visibly rendered moving marble.
   - Long-press must not select text or show an iOS callout.
   - Images/modals must not be draggable as native browser content.
   - The first-level tutorial hand/spotlight must track the current rendered target position.
   - ATT prompt behavior must be tested only on a device/profile whose tracking authorization is undetermined; the current phone previously reported already authorized. Mark blocked if no clean authorization state is available.

4. **Settings: menu variant**
   - Orange banner is wide, high enough, uncropped, and masks the blue panel top.
   - `SETTINGS` is visually centered vertically and horizontally in the visible orange face.
   - X is visually centered inside its blue tile, has no top line/focus artifact when pressed, and sits at the banner's top-right corner.
   - There is no green bottom `CLOSE` button; the X is the sole explicit dismiss control.
   - Music, Sound Effects, and Haptics labels have a deliberate left inset and are readable.
   - All three toggles use the same 78x42 track and 34px thumb geometry and correctly change state.

5. **Settings: in-game variant**
   - All shared banner, X, label, and toggle criteria above also pass here.
   - Restart has clear vertical space below the toggle rows.
   - Restart and Home remain inside the panel, use compact matching geometry, and their text has a readable outline matching the settings-title language.
   - Restart restarts; Home returns home. Check neighboring dismissal behavior.

6. **Hint affordability and readability**
   - At 224 coins, hint is disabled and visibly muted.
   - At exactly 225 coins and above, hint is enabled, fully opaque, and uses the original full-color artwork with no desaturation filter.
   - The `HINT` label is bright white with a dark-purple outline/shadow and is plainly readable on the physical phone.
   - Using the hint deducts the expected cost and does not regress gameplay.

7. **Analytics handoff and dashboards**
   - On a fresh physical-device launch, capture native logs proving Firebase Analytics `logEvent` bridge completion and AppsFlyer initialization/app-open tracking.
   - Then verify event arrival in the Firebase and AppsFlyer dashboards if credentials/access exist. The user does not have Firebase DebugView access, so do not make DebugView a requirement or ask them to use it.
   - Native bridge logs prove handoff, not dashboard ingestion. If dashboard access is unavailable, mark dashboard visibility blocked rather than passing it.

## Automated regression sweep

At minimum run the full unit suite, typecheck, lint, production build, iOS sync, and signed device build. Pay particular attention to:

- `tests/unit/boot-scene.test.ts`
- `tests/unit/board-scene-gate-lifecycle.test.ts`
- `tests/unit/buglist-regressions.test.ts`
- `tests/unit/gameplay-controller.test.ts`
- `tests/unit/gameplay-hud.test.ts`
- `tests/unit/shell-settings.test.ts`
- `tests/unit/device-parity-wave7.test.ts`
- `tests/unit/device-parity-wave8.test.ts`
- `tests/unit/sdk-context.test.ts`

## Evidence and report

Create a new timestamped evidence directory under `games/marble_run/docs/evidence/`. Keep screenshots, recordings, sanitized logs, exact build identity, and a concise Markdown matrix there. Open and inspect every visual artifact yourself.

For each item report one of:

- **PASS** — reproduced the relevant state on the physical phone and observed the requested behavior;
- **FAIL** — observed the defect, with reproduction steps and evidence;
- **BLOCKED** — exact external/device/access condition preventing validation;
- **AUTOMATED ONLY** — tests pass but the required physical behavior was not observed; this is not PASS.

## Definition of done

Done means every checklist item has an honest status, every visual/interaction claim has matching physical-device evidence, all automated checks are recorded, dashboard ingestion is separately classified from native SDK handoff, and no failure or blocker is described as fixed. Do not upload to TestFlight, commit, push, merge, or modify product code as part of this validation-only pass unless the human explicitly expands the scope.
