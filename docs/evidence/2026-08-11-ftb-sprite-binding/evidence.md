---
status: partial
subject: Automatic sprite-to-reviewed-hitbox binding
created: 2026-08-11
mode: interactive
---

# Evidence: Automatic sprite-to-reviewed-hitbox binding

## Verdict

The conservative pipeline automatically repaired 12 of 21 cleanup-identity levels without changing scene, hitbox, or sprite pixels; nine ambiguous levels remain intentionally untouched for human correction.

## What Changed

- Added a global one-to-one sprite-center assignment after exact cleanup containment fails.
- Required both a normalized-distance ceiling and a nearest-alternative margin for every bird in the level.
- Kept the repair transactional: a failed canonical/restore audit rolls the entire level back.
- Preserved existing human review only when the resulting immutable snapshot still validates it.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| test | `uv run --project tools/level-editor pytest tools/level-editor/tests/test_corpus_migration_v1.py -q` | 8 passed |
| lint | `uv run --project tools/level-editor ruff check ...` | passed |
| screenshot | `assets/auto-repaired-pickup-previews.png` | 12 real pickup previews inspected; no obvious residue, foreign-bird erasure, or large seam at contact-sheet scale |
| provider meter | `uv run --project ../merceka-core python -m merceka_core.costs --since ...` | 8 Gemini 3.6 Flash calls, $0.178826 measured |

## Analysis

Gemini detected the painted birds in the rejected scenes, but detection does not establish which already-extracted sprite belongs to which bird. A downsampled color/silhouette assignment trial on Bazaar produced many tied, negative-margin, or globally forced pairings. It was not applied. The remaining nine levels therefore need human sprite placement; automatically guessing would violate the wrong-bird-write gate.

Automatically repaired:

- `ad_campaigns_ad_farm_orchard_bird_33ca`
- `fairytale_forest_giant_hollow_tree_library_bird_de8f`
- `greece_olive_grove_press_bird_dcce`
- `hawaii_north_shore_surf_shack_bird_4fc5`
- `italy_amalfi_cliff_lemons_bird_8fae`
- `japan_morning_market_bird_f461`
- `mexico_oaxaca_market_bird_fb10`
- `nordic_cold_bergen_harbor_bird_d303`
- `nordic_cold_stockholm_christmas_market_bird_53ea`
- `pirate_shipwreck_island_broken_bow_lagoon_bird_6be6`
- `southeast_asia_sea_jungle_temple_ruins_bird_6a6b`
- `southeast_asia_sea_stilt_village_shore_bird_3df8`

## Gaps

Human sprite placement remains necessary for nine levels: Bazaar Alley, Japanese Garden, Alpine Herb Market, Ancient Forest Pond, Fairy Ring Picnic, Greece Agora, Hawaii Surf Shack `51c1`, Japan Night Harbor, and Southeast Asia Floating Market.

## Next Action

Open only those nine levels in the editor and correct their sprite placement; the 12 auto-repaired levels do not need repeated human work.
