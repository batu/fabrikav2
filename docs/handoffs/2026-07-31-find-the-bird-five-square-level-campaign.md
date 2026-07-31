# Find the Bird five-square-level campaign handoff

## Mission

Finish the five Gemini Flash square Find the Bird levels as the actual playable campaign, test every bird/hitbox and the complete level flow, improve weak visual/gameplay results, and produce current browser plus physical-iPhone evidence. The present build contains the five square levels, but they sit at positions 12–16 behind eleven older experimental levels. That is not the requested final campaign.

## Workspace and ownership

- Repo: `/Users/base/dev/appletolye/fabrikav2`
- Worktree: `/Users/base/dev/appletolye/fabrikav2/.worktrees/feat-find-the-bird-reskin`
- Branch: `feat/find-the-bird-reskin`
- Recorded HEAD: `c63bf2da0795378c5760e70c427ce09431778486`
- Game: `games/find_the_bird`
- The worktree is heavily dirty and shared with another agent completing App Store metadata, public legal pages, icons, native release resources, and upload preparation.
- Your ownership is limited to the five square level packages, level ordering/catalog projection, square-level runtime behavior, focused tests, and square-level evidence.
- Do not edit `games/find_the_bird/src/platform/LegalLinks.ts`, native app icons/resources, `personal_site`, App Store metadata/upload scripts, or `docs/handoffs/2026-07-31-find-the-bird-app-store-completion.md`.
- Do not clean, reset, revert, broadly stage, commit, merge, deploy, or overwrite changes made by other agents. You are not alone in the codebase; accommodate concurrent edits.
- Run `twf orient` and `git status --short` first.

## The required five-level campaign

Use exactly these five levels, in this order unless current gameplay evidence provides a concrete difficulty reason to reorder them:

1. `square_hawaii_waterfall_flash_4k`
2. `square_pirate_cove_flash_4k`
3. `square_yucatan_cenote_flash_4k`
4. `square_sami_aurora_flash_4k`
5. `square_grand_bazaar_flash_4k`

Each package currently reports:

- 4096×4096 level/background imagery;
- 15 bird targets using the legacy schema's `dogs/dog_NN` paths (keep schema compatibility; do not perform a dog-to-bird schema refactor here);
- generated sprite cutouts and hitboxes;
- clean-old-cartoon style generated with Gemini Flash;
- inclusion in `public/levels/levels-index.json`, `bundled-manifest.json`, and `catalog-manifest.json`;
- presence in current `dist` and synchronized iOS public assets.

Current defect: `levels-index.json` contains 16 entries. Eleven experimental/older levels come before these five, and the installed player starts on `fairytale_forest_mushroom_cottage_glade_bird_d894`. Make the five square levels the shipped campaign rather than merely appending them. Do not delete source packages blindly; remove non-campaign levels from active manifests/catalog selection using the smallest established mechanism and preserve recoverability.

## Existing implementation and evidence

Read and inspect:

- `docs/evidence/2026-07-31-find-the-bird-square-flash-game-ready/`
- `docs/evidence/2026-07-31-find-the-bird-square-flash-game-ready/browser/results.json`
- `docs/evidence/2026-07-31-find-the-bird-square-flash-game-ready/verify-browser.mjs`
- `games/find_the_bird/src/data/playableAspect.ts`
- `games/find_the_bird/src/scenes/levelFit.ts`
- `games/find_the_bird/src/scenes/GameScene.ts`
- `games/find_the_bird/src/scenes/PinchZoom.ts`
- `games/find_the_bird/src/testing/TestHarness.ts`
- `games/find_the_bird/tests/unit/playable-aspect.test.ts`
- `games/find_the_bird/tests/unit/level-fit.test.ts`
- all five `public/levels/square_*_flash_4k/level.json` files and full-resolution assets.

The existing browser evidence proves all five loaded, reported 4096×4096, exposed 15 targets, could find `dog_00`, and exercised some zoom/pan. It does **not** prove all 75 birds align, every hitbox is valid, every sprite is clean, all five can be completed, progression uses only these five, or phone game feel is acceptable.

## Required quality audit

Open every full-resolution `color.png`, clean background, and all 75 cutout sprites. For each level verify:

