# FTB Collection + Sanctuary, release 1 — implementation report

Branch `feat/ftd-collection-sanctuary`. Nothing pushed, no PR.

**All 14 plan steps are done and verified on the physical iPhone.** Ten
checklist states were driven on device, captured, and judged PASS by the image
gate. Gate A passes both halves. Gate C is recorded with an explanation below:
it compares against design sheets that predate the device pass, and every
difference it found is a correction I made during that pass.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx eslint .` | clean |
| `npm run test:unit` | **791 passing**, 1 pre-existing failure (below) |
| Gate A — assets | **16/16 pass** |
| Gate A — sparrow tags | **40/40** agreement on tagged sprites |
| Gate B — device captures | **10/10 rows pass** |
| Gate C — vs design sheets | 1/4 match, all four differences explained below |

Captures: `captures/` (WebP, 10 states). Verdicts: `gate-a-verdicts.jsonl`,
`gate-a-tag-audit.jsonl`, `gate-b-verdicts.jsonl`, `gate-c-verdicts.jsonl`.
Reference set for future runs: `games/find_the_bird/refs/collection-sanctuary/`.

## What the device pass found that tests could not

Every one of these passed unit tests and looked fine in code review.

1. **Every text row on the collection card was one slot too low.** The name sat
   on the ribbon, the ribbon text sat in the bubble, and the personality lines
   overflowed off the card. The manifest's plaque/ribbon/bubble bands were
   estimates I wrote when the art was generated and never checked against the
   art. Measured from the card's centre column they are 700–855, 860–958 and
   988–1207, not what was there.
2. **The tier-3 house ran off the right edge**, taking its deck and third perch
   with it. The house was scaled to the background, and the background is
   cover-fitted, so on a tall phone it is far wider than the screen. The scale
   is now capped to the widest tier and the position clamped, tested at three
   phone sizes.
3. **Birds stood beside their perch, not on it.** A sparrow's tail pulls its
   sprite's geometric centre about 12% of its width left of its legs, so
   centring the sprite on the pedestal put the feet too far right. The manifest
   now records where the feet actually sit and placement anchors on that.
4. **The house sprites carried magenta keying residue** — a purple rim from the
   magenta-plate generation, about 0.8% of visible pixels. I did not see it; the
   gate did, on the tier-3 capture. Repeat de-fringe passes took it down 95%,
   each pixel taking its nearest clean neighbour's colour so the silhouette and
   the wood edges are untouched.
5. **The beanie's pom-pom was clipped away by the porthole.** The portrait was
   sized to fill the circle's width, so the taller costumes overflowed the top —
   cutting off the very detail that distinguishes the hat state. Portraits now
   fit the circle.
6. **The empty-perch marker read as a pale smudge**: cream art on a bright sky
   with no shadow, pulsing down to 55% opacity. Given a drop shadow and a
   shallower pulse.
7. **The marker floated above the branch** while a real bird stood on it
   correctly: the bird sprites are trimmed to their content but the markers
   carried 28px of transparent padding below the art. All three markers trimmed.

Two more, in the harness rather than the product:

8. **HomeScene's shutdown clears the whole `#hud-overlay`.** Phaser flushes a
   `stop()` on a later step, so a teardown queued by a home re-render landed
   after the driven page opened and silently removed it. The drive now seeds
   before a single home render, settles, and re-confirms past the tour's own
   settle window. This is why the same drive passed in a debug build and failed
   in a clean one — the badge's extra work was hiding the race.
9. **`VITE_INSITU_TOUR_STATE` was never an allowlisted env key**, although
   `runtime.ts` already read it, so vite's exact-env define dropped it and every
   capture build walked the entire tour instead of parking on one state.

## Gate C, honestly

Gate C compares the device against
`docs/sanctuary-exploration/vertical-slice-2026-09-16/assets/`. Those sheets are
composites I built with **estimated anchors on a flat background, before the
device pass**. Its four findings:

- *placed*: "bird shifted right, overlapping the roofline" and "an extra oak
  leaf" — the shift is fix #3, the leaf is the real background's foliage, which
  the flat sheet never had. I looked: the bird's feet are on the platform and it
  reads as standing in front of the house.
