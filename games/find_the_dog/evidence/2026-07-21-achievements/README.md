# ACH-2 physical-device evidence — 2026-07-21

Genuine on-device proof of the Find the Dog achievement system (TWF card
`gdUIHVjO`), captured on a physical iPhone 12.

## Provenance

- Branch: `trello-gdUIHVjO-ftd-ach-2-achievement-collection-unlock`. Frames
  01/05/06/07 and marker proof3 come from the final build (toast sequencing +
  progress clamp); 03/04/08/09 and markers proof2/proof4 from `proof24` on the
  same sequencing code; 02 from `proof23` (identical collection rendering for
  the states it shows). Base implementation `9380f7bd`; design/behavior fixes
  `50494381`, `8d9c455b`, `eaa686e7`, and this commit.
- Device: physical iPhone 12, iOS 18.7.8, UDID `00008101-000410EC3EF9001E`.
- Bundle id: `com.baseardahan.hiddenobj`, signing team `42L77JAX72`, Debug
  configuration, `vite build --mode ios`.
- Raw result bundles (not committed; large): `games/find_the_dog/.work/collectRun/`
  `proof23.xcresult`, `proof24.xcresult`, `proof25.xcresult`,
  `persist7.xcresult`; earlier iterations retained as the troubleshooting trail.
- Every committed frame is unique (`shasum -a 256` — no duplicated files).

## What each capture shows

1. `01-home-achievements-entry.png` — Home on the CLEAN production build:
   the Achievements entry with the collection's gold medal on an embossed
   glossy pill.
2. `02-collection-states.png` — the deterministic seeded collection (11
   cards): Completed / In progress / Not started with medal badges, state
   chips, themed progress tracks.
3. `03-unlock-callout.png` — the REAL unlock moment: level 1 won through the
   genuine completion path (all 26 dogs via dispatched touch input); the
   in-card callout with medal ("Achievement unlocked — First Find and 1 more —
   Saved to your Achievements"). NO simultaneous toast: `proof2:
   toastDuringCallout=false` (the double-announcement flagged in review
   rounds 1/2/4 is resolved by sequencing). The callout/toast derive from the
   real reducer (`AchievementSystem.apply` →
   `CommittedAchievementDelta.newlyUnlocked`), not a mocked overlay.
4. `04-unlock-callout-settled.png` — the callout after confetti settles.
5. `05-relaunch-home-no-replay.png` — clean production build (no harness, no
   proof scripting) installed OVER the proof build without uninstalling,
   relaunched, 6 s dwell: no callout/toast replay. Gated marker `proof3:
   replay=false cleanBuild=true`; frame distinct from 01 (different capture
   instants, unique hashes).
6. `06-persisted-collection-after-clean-update.png` — collection opened via
   the real Home button on that clean build: `First Find — Completed, Reward
   collected` persisted with real carried progress. Persistence lives in the
   `ftd_achievements` localStorage journal; `processedOccurrenceIds` dedupe
   prevents replay.
7. `07-collection-scrolled-end.png` — scrolled further through the real
   (unseeded) collection: category-differentiated medals (♥ Dogs, ✦ Mastery),
   real completed `Pack Leader 25/25`, and the clamped small progress fill
   (1/5) that no longer collapses into a dot.
8. `08-post-claim-unblocked.png` — AC4: CLAIM tapped ~6 s after the callout
   appeared (`proof4`), coin transfer completed (balance updated), Next Level
   presented — the callout never blocks the completion flow.
9. `09-toast-after-dismissal.png` — the unlock toast (gold medal + "First
   Find +1 more unlocked!") appearing bottom-anchored on the NEXT surface
   (level 2) after the completion overlay is dismissed — the sequenced
   notification that replaces the simultaneous double-announcement.
- `proof-markers.txt` — the four gated markers (proof1–proof4).

## How it was captured

Screenshots were taken by a temporary XCUITest in the committed
`tools/verify-device/runner` project, gated on accessibility markers that the
in-page proof script published only after the harness snapshot confirmed each
state (`achievementsOpen`/`achievementCardCount`, then
`achievementCalloutVisible` after `driveTo('win-achievement')` — seed empty
journal, real `startLevel(1)`, real dog taps, real completion commit). The
Claim/Next flow and persistence run drove the REAL UI (XCUITest taps on the
production build). The proof script lived only in the generated
`dist/index.html` (never in tracked source) and the temporary Swift tests were
removed before the final commit.

Build commands (proof build):

```sh
VITE_ENABLE_TEST_HARNESS=true npx vite build --mode ios   # + proof script injected into generated dist/index.html
npx cap sync ios && node ../../tools/native-shell/apply.mjs --game find_the_dog
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination id=00008101-000410EC3EF9001E -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=42L77JAX72 build
xcrun devicectl device install app --device <udid> <App.app>
# temporary ProofTests / PersistenceProofTests run from tools/verify-device/runner
```

The clean persistence build was identical but WITHOUT
`VITE_ENABLE_TEST_HARNESS` and without any injected script. For proof builds,
generated `dist/levels` was pruned to the first three bundled levels (the full
set is ~5 GB); `public/levels` was never touched.

## Review-round fixes verified in these captures

- Round 1 (P1s): the achievements page no longer scroll-shifts under the
  status bar and shows no native focus ring — modal focus containment now
  focuses the dialog container with `preventScroll`.
- Round 2 (P1s): collection cards use the game's visual vocabulary (medal
  badges, state chips, themed beveled tracks, gold-tinted completed cards);
  the toast clears the HUD and uses the medal glyph, not an emoji; the page
  bottom fades instead of hard-clipping.
- Round 3 (P1): the Home Achievements entry shares the collection's gold
  medal on an embossed pill. Folds: "Not started" chips, deduplicated reward
  lines (full status kept in aria-labels), category glyphs, callout medal.
- Evidence round: distinct 01/05 frames, gated `proof3` no-replay marker,
  post-Claim flow proof, scrolled-end frame, clamped small progress fill
  (with zero-progress bars staying empty), and the callout+toast
  double-announcement resolved by sequencing the toast after dismissal.

## Known limitation: the generic in-situ tour

The standard `verify-device` allstates tour is NOT reliable for these custom
achievement states on device: the Swift runner's canonical state list plus
marker-propagation latency and per-state timeouts caused missed/late captures
even after the underlying input bugs were fixed. The dedicated gated proof
flow above is the reliable lane. (Root causes fixed along the way, now on this
branch: `VITE_INSITU_TOUR` was never in the game's vite `envPrefix` allowlist
so the tour flag could not reach a device bundle; synthetic taps dispatched
only pointer events which Phaser never listens to — the testkit input driver
now dispatches touch/mouse pairs with full page coordinates; single-shot
clicks raced the scene-transition cover — the harness now hit-test-polls
before clicking; and the first-run tutorial gate swallowed harness taps —
tour drives now disable it like the browser flows do.)
