# Regeneration blockers — 2026-07-31

1. **Repaint lane needs OpenRouter credits.** ~35 birds across 14 levels have
   non-bird paint (deterministic exclusion fails) plus the semantic sweep's
   finds; `regenerate --dog` goes through `OPENROUTER_API_KEY`, whose balance
   is exhausted (402, 740/740 used). Levels keep their old packages until then.
2. **`italy_venice_canal_morning_bird_d570`:** painted `dog_19` no longer maps
   to any hitbox; `fix-hitboxes` did not reattach it. Needs session surgery
   (restore the hitbox or drop the orphan dog deliberately).
3. **`japan_morning_market_bird_a7a0`:** 18 hitboxes vs reindexed dog dirs —
   hitbox 13 pairs with the wrong dog's sprite ("cleanup geometry does not
   contain its center"). Same class of session-state divergence as (2).

Neither blocked level regressed: the fail-safe staged export leaves live
packages untouched on refusal.
