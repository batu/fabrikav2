# GOAL — Difficulty Ladder (set by Batu, 2026-08-14)

**Every level playable; the deliverable is understanding of the difficulty
control surface on two axes: DISTANCE (map size / zoom) and HIDDENNESS
(occlusion depth + dog size).**

Contract:
1. All 50 levels complete the full lane (paint → localize → bless →
   cutouts → canonical clean) and get an eyes-on overlay verdict. Playable
   means: every painted dog either detected (tappable) or explicitly
   flagged as a decoy; no duplicate or missing sprites; level loads.
2. Per tier (5 levels, one named tweak): record requested vs painted vs
   detected counts, decoy count, and a readability judgment. The tweak line
   in ladder_tiers.json IS the reproducible recipe.
3. The finding that matters: which prompt deltas move difficulty
   REPEATABLY, and where hiding outruns detection (the playability line).
   A tier that crosses the line is kept + flagged, and the line itself is
   documented as a result, not a failure.
4. T10 = the best-behaving combo, run x5 as confirmation.
5. Budget: $110 hard stop. Ledger everything; findings report to portal at
   the end.
