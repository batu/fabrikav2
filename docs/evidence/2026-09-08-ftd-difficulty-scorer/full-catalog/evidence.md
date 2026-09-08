# Full-catalog visual ranking

2026-09-08. Supersedes the earlier 10-level visual pilots.

- Reviewed all 54 listable levels in catalog-000052 and all 1,712 target context crops, alongside each scene overview. Eleven candidate bottlenecks received additional native-source zoom inspection. Ratings are subjective Astra visual judgments, with Waterfall also informed by user feedback; this was not blind detection or player testing.
- `ranking.json` contains the complete per-dog ledger, per-level source hashes, component means and ascending order. `assessment-notes.json` preserves compact review notes: the base value is the rating assigned to the remaining inspected dogs, with individually listed exceptions.
- Aggregation: 20 × (0.80 × maximum rating + 0.15 × mean of highest three ratings + 0.05 × mean of every rating). Scale 1–5, half steps allowed. Differences below two index points should be treated as practically tied. Numeric precision is computational, not statistical.
- Native zoom reduced initial severe ratings for Mossy Stream Roots dog_21, Shipwreck Reef Camp dog_27, Palm Root Ship Ribs dog_21 and Treasure Cove Camp dog_29 because facial or clothing cues remained visible. Final ratings and reasons are in the ledger.
- Validated exact 54-level and 1,712-dog coverage, rating range, target IDs and unchanged hashes of all 54 source images and level JSON files. No source placement, level sequence or game content was edited. No paid provider batch ran.
- Local report: 54 level sections, 216 images loaded, zero broken images, no desktop or 390px mobile overflow. Desktop, mobile and expanded Waterfall screenshots visually inspected.
- Portal post `p_c8ef38`: HTML and JSON returned HTTP 200 in authenticated checks. Hosted HTML contained all 54 sections and 216 loaded images; expanded hardest-level disclosure worked. Hosted first viewport and Roman Ruins evidence screenshots visually inspected. See `portal-verification.json`.

Portal: https://portal.basegamelab.com/s/ftd-difficulty-ranking-20260908

Result: Splash Pad Planters starts the proposed order; Roman Ruins Piazza ends it. Waterfall is #48 of 54, very hard. This remains a proposed visual ordering pending player-data calibration.
