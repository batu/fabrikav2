# FTB Collection + Sanctuary, release 1 — implementation report

Branch `feat/ftd-collection-sanctuary`, worktree `.worktrees/ftd-collection`.
Six code commits on top of the two design commits. Nothing pushed, no PR.

**Headline: the feature is built and unit-verified, and it builds, installs and
launches on the physical iPhone. It is NOT visually verified on device.** The
plan's §9 checklist and its three agy gates are unrun. Do not treat this as
done until that pass happens — the blockers are below and none of them are in
the code.

## Steps completed

| # | Step | State |
|---|------|-------|
| 1 | Bird type tags + loader | **Partial** — 186 of 855 birds tagged; classifier blocked on quota |
| 2 | Remote-config keys | Done |
| 3 | GameState records | Done |
| 4 | Pure modules (thresholds, accrual, layout, card model) | Done |
| 5 | Pickup hook + chip + analytics | Done |
| 6 | Gating + home routing | Done |
| 7 | Collection deck page | Done |
| 8 | Sanctuary scene | Done |
| 9 | Buy + upgrade | Done |
| 10 | Place | Done |
| 11 | Coin accrual + collect | Done |
| 12 | Motion | Done |
| 13 | WebP + preload | Done |
| 14 | Device pass + agy gates | **Blocked** — see below |

## What is verified, and how

- `npm run typecheck` clean, `npx eslint .` clean.
- **125 new tests across 8 files, all passing.** Suite is 752 passing against
  17 pre-existing failures (see "Not mine" below).
