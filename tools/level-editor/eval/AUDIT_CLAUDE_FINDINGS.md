# Pipeline cost/speed audit — Claude pass (2026-08-05, at tag ftb-canonical-v1)

Method: walked every canonical step (PIPELINE.md), read the actual prompts and call
sites, and reconciled against the merceka ledger (~/.merceka/costs.jsonl).

## Ledger reality check (2026-08-04 → 08-05)

- $113.15 metered total; $92.68 of it is 1204 flash-image calls — the experiment
  churn of the elimination day, not the canonical lane. Canonical lane per level is
  2 flash draws + 2–3 lite draws ≈ $0.15–0.16 image spend, matching PIPELINE.md.
- **96 ledger rows have usd=None** (OpenRouter returned no cost): 53 pro-image,
  13 flash-image, 9 gpt-5.4-image, others. Real money, unaccounted.

## Findings, ranked

1. **Smart-placement scoring is fully unmetered.** `smart_hitboxes.py` goes through
   `merceka_core.llm.LLM`, which never writes costs.jsonl — the ledger has zero
   text-model rows for `google/gemini-2.5-flash`. Fix: ledger hook in the LLM path
   (same writer `merceka_core.costs` uses). Also closes the fal/ESRGAN gap if done
   at the client layer.
2. **Placement scorer runs a legacy model id**: `SMART_PLACEMENT_MODEL =
   "google/gemini-2.5-flash"` (smart_hitboxes.py:26). Per standing rule, pick the
   replacement from the live OpenRouter catalog, not recall — but 2.5-flash is two
   generations old; a current flash tier is almost certainly cheaper and faster for
   36-candidate JSON scoring.
3. **Scoring chunks run serially** (36 candidates → 2 chunks of 20, one round-trip
   each, smart_hitboxes.py:318). Parallelizing the 2 chunks, or raising
   SCORING_CHUNK_SIZE to 36 if the contact sheet stays legible, saves ~30–60 s/level.
4. **Paint/bg attempt counts are invisible.** The aspect guard bills every refused
   draw ($0.068 each) but `write_generation_sidecar` records only the final success.
   Add `attempts` to the sidecar so retry burn is measurable before it matters at
   1000-level scale.
5. **VLM audit cadence**: `detect_birds_vlm` (gemini-3.6-flash, ~$0.02/call) is
   correctly out of the per-level path — keep it sampled (e.g. 1 in 10 levels)
   rather than per-level when batch regeneration starts.
6. **Prompts are fine as-is.** bg/scene, magenta task, and grid prompts are clear
   and unambiguous; image calls bill per-image, so token trims save $0. Only clarity
   changes would be justified, and none are needed.
7. **ESRGAN stays.** 1K→2688 upscale is evidence-backed (junk-prop invention with
   soft input) and costs ~2–7¢; the fix is metering it (finding 1), not removing it.

## Non-findings (checked, no action)

- n_options=1 for backgrounds (single billed draw) — confirmed in session.json.
- Cutout ladder retries are judge-gated and capped (attempts=2 per rung).
- Chrome-band + side-margin crop already cuts ~20–25% of pixels per paint send.
- Paint band paste has a ≤2% lanczos snap after the guard — intentional, safe.