- exactly 15 visible birds and exactly 15 hitboxes;
- one hitbox per visible bird and no hitbox on empty scenery;
- hitbox center and radius match the visible bird at runtime after all square-fit transforms;
- no clipped cutouts, magenta/dead pixels, opaque rectangular residue, duplicated fragments, missing body parts, or dog remnants;
- bird apparent sizes are reasonably consistent within the previously accepted ±25% tolerance while retaining fair difficulty;
- birds are distinguishable from decorations without becoming trivial;
- no target is hidden under HUD/safe-area controls at minimum zoom;
- the full square is reachable through pan/zoom without blank gutters, stuck bounds, jumps, or losing the focal point;
- touch targets remain forgiving on iPhone while not overlapping neighboring birds;
- the Grand Bazaar reads as top-down/overhead, not a corridor looking into the distance.

Use deterministic geometry/reconciliation for hitboxes and cutout cleanup where possible. Do not ask an image model to guess deterministic coordinates. If a scene itself is materially defective and cannot be repaired deterministically, use the existing familiar level-editor CLI and Gemini Flash only, keep the same scene concept/style/15-bird contract, record the paid call and cost, and replace nothing until the regenerated result is visually superior and passes the same audit. Do not use Gemini Pro or OpenAI for this task.

## Tests to add or strengthen

Write a failing regression test before each runtime/geometry fix. Add deterministic coverage for:

- active campaign contains exactly the five IDs in the intended order;
- each package is 4096×4096 and has exactly 15 unique targets/sprites;
- hitboxes are finite, in bounds, nonzero, and map one-to-one to sprites;
- square cover-fit and pan bounds across representative iPhone portrait viewports/safe areas;
- minimum/maximum zoom, focal-point preservation, edge reachability, and no blank gutters;
- full progression from level 1 through level 5 and correct final completion behavior;
- no fallback to an older experimental level when CDN/remote sequence is absent or fails;
- runtime catalog and bundled manifests agree with the five-level campaign.

Do not satisfy tests by weakening validation or hardcoding browser-only behavior.

## Required live verification

1. Run the focused unit/type/build checks discovered from the game package.
2. Extend the existing browser verifier to exercise all 15 birds in all five levels, complete each level, traverse progression, test pan to all edges, and test pinch/zoom at representative points.
3. Capture labeled full-resolution browser evidence for each level at minimum zoom, useful gameplay zoom, and near each edge.
4. Use the repository's canonical `game-device-verification` / `tools/verify-device` lane on Batu's physical iPhone 12 (`00008101-000410EC3EF9001E`). The automated harness build may drive and diagnose states, but final acceptance must also use a normal player build with all tour variables explicitly unset.
5. Install and launch the exact normal player artifact, prove level 1 is Hawaii and progression reaches all five square levels, exercise real taps/pan/pinch, and capture current physical-device evidence for every level.
6. Open and inspect all captures yourself. Build success, JSON validity, or one found bird is not visual proof.

Preserve the production bundle-ID work owned by the App Store agent. Coordinate before rebuilding/syncing `ios/` if concurrent native work is underway; do not overwrite its icon, signing, legal URL, or release changes.

## Evidence output

Write sanitized evidence under:

`docs/evidence/2026-07-31-find-the-bird-five-square-campaign/`

Include:

- machine-readable manifest of the five levels and all 75 targets;
- before/after issue ledger with coordinates and remediation;
- test and build results;
- browser captures and results;
- physical-iPhone captures/recordings with device/build identity;
- a concise report stating what changed, what worked, what failed, and remaining blockers.

## Definition of done

- The active bundled/offline campaign contains exactly the five square levels in the agreed order; no older experimental level appears in normal progression.
- All five levels are 4096×4096, contain exactly 15 clean visible bird sprites, and have exactly one correctly aligned, forgiving hitbox per bird with no empty-scene targets.
- Every one of the 75 targets is automatically exercised and every level can be completed in sequence.
- Square cover-fit, pan, pinch zoom, safe areas, HUD overlap, and edge reachability are verified in tests, browser, and the physical iPhone normal player.
- Grand Bazaar is genuinely top-down and all five levels meet the visual/gameplay quality audit.
- Focused tests, typecheck, production build, manifest consistency, and device verification pass.
- Evidence is visually inspected and durable.
- Unrelated concurrent work remains untouched.

Continue until every definition-of-done item is met. If blocked by a device lease, provider credential/quota, or concurrent native sync, finish all unblocked work and report the exact sanitized blocker. Blocked is not complete.
