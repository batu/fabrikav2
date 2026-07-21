# Find the Dog achievements: ACH-2 completion handoff

## Mission

Finish, prove, review, and land the Find the Dog achievement system already implemented on TWF card `gdUIHVjO` without disturbing unrelated worktrees or the dirty `main` checkout.

Card: `FTD ACH-2: achievement collection, unlock celebration + device proof`  
Trello: <https://trello.com/c/gdUIHVjO>  
Current TWF column: `Worked`

## Worktree authority

There are two different operating locations. Keep them separate:

- **Conductor checkout:** `/Users/base/dev/appletolye/fabrikav2`
  - Branch: `main`
  - Use only for read-only board orchestration such as `twf orient`, `twf sitrep`, `twf board status`, `twf run-card`, `twf merge-card`, and `twf land`.
  - It contains unrelated July 20 device-evidence changes. Do not edit, stage, commit, clean, reset, stash, restore, or merge from this checkout.
  - Baseline `git status --porcelain=v1 | shasum -a 256`: `8f0d0b6f0f62769d73a8ae53ea7278a7f58b93396fbdaa74d519ab2bffb4ed57`.
- **ACH-2 implementation worktree:** `/Users/base/dev/appletolye/.twf-worktrees/trello-gdUIHVjO-ftd-ach-2-achievement-collection-unlock`
  - Branch: `trello-gdUIHVjO-ftd-ach-2-achievement-collection-unlock`
  - HEAD at handoff: `9380f7bd7567fc216ea368d546c27f36418f1977`
  - All ACH-2 source edits, evidence curation, tests, and commits belong here.
  - `twf orient` reports `WORKER` here because this directory owns the card. A worker may advance exactly one stage and must hand off. Run conductor commands from the conductor checkout.

Do not create a replacement ACH-2 worktree or branch. Do not move this branch onto `main`. Before acting, run `git worktree list --porcelain` from the conductor checkout and verify these paths and branches still match.

## Completed implementation

The branch contains ACH-1 plus ACH-2. Important commits, oldest to newest:

- `407e3bf7` — ACH-1 review fix; durable achievement domain is present.
- `21e47964` — achievement collection and unlock celebration.
- `3ca8a8e7` — device-state registration.
- `3a00efcb` — deterministic achievement seeds and modal focus containment.
- `b62af868` — achievement tour states run first.
- `9380f7bd` — keeps the Home `Achievements` label on one line on iPhone.

Implemented scope includes curated achievements, Home discovery, locked/partial/completed collection states, rewards, durable local journal/migration, analytics sequencing, accessible modal behavior, deterministic harness states, and a nonblocking completion unlock callout. No account, cloud, social, leaderboard, battle-pass, daily-mission, new-currency, or dependency scope was added.

The narrow test suite passed 204/204 before handoff. A signed build installed successfully on the physical iPhone 12 and confirmed the corrected Home entry and achievement collection.

## Device and existing proof

- Device: physical iPhone 12
- UDID: `00008101-000410EC3EF9001E`
- Signed bundle id: `com.baseardahan.hiddenobj`
- Signing team: `42L77JAX72`
- Do not print secrets. The required signing/runtime values already exist in `/Users/base/dev/appletolye/.env` and the game-local iOS env file.

Useful result bundle:

- `.work/collectRun/gdUIHVjO-20260721-achievement-direct-signed.xcresult`
  - Contains `1-home-achievements-entry` and `2-achievements-collection` from the real device.
  - This predates the final one-line label fix; later diagnostic bundles visually confirm the fixed Home label.

The standard generic in-situ tour is not reliable for these custom achievement states: it eventually reaches normal gameplay but does not reliably publish/capture the achievement state. Record that limitation truthfully; do not claim a generic-tour pass.

Several diagnostic `.xcresult` bundles remain in `.work/collectRun/`. They are troubleshooting artifacts, not final unlock evidence. The most recent clean-install automation still showed Home rather than the unlock overlay. Do not mislabel it as unlock proof.

## Remaining work

1. Capture a genuine real-device unlock callout through the real completion/achievement event path.
2. Install a clean, non-proof build **over** that app without uninstalling it, relaunch, open Achievements, and capture persistence. Confirm the unlock callout does not replay.
3. Curate durable evidence under `games/find_the_dog/evidence/2026-07-21-achievements/`:
   - corrected Home discovery;
   - collection with locked, partial, completed, and reward states;
   - unlock callout on completion;
   - persisted completion after clean update/relaunch;
   - a README naming commit, device, bundle id, commands, results, and the generic-tour limitation.
4. Remove generated/untracked symlinks and proof-only source hooks. Confirm `git status --short` contains only intentional ACH-2 evidence/doc changes.
5. Re-run the narrow deterministic checks and inspect the final diff.
6. Advance the card through review/test/evidence stages one stage per TWF worker handoff. Use Opus or Fable workers if desired; do not use `gpt-5.6-sol` high effort.
7. Land only after the TWF merge gates are satisfied: the card advanced exactly one stage per worker, a real handoff exists, and the required code/evidence is on the card branch.
8. Recheck the dirty-main fingerprint and ensure its unrelated files are unchanged.

## Device-proof warning and recommended next experiment

Proof-only hooks were temporarily inserted into `games/find_the_dog/src/bootstrap.ts`, built, and then removed. The tracked file is clean at handoff. The signed bundle contained the hook, but Capacitor/WKWebView did not execute it under the XCUITest launch as expected, even after a clean reinstall. Avoid repeating the same delay-only experiment.

Prefer one of these bounded approaches:

- Extend the existing test harness with a deterministic, explicitly observable native-device trigger whose receipt is asserted before attempting the win; or
- drive level 1 through XCUITest using the real UI and known level/dog coordinates, then capture the real completion overlay.

Whichever route is used, keep it test-only, remove it from tracked production source before the final commit, and ensure the captured callout comes from the real completion event and achievement reducer—not a visually mocked overlay.

## Verification commands

Run from the ACH-2 worktree unless stated otherwise:

```sh
git status --short
git log --oneline -10
twf status
cd games/find_the_dog
npm run typecheck
npm test -- --run
```

For iOS build/sync, the repository's environment validator currently reports an existing canonical-template mismatch (57 versus 58 keys). Do not hide it. The underlying build used successfully was:

```sh
VITE_ENABLE_TEST_HARNESS=true npx vite build --mode ios
npx cap sync ios
node ../../tools/native-shell/apply.mjs --game find_the_dog
node ../../tools/native-shell/validate.mjs --game find_the_dog
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination id=00008101-000410EC3EF9001E -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=42L77JAX72 build
```

The full public level set is about 5 GB. For proof builds, keep level 1 and move other generated `dist/levels` directories to a `mktemp -d` directory before `cap sync`; never delete or modify `public/levels`. Remove only the explicit generated temporary directory afterward. Do not leave a `node_modules` symlink in the worktree.

## Definition of done

ACH-2 is complete only when the implementation remains green, the physical-device evidence set proves Home discovery, collection states, genuine completion unlock, and persistence/no replay after a clean relaunch, the evidence is committed on the ACH-2 branch, TWF review gates and handoffs are satisfied, the card branch is landed through the conductor workflow, and the unrelated dirty `main` checkout is byte-for-byte untouched according to its status fingerprint.

If physical-device proof cannot be obtained after trying a meaningfully different approach, report the exact blocker and leave the card active/blocked as appropriate. Never describe partial browser or unit proof as completion.
