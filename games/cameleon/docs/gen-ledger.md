# CAMELEON image-generation ledger

Hard cap: **$50.00**. fal.ai OFF (user directive). Providers: OpenRouter (gemini-2.5-flash-image
default) / OpenAI image models. Every generation call logs here with a running total.
Envelope (DESIGN.md §9): zone panels ~$4–8 · hide pairs ~$10–16 · one-offs ~$3 · fix reserve ≥$10.

| Date | Batch | Approach | Calls | Est. spend | Running total |
|---|---|---|---:|---:|---:|
| 2026-07-08 | Zone/panel probes: zone3 portrait probe (stretch defect found), panel B square (GOLD), panel A v1 (letterboxed, rejected), panel C v1 (rejected), panel A v2 (accepted base), panel C v2 (accepted base) | 2: background-first panels | 6 | $0.72 | $0.72 |
| 2026-07-08 | Hide-pair probe li-01: v1 (rejected: unpainted head/arm, cartoon outlines), v2 (accepted read; keyed OK) | 3: sprite pairs (magenta-key pipeline validated) | 2 | $0.24 | **$0.96** |

| 2026-07-08 | Hide batch: li-03 ✓, li-04 ✓, li-05 v1 ✗ (two loud tells → decoy), li-09 v1 ✗ (real holes → decoy), li-05 v2 ✗ (printed outline → decoy), li-09 v2 ✓ (revised tell: hugging arms), li-05 v3 ✓ (lounger+mound) | 3: sprite pairs | 7 | $0.84 | $1.80 |
| 2026-07-08 | Decoys: tent ✓, robe ✓ (spec-name text leak, keyed out) | 3 | 2 | $0.24 | **$2.04** |

Working set archived: games/cameleon/.work/gen-2026-07-08/ (specs, raws, keyed sprites,
pano-mock-v1, phone crops). Conductor eyeball log: 5/5 painted hides accepted (li-01 towel
pile, li-03 tent drape, li-04 robe-with-feet, li-05 towel-mound lounger, li-09 hugged ring
stack), 3 rejects salvaged as decoys. Panorama mock: world reads as one lido; defects to
fix downstream — seam color-steps (authored pillar strips ON seams), robe hook rail,
floating decoy towel, ring-stack baseline nudge, gibberish scrub on panel A.

Findings so far: model is square-native (world re-planned to 3×1440² panels, DESIGN §9b);
magenta chroma-key gives clean sprite alphas; white bodies will be AUTHORED flat doughboys
masked into the painted sprite's alpha (deterministic silhouette lock, zero gen cost) —
generation is only spent on painted states. Gibberish text appears on flat fields → cheap
deterministic patch, not a re-roll.
