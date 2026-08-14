# Difficulty Ladder — 2026-08-14/15
Goal contract: GOAL.md. 5 levels per tier, one named tweak, eyes-on gate
between tiers. Ask is 30 dogs on every tier; only the tweak varies.

## T1 — map axis: wide view baseline (~30 placements, 6-8 clusters)
japan_river_bridge 23 · uk_cotswolds 23 · sami_aurora_camp 27 ·
hawaii_volcano 21 · nice_promenade 21. **Mean 23.0 / 30 ask.**
Canonical clean on all 5 (0 dupes, 0 spriteless). Detection 115/115 —
zero decoys, including two accidentally hard finds (black lab on volcanic
rock, grey whippet on basalt) and a sweater-poodle asleep on folded
blankets at sami.
VERDICT: PASS. Wide view lifts capacity vs the close-view ramp (23.0 mean
vs 17-21 typical) without any readability loss at phone size. Detection is
NOT yet the limiting factor — headroom exists for the hiding axis.
WATCH: japan_river rendered as a dark-void floating diorama rather than
full-bleed; framing drift to monitor, not yet a defect.

## T2 — size axis: T1 wide view + dogs one notch smaller
cenote_ruins 23 · mardin_stone_terrace 14 · tuscan_hill_village 30 ·
enchanted_stream 28 · pirate_palm_root 25.
VERDICT: PASS on difficulty (smaller dogs read as small props; two of my
own thumbnail reads were wrong and needed zooming — that IS the difficulty
working), but the tier exposed two things bigger than the tweak:
1. **Scene archetype dominates capacity.** Same tier, same 30 ask: dense
   multi-level village 30, forest-with-stream 28, sparse stone terrace 14.
   A 2x swing from scene choice alone — larger than any prompt delta so far.
2. **DEFECT FOUND — magenta residue.** pirate_palm_root shipped the lane's
   magenta placement rings visible in the artwork (64,296 px; healthy
   levels measure 0) while passing every other check: 25 detected,
   canonical clean, no dupes. New deterministic detector +
   test + batch gate landed (levelbuilder/api/magenta_residue.py). Sweep of
   all 29 painted dog levels: 1 defective, now flagged for repaint.
FLAG: mardin has one likely false positive (a cat in a window arch claimed
as a dog) — first of the run; operator's eyes needed.
