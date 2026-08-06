# Overnight polish RECORD — live status (resume from here after any restart)

Contract: ../plans/2026-08-06-overnight-polish-goal.md. Update this file
after EVERY item. Morning deliverable: build 19 + Telegram report.

## Status board

- [x] D17 build-18 autopsy — IPA levels hash-identical to catalog. Build 18
      was CORRECT; device complaints were floor timidity + center drift.
- [x] Tap floor 38 → 57 (114px effective) — committed, 292 tests.
- [x] D16 close-pair centers — Voronoi-split recentre (guard test: 100px
      pair separates to true centers). ALL 53 re-recentred + re-approved
      (53 OK). NOTE: hitboxes.json/level.json changed catalog-wide →
      CDN REPUBLISH REQUIRED before build 19.
- [x] C7 tutorial targets a visible bird (pans to nearest if none).
- [x] C8 hint ring high-visibility (glow disc + halo + 1.35 pulse).
- [x] C9 tutorial hint tap fires a REAL hint (suppression removed).
- [x] C9b off-screen hint → screen-edge arrow (updateHintEdgeArrow in update()).
- [x] C12 wrong-tap X → DOM layer (.wrong-tap-mark), screen-absolute.
- [x] D13 cleanup margin 32→48 (FTD_CLEANUP_MARGIN env), catalog-wide
      recentre+approve 53/53. Visual re-verify of greenhouse preview pending
      before ship.
- [~] (delegated to design-iterator, sim) A1 Play Now + saga a few px down, bottom-side arrangement (pixelsmith, SIM).
- [~] (delegated) A2 streak div sized like siblings.
- [~] (delegated) A3 achievements+settings buttons toward middle.
- [x] A4 crowned FTD-style no-ads premium icon generated (chroma-key lane), installed.
- [~] (delegated) A5 settings "50 hints" crop fix.
- [~] (delegated) A10/A11 toast font/design + wider container (backdrop overlap).
- [x] A15 confetti z-index 1→30 (in front of finale card), pointer-events none.
- [x] B6 achievements: names de-dogged, +5 tiers (500/1000 birds, 100 completions, 30-day streak, The Whole Atlas 58). Budget 795/19.
- [ ] E1 SHIP — CDN republish RUNNING (final data); build 19 after A-lane lands: publish_ftb_cdn --starters 5 --r2-bucket ftb-levels-prod
      (MANDATORY — recentre changed all level.json) → build:ios+sync →
      archive 19 → upload → VALID poll → Telegram morning report.

## Ops guardrails (hard-won today — do not regress)

- Backend must be RESTARTED after levelbuilder edits; CLI needs
  LEVEL_EDITOR_URL=http://127.0.0.1:5196; backend env carries
  FTD_FLATKEY_MODEL.
- No `2>/dev/null` on driver stages; `&&`-gate everything; pipefail on
  trains; check degradedToFreeChain.
- wrangler r2 needs --remote. OpenRouter key has a WEEKLY cap — watch for
  403s; halt loudly.
- Disk guard: stop batches under 800MB free (df /System/Volumes/Data).
- UI work is SIM-verified only tonight (phone with Batu) — label it so.
- Smallest-3 sprites audit sheet before any ship touching sprites.

## Session facts

- Backend running w/ flash env; credit ~$95; build 18 VALID on TestFlight.
- Order file: tools/level-editor/scripts/wave1_order.txt (53 levels,
  first 5 bundled).
- Archives: scratchpad FTB17/18 only (14-16 deleted).
