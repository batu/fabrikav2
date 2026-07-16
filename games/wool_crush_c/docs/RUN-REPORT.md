# Wool Crush C — overnight bake-off run report (Claude)

Branch `wool-crush-claude`, game `games/wool_crush_c`, worktree
`fabrikav2-wool-claude`. Goal contract:
`docs/goals/2026-07-17-wool-crush-shell-bakeoff.md`.

## What shipped (verified on device, iPhone 00008101-000410EC3EF9001E)

- **Shell stamp**: `create-game --from shell_template` (tool built tonight on
  main, live-verified). Full playable shell with wool identity
  (`com.basegamelab.woolcrushc.dev`).
- **Gameplay from scratch** (`src/game/`): pure engine written from the
  grilled design docs — Parking Jam tap legality, 4-slot leftmost buffering,
  closest-visible pull with gap-close splice, closest-to-finish priority,
  hold-while-pulling, front-K visibility, conservation-derived seeded dragon,
  head-reaches-cat fail. 24 unit tests incl. per-level structural validity,
  greedy-player winnability, and the teal-death repro. 3 hand-authored levels
  (6/3 → 10/4 → 14/5), shell saga ids beyond 3 cycle maps with fresh seeds.
- **Renderer** (`src/game/WoolRenderer.ts`): S-track + contiguous chunky
  dragon with visibility frosting and eyed head, bobbing cat, 4 spool slots
  with remaining counts, knit-capsule threads with direction arrows,
  release/blocked tweens. Two device-capture polish rounds (track fold,
  HUD collision, hint-pill overlap, scattered body — all found by eye on
  real captures and fixed).
- **Style pipeline**: pixelsmith ingest of `games/wool_crush/refs/art` →
  hand-corrected PINNED style guide (knitted amigurumi identity, yarn
  color_map); wool `--sch-*` scheme + scoped shop/settings blocks; tokens.css
  realigned (drift-guard test enforced it).
- **Copy**: Wool Crush titles, wool-flavored win messages.
- **Evidence**: real played win on device (autoplay build drives REAL taps
  through the real engine): menu → play-entry transition → level 1 →
  "Dragon Unraveled!" win. Full 6-state tour captured (menu/level/settings/
  pause/win/fail).

## THE BLOCKER — image generation (honest ledger)

**$0.00 of the $15 budget spent — every provider is credit-dead:**
- OpenRouter: balance exhausted (630.11 used / 630 credits) → 402 on all
  image models; no free image models exist on the router.
- Google Gemini API: `RESOURCE_EXHAUSTED` — prepay credits depleted.
- fal.ai: "User is locked. Exhausted balance."
- ElevenLabs key: 401 (dead key). No OPENAI_API_KEY exists.
- HF Inference: image models deprecated/no live providers on the router.

Mitigations shipped:
- merceka-core `759289e`: key-gated `google/*` DIRECT Gemini dispatch
  (generate + edit) — verified end-to-end to the billing wall; the moment any
  Google credit exists, generation works without OpenRouter.
- All 15 wool asset-spec briefs authored + committed
  (`design/asset-specs/*.json`) — the full set is one command per spec when
  any provider is topped up.
- Handmade stopgaps (PIL vector art, clearly labeled): yarn-ball loading
  icon, yarn-ball pattern motif (spec wanted a vector anyway), "Wool Crush"
  banner lettering, app-icon candidate (`design/candidates/`).

## Not done / unverified

- Generated asset set (blocked above): saga tiles, nav icons, coin/hint
  identities, shop packs, win/fail marks, title lettering, no-ads art all
  still wear shell (Test Game) art or handmade stopgaps.
- App icon/splash not installed natively (candidate only).
- CLAIM tap, next-level flow after win: exercised via shell tests + tour,
  not in the autoplay video (autoplay doesn't touch DOM buttons).
- Fail overlay reached via harness shortcut in the tour, not via a played
  loss (a played loss takes ~50s of deliberate idling; engine fail path is
  unit-tested and the overlay is shell code).
- The verify-device panel judged NO-APPLICABLE-EVIDENCE — wool has no
  ratified reference set yet (expected for a new game).
- Known shell deferrals inherited: pause≡level indistinguishable, fail tour
  marker blind.

## Decisions worth review

- Dragon preroll (~4 sections on track at start) so the threat reads
  immediately — deviation from "head enters at 0", flagged.
- Head-reaches-cat spends one shell heart and restarts the attempt (fresh
  dragon shuffle); Out-of-Lives at 0 hearts — maps the design's instant fail
  onto the shell's heart economy.
- Renderer autoplay demo mode is build-flag gated (`VITE_WOOL_AUTOPLAY`),
  OFF in normal builds; used only to produce the real-run evidence video.
- Runner gained `testRecordSession` (env-gated record-only session) — lands
  on this branch, generally useful.
