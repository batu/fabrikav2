# Task: independent cost/speed/prompt audit of the canonical FTB pipeline

Repo: /Users/base/dev/appletolye/fabrikav2, tools/level-editor. Read PIPELINE.md first — it is
the canonical recipe and must NOT be changed by you. This is a READ-ONLY review: produce a
findings report, change no code.

Goal: find further cost or speed cuts, and prompt improvements, in the canonical lane:
create → generate-bg (gemini flash 1:1 1K, $0.068) → esrgan upscale to 2688 → smart dot
placement (vision-scored) → magenta full-scene paint (1 flash call, square 2048 send,
$0.068) → recenter-hitboxes-local → HITL → batched 3x3 flat-key cutouts (flash-lite,
$0.0045/bird) → export gates → approve --bundled.

Review specifically:
1. levelbuilder/prompts.py (bg/entity/scene prompts), levelbuilder/api/prompts.py,
   levelbuilder/api/inpaint.py (magenta paint task prompt), levelbuilder/api/flatkey.py
   (FLAT prompt + GRID_PROMPT_TEMPLATE), levelbuilder/api/smart_hitboxes.py (vision scoring —
   is this call worth its cost? is it metered?).
2. Redundant/expensive steps: duplicate image encodes, repeated PNG round-trips, serial calls
   that could parallelize, VLM audit cadence, esrgan necessity at 1K→2688.
3. Prompt token waste and prompt clarity risks (ambiguity that causes retries).
4. Anything unmetered that spends money (grep for openrouter/openai/fal call sites vs the
   merceka cost ledger).

Do NOT relitigate the eliminated approaches listed in PIPELINE.md ("What was eliminated").
Do NOT propose changing the 2048 square send, radius/canvas constants, or the gates.

Output: write your findings to tools/level-editor/eval/AUDIT_CODEX_FINDINGS.md, ranked by
expected $ or minutes saved per level, each with file:line evidence. No code changes.
