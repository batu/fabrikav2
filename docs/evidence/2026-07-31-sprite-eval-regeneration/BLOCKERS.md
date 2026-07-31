# Regeneration blockers — 2026-07-31

1. **Repaint lane needs OpenRouter credits.** ~35 birds across 14 levels have
   non-bird paint (deterministic exclusion fails) plus the semantic sweep's
   finds; `regenerate --dog` goes through `OPENROUTER_API_KEY`, whose balance
   is exhausted (402, 740/740 used). Levels keep their old packages until then.
2. **`italy_venice_canal_morning_bird_d570` / `japan_morning_market_bird_a7a0`:
   scrambled id↔paint bindings.** The stable-id join fix (2cdc0e09) cleared
   the false orphan refusal, but one dog per level has a hitbox ~100–200px
   from its id-bound painted sprite — the session's id assignments themselves
   diverged from the paint. Both levels carry 5–6 repaint-class birds anyway;
   resolve the pairing during the repaint phase (geometry-authoritative
   rebind or repaint the mismatched dog).

Neither blocked level regressed: the fail-safe staged export leaves live
packages untouched on refusal.