- **On device:** the iOS bundle builds, passes the install lane's provenance
  gate (the App.app's `build-info.json` sha equals HEAD `ec3e7acd92`), installs
  and launches on Batu's iPhone via `tools/native-shell/install.mjs`. That
  proves the code compiles, bundles and boots. It proves nothing about what the
  two screens look like or whether they behave.

What the tests actually pin down, beyond happy paths:

- Card-state boundaries at 9/10, 19/20, 34/35, plus a misconfigured ladder that
  must stay monotonic so a costume can never unlock before its bird.
- A pickup counts once per bird per attempt: a restoration replay or double tap
  re-enters `onDogFound` with the same id and must not pay twice.
- A pickup persists immediately (asserted by reading storage directly), so a
  crash mid-level cannot cost birds already found.
- Accrual pays nothing with no tenant, caps at the offline cap, carries the
  fraction rather than losing it, and pays nothing on a backwards clock.
- Buying refuses at price−1, accepts at price, advances one tier at a time, and
  never mutates the tier when the spend failed.
- Every pedestal anchor in the shipped manifest reproduces in CSS pixels, and
  all three tiers render at one scale so the house cannot jump size on upgrade.
- Every asset the manifest names exists on disk and the set stays under 3 MB.

## Blockers

1. **agy quota exhausted.** `RESOURCE_EXHAUSTED (code 429): Individual quota
   reached` since ~23:00, first reported reset ~01:30. This blocks all three
   mandatory gates (asset sanity, capture judging, layout regression) and the
   bird-type classification. `tools/birdtypes/resume_when_quota.sh` is running
   in the background: it probes once every 20 minutes and, the moment the quota
   clears, classifies the remaining 669 birds and rebuilds `bird-types.json`.
   Two probes so far, both still blocked.

2. **Disk is full, and it is not this session's doing.**
   `~/.local/share/agency/build-outputs/2071f226751e2447/` holds **171 GB across
   77 stale iOS DerivedData directories** from earlier sessions, ~3 GB each. The
   volume has 2.5 GB free. I deleted only the two directories my own builds
   created and left the rest alone — pruning another session's build outputs is
   the operator's call, not mine. Until some of that 171 GB is reclaimed, the
   XCUITest capture runner (which needs several GB for the build plus the
   `.xcresult` export) cannot run.

3. **The iOS capture lane does not fit this checklist as-is.**
   `tools/verify-device` drives the *committed manifest states* for a game and
   diffs them against a reference set. The §9 checklist needs arbitrary state
   injection — bird counts of 9/10/20/35, coin balances of 149/150, house tiers
   1/2/3 — which that lane does not expose. Two honest options for the device
   pass, both cheap once the disk allows:
   - Rebuild with `VITE_ENABLE_TEST_HARNESS=true` and drive state by writing
     `ftb_bird_counts`, `ftd_wallet_coins`, `ftb_sanctuary` and
     `ftd_total_levels_completed` through the harness, then capture. The build
     that is on the phone right now was installed **without** the harness flag,
     so it cannot be driven this way as installed.
   - Add the feature's states to `refs/manifest.yaml` and let the existing
     `verify-device` tour capture them. More work, but it leaves a permanent
     regression net rather than a one-off pass.

## Not mine, but worth knowing

- **17 pre-existing test failures** in `rewarded-hint-offer.test.ts` (16) and
  `five-square-campaign.test.ts` (1). They fail for `localStorage is undefined`:
  the vitest environment supplies none and those two files never install the
  `MemStorage` shim the other suites use. I verified they fail identically at
  HEAD without my changes **and** in the main checkout, so they predate this
  work. My suites install the shim (now shared at
  `tests/unit/support/memStorage.ts`) and pass. Fixing those two files is a
  five-minute job for whoever owns them.
- The worktree needed three environment repairs before anything would build, all
  documented traps: `configs/` and `games/find_the_dog/config` were missing from
  the sparse cone (typecheck could not resolve its base tsconfig), and the
  worktree root had no `node_modules`, which made Capacitor's SPM graph fail to
  resolve `@capacitor-firebase/analytics`. A symlink to the main checkout's
  `node_modules` fixed the last one.
- `npm run build` (web mode) copies all of `public/`, which is **3.7 GB** because
  `public/levels` keeps source PNGs (`bg_00.png`, `bw.png`, `color.png`) beside
  the shipped WebP. That is what filled the disk the first time. Native builds
  are fine: `nativePublicBundlePlugin` copies only manifest-referenced level
  assets, and the iOS bundle came out at **139 MB** against the 200 MB cap.

## Deviations from the plan

- **Step 1 is partial.** The plan's step 1 says classify all 44 bundled levels
  before the UI work. The quota died 11 calls in, so I shipped the loader with a
  deliberately fail-safe contract instead of waiting: an untagged level, an
  untagged bird, a failed fetch or a malformed file all read as "unknown", which
  is never a sparrow. The counter therefore under-counts on untagged levels but
  can never mis-attribute a pickup, so the partial file is safe to ship and the
  resume job completes it unattended.
- **Steps 9 to 12 landed inside `SanctuaryPage.ts`** rather than as separate
  units. Buy, upgrade, place, coins and motion are all one page's behaviour and
  splitting them would have meant a component seam with no second consumer.
- **No `BottomSheet.ts`.** The plan suggested extracting one; the sheet is
  ~40 lines used by exactly one page, so it stayed local. Worth extracting when
  a second page wants one.
- **Assets were downscaled, not just re-encoded.** The plan said WebP q90. The
  PNGs were 15.2 MB for art never drawn above ~420 CSS px, so I capped
  dimensions first: 15.2 MB → 1.1 MB. The two tall sheets are capped on width
  rather than longest side so they stay sharp at 3x.
- **Two analytics dimensions** (`bird_type`, `tier`) had to join
  `dashboardImportDimensionKeys`; a contract test enforces that every
  primary dimension is dashboard-importable.

## Open question for the product, not a defect

Replaying a finished level counts its sparrows again. The within-attempt guard
stops double counting, but nothing stops a player farming level 1 for the
ladder. With thresholds at 10/20/35 that only accelerates the inevitable, and
the plan defines the counters as lifetime pickups, so I left it. If it should be
once-per-bird-per-level instead, that is a small change to the pickup hook and a
bigger one to the save shape.

## Next actions, in order

1. Reclaim some of the 171 GB of stale build outputs (operator's call).
2. Let the resume job finish the bird tags, or re-run
   `tools/birdtypes/classify.py` once the quota clears.
3. Run agy pass A over the installed assets and the sparrow tag sample.
4. Rebuild with `VITE_ENABLE_TEST_HARNESS=true`, drive the §9 checklist, capture
   each row, run pass B and pass C, and fix whatever they catch.
