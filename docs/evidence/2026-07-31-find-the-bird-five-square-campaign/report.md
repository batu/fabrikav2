# Find the Bird five-square campaign report

## Result

The active bundled/offline campaign now consists of exactly five 4096x4096 levels in the required order. Browser verification exercises all 75 targets and completes the campaign. The current normal player builds, signs, installs, launches on Batu's iPhone 12, selects Hawaii as level 1, and does not start the automated tour.

The mission is **blocked, not complete** because current physical input evidence is incomplete. After the application identifier changed to `com.basegamelab.findthebird`, the canonical device lane builds, signs, installs, and launches both the app and XCUITest runner. The missing `pause` state and square-camera auto-win failures are fixed and proven on-device. The runner now proceeds through `win` but reproducibly loses the final `fail` marker, so real normal-player taps, pan, pinch, sequential progression, and final completion remain unverified.

## Changed

1. Replaced the 16-entry experimental progression with the five required square levels in `levels-index.json`, `bundled-manifest.json`, and `catalog-manifest.json`.
2. Added campaign/package regression coverage for exact order, 4096x4096 dimensions, 15 targets, 15 unique sprites, centered in-bounds hitboxes, and referenced sprite files.
3. Replaced the square-level legacy 3x tap radius with deterministic nearest-neighbor reconciliation. Square hit regions remain forgiving without overlapping; non-square behavior is untouched.
4. Added a browser campaign verifier and a machine-readable 75-target manifest containing geometry, runtime radius, sprite metadata, and SHA-256 identity.
5. No paid generation call was made. The scenes did not require nondeterministic repair, and Grand Bazaar is visibly top-down.

## Verification

- Unit tests: 40 files, 264 tests passed.
- Typecheck: passed.
- Production Vite build with `VITE_ENABLE_TEST_HARNESS`, `VITE_INSITU_TOUR`, and `VITE_INSITU_TOUR_STATE` explicitly unset: passed.
- Manifest consistency: exact five-level equality is enforced across all three active manifests.
- Browser: five levels loaded in order; 75/75 target centers accepted; five completion states reached; levels 1-4 advanced through the real Claim and Next Level controls; level 5 recorded final completion.
- Browser camera: zoom 1.0 to 2.5; every edge reached; focal error 5.4919 internal pixels on each level; captures show no blank gutters or stuck bounds.
- Browser pan inertia: a real touch flick continued 36 internal pixels, then 4, then settled; every sampled frame remained inside the artwork bounds. The timed frame sequence was opened and visually inspected.
- Visual review: the five minimum-zoom, maximum-zoom, and completion captures were opened and inspected. Birds are present without visible magenta/dead residue, dog imagery, duplicated fragments, or missing parts. Grand Bazaar is an overhead room composition.
- Normal iPhone build: signed bundle `com.basegamelab.findthebird`; executable SHA-256 `606c92cc6c118014627c1e6e8da967529c0d2d39563e35e5029b7fd9f08e4ba4`; installed and launched on `00008101-000410EC3EF9001E`.
- Normal iPhone launch: both current screenshots were opened and inspected. The campaign home shows level 1 selected and remains stable without an automatic tour.
- Latest normal iPhone artifact after the pan-inertia change: executable SHA-256 `61c7f49de7fe3c57eebf6c95209f7e9917c099ba2938b52cd824aed5b0e1cc03`; built with all harness/tour variables unset, installed, and launched on `00008101-000410EC3EF9001E`.

## Physical-device blocker

The prior provisioning blocker is resolved by the new bundle ID plus the repository's established development-team override. The game-specific tour list had omitted `pause`; a red-first regression now locks the canonical order. Square cover-fit also made DOM coordinates diverge from level coordinates under camera scroll, so the deterministic harness now uses level geometry when scroll or zoom changes the world mapping. Current device evidence under `iphone-harness-camera-fixed/` proves menu, level, settings, pause, and win. The run then times out waiting for `fail`; the missing-state capture and accessibility tree show stale Settings UI/marker data, making this a separate runner sequencing/accessibility residual rather than the repaired pause or win paths.

This blocks the evidence types that only physical input can prove: real bird taps, pan feel, pinch feel, all five on-device transitions, and final completion. The installed normal-player screenshots are valid launch/no-tour evidence, but they are not substitutes for those interactions.

## Evidence index

- `target-manifest.json`: 75 deterministic targets and sprite identities.
- `issue-ledger.md`: before/after defects and disposition.
- `browser/results.json`: machine-readable progression, target, pan, zoom, and completion results.
- `browser/*.png`: labeled center, four-edge, zoom, and completion captures for every level.
- `browser/pan-inertia/results.json` and timed frames: measured slowing and visual motion evidence.
- `iphone-normal-updated-id/*.png`: current normal-player captures from Batu's iPhone 12 using the updated bundle ID.

## Remaining unblock action

Repair the reproducible final `fail` marker sequencing/accessibility stall, then run the exact normal-player interaction pass. Until current five-level normal-player recordings exist and are visually inspected, physical-device acceptance remains failed.