- *tier3*: "sparrow wears only a beanie", "silhouette on a branch not a swing",
  "coin pile absent" — the captured state seeds 20 sparrows and no pending
  coins, so it is a different state, not a different layout.
- *cardigan*: "pom-pom present, bird scaled down" — that is fix #5.
- *unlocked*: matches.

So gate C found no regression; it found that its reference was stale. Rather
than re-point it at the current build and claim a trivial pass, the ten approved
device captures are now committed as the baseline in
`games/find_the_bird/refs/collection-sanctuary/`, which makes the gate
meaningful for the next change.

## Bird tags

All 855 birds across the 44 bundled levels are tagged, up from 186.

agy's individual quota died 11 calls in, so classification moved to
gemini-3.8-flash through OpenRouter. Two traps: the endpoint refuses
`reasoning: false`, and with a 200-token budget the reasoning consumed the whole
allowance and returned empty content, which looked like 439 parse failures.

The second was real and mattered. A blind audit found wrens, chickadees,
finches and thrushes carrying the sparrow tag — the broad classifier defaults
small brown cartoon birds to "sparrow", and sparrow is the only tag this release
spends. Every sparrow-tagged sprite now faces a stricter binary question with
the discriminating features spelled out, and anything unconfirmed is demoted to
`unknown-songbird`. That trades recall for precision deliberately: a false
positive makes a wren visibly tick the sparrow card, a false negative only slows
the ladder. 150 tags became 78, and the audit went from 27/40 to 40/40.

## Deviations from the plan

- **Steps 9–12 landed inside `SanctuaryPage.ts`** rather than as separate units.
  Buy, upgrade, place, coins and motion are one page's behaviour; splitting them
  would have meant a seam with no second consumer.
- **No `BottomSheet.ts`** extracted: about 40 lines with one caller.
- **Assets were downscaled before WebP**, not just re-encoded: 15.2 MB of art
  that is never drawn above ~420 CSS px became 1.1 MB. The two tall sheets are
  capped on width rather than longest side so they stay sharp at 3x.
- **Two analytics dimensions** (`bird_type`, `tier`) had to join
  `dashboardImportDimensionKeys`; a contract test enforces that.
- **Numbers are as specified** (level 5, 10/20/35, 150/300/900, 3/6/10 per hour,
  4 h cap), all behind their remote-config keys.

## The one failing test, and why I left it

`five-square-campaign.test.ts` asserts the bundled manifest equals the first five
levels of the index, while the manifest now carries the full 44-level reviewed
lineup — the lineup `nativePublicBundlePlugin` raised its cap to 200 MB to
accommodate. It is a shipping policy the build moved past, not a broken test
environment, and rewriting it to make my run look green would be changing
someone else's assertion for my convenience. The other 16 pre-existing failures
were a missing `localStorage` shim and are fixed.

## Open question for the product

Replaying a finished level counts its sparrows again. The within-attempt guard
stops double counting, but nothing stops farming level 1. With thresholds at
10/20/35 that only accelerates the inevitable, and the plan defines counters as
lifetime pickups, so I left it. If it should be once-per-bird-per-level, that is
a small change to the pickup hook and a larger one to the save shape.

## Notes for whoever builds here next

- The worktree needed `configs/`, `games/find_the_dog/{config,src}` and a
  `node_modules` symlink before anything would build; without the last one
  Capacitor's SPM graph cannot resolve `@capacitor-firebase/analytics`.
- `npm run build` (web mode) copies all of `public/` — 3.7 GB, because
  `public/levels` keeps source PNGs beside the shipped WebP. Native builds are
  fine: only manifest-referenced assets ship, and the iOS bundle is 139 MB
  against a 200 MB cap.
- Capture builds bypass `npm run build:ios` on purpose: its validator rejects any
  non-empty `VITE_INSITU_TOUR` by policy, which is exactly what a capture build
  needs. `/tmp/ftb-capture.sh` takes the same route verify-device does.
