# Independent audit: canonical FTB pipeline

Date: 2026-08-05

Scope: read-only review of the locked pipeline in `PIPELINE.md`. I did not
reconsider any eliminated lane, and I do not recommend changing the 2048 square
send, radius/canvas constants, or export gates.

## Ranked findings

### 1. Fix the magenta prompt's contradictory subject count before tuning models

**Expected saving:** up to one avoided paint retry, **$0.068 and roughly one
provider-call latency** on affected levels. The incidence needs measuring, so
this is a high-impact retry-risk finding rather than a claimed average saving.

The canonical entity prompt begins with both “Add exactly one bird to this crop”
and “Place exactly one bird...” (`levelbuilder/prompts.py:991-993`). Magenta mode
removes only the latter fragments (`levelbuilder/api/inpaint.py:4669-4687`), so
the former survives inside `SUBJECT` while the wrapper separately commands one
subject for *every* circle (`levelbuilder/api/inpaint.py:4705-4712`). For a
16-marker full-scene edit, “exactly one ... to this crop” and “replace every
circle” are directly inconsistent.

Recommendation: make the magenta wrapper consume a dedicated entity-description
brief (appearance, variety, activity, scale) rather than trying to strip
imperative sentences from the crop prompt. At minimum, strip the opening “Add
exactly one ... to this crop” sentence too. Add a prompt snapshot test asserting
that the final magenta prompt contains only the per-marker count instruction.

Two smaller ambiguities belong in the same prompt-only A/B:

- “Do not introduce any magenta, pink, or fuchsia tones elsewhere” can conflict
  with preserving legitimate existing pink scene art, while the next clause
  demands pixel identity (`levelbuilder/api/inpaint.py:4725-4733`). Say not to
  create or retain **marker-color `#FF00FF`** outside subjects instead of banning
  an entire color family.
- The scale paragraph cites “people” as a reference even though the background
  prompt bans people (`levelbuilder/api/inpaint.py:4713-4721` and
  `levelbuilder/prompts.py:1093-1099`). Use only likely scene anchors such as
  doorways, furniture, crates, stalls, and trees.

### 2. Smart placement silently expands to 64 candidates and four serial, unmetered calls

**Expected saving:** **three vision-call latencies and about 75% of smart-placement
spend per 16-bird level** if a one-call shortlist is validated. Exact dollars
cannot honestly be stated because these calls are not metered.

The API advertises a default candidate count of 36
(`levelbuilder/api/routes.py:1704-1710`), but the smart caller replaces it with
`max(candidate_count, n * 4)` (`levelbuilder/api/smart_hitboxes.py:368-375`). A
canonical 16-bird level therefore scores 64 candidates. With a chunk size of 20
(`levelbuilder/api/smart_hitboxes.py:26-32`) and a serial loop
(`levelbuilder/api/smart_hitboxes.py:316-332`), this is **four paid calls**, not
one.

The call is worthwhile in principle: geometry alone cannot distinguish ground
beside props from roofs, walls, water, or sky, which is precisely the semantic
job documented at `levelbuilder/api/smart_hitboxes.py:1-7`. Do not remove it
without an A/B measuring HITL corrections and paint no-ops. Instead:

1. deterministically generate the large geometry-safe pool;
2. cheaply pre-rank spatial coverage/diversity and send only a validated
   one-sheet shortlist (start by testing the declared 36);
3. compare selected-location acceptance and HITL edit time against today's
   64/four-call baseline.

Metering is a prerequisite to that experiment. `merceka_core.llm.LLM` sends the
OpenRouter request and returns only parsed content
(`/Users/base/dev/appletolye/merceka-core/merceka_core/llm.py:571-585`); it does
not request usage or call the cost ledger. The canonical smart scorer uses that
path (`levelbuilder/api/smart_hitboxes.py:307-331`). This explains the documented
metering gap in `PIPELINE.md:45-50`; the live ledger contained no
`google/gemini-2.5-flash` placement rows during this audit.

### 3. Make the “periodic” VLM audit actually periodic, not a per-level budget item

**Expected saving:** at a 1-in-10 audit cadence, approximately **$0.063 per level**
using the pipeline's stated ~$0.07 audit cost, plus one call latency on 90% of
levels. At 1-in-5, save ~$0.056 per level.

The locked recipe says local diff snapping achieved 16/16 with zero false
positives and that VLM detection remains a **periodic auditor**
(`PIPELINE.md:30-32`), yet the cost rollup charges a VLM audit on every level
(`PIPELINE.md:45-49`). The VLM path is independent of the required export gates:
it downsizes and PNG-encodes `color.png`, then makes one detection call
(`levelbuilder/api/inpaint.py:4848-4874`). Both Google-direct and OpenRouter paths
are already explicitly metered (`levelbuilder/api/inpaint.py:4892-4898` and
`4923-4927`).

Recommendation: run the auditor on the first level of a batch, a deterministic
sample thereafter (for example 10%), and every level triggered by anomalous
local-diff counts, large snaps, pruned hitboxes, or HITL concern. Record cadence
and trigger in the session. This preserves the auditor and all gates while
aligning actual spend with “periodic.”

### 4. Parallelize independent flat-key grid calls within each retry rung

**Expected saving:** roughly **one grid-call duration per clean 16-bird level**;
cost is unchanged. The initial 3x3 rung has two independent calls (9 + 7 birds),
so wall time can approach the slower call rather than their sum.

The batch implementation loops serially over chunks and calls `edit_image`
inline (`levelbuilder/api/flatkey.py:311-325`). A canonical 16-bird level thus
makes two serial 3x3 calls before any dependent retries. Only after all paid
batch work completes does sprite materialization enter its thread pool
(`levelbuilder/api/session.py:2791-2835`).

Recommendation: execute chunks in the same rung with a small bounded pool (two
is sufficient for 16 birds), collect results deterministically by input index,
then proceed to the dependent 2x2 and single rungs. Reuse the existing provider
concurrency policy rather than creating an unbounded path.

### 5. The batch cutout path is called “judge-gated” but bypasses both the judge and `flat_ok`

**Expected saving:** unquantified but potentially material: fewer 2x2/single
regenerations and fewer manual repairs caused by accepting a bad batch panel as
“prevalidated.” Validate against the existing native2k corpus before changing
the retry rate.

Single-image recreation runs `flat_ok`, cleanup, and `judge_gate`
(`levelbuilder/api/flatkey.py:190-215`). Batch panels only run chroma key,
despill, rim stripping, and a broad subject-area check
(`levelbuilder/api/flatkey.py:284-291`), yet the caller passes these results as
`prevalidated=True` (`levelbuilder/api/session.py:2746-2760`). In that mode,
downstream quality checks are explicitly bypassed
(`levelbuilder/api/inpaint.py:1829-1866`). This does not match the canonical
description “Ladder: 3x3 → 2x2 retry → single (judge-gated)”
(`PIPELINE.md:31-32`).

Recommendation: apply the cheap deterministic `flat_ok` equivalent per batch
panel before accepting it. Do not add a paid per-bird VLM judge; use the existing
HITL and deterministic gates, and reserve any visual judge for sampled audits.
Also clarify the pipeline text after behavior is validated: currently only the
single fallback invokes `judge_gate`.

### 6. Clarify the final partial grid to reduce invented panels and fallback calls

**Expected saving:** one avoided fallback call for each panel failure prevented;
the single fallback costs about **$0.034 per bird** per `PIPELINE.md:31-32`.

For the second canonical 3x3 call, the composed input contains seven occupied
cells and two blank white cells (`levelbuilder/api/flatkey.py:243-252`). The
prompt nevertheless says “Each panel shows one cartoon bird,” “recreate EACH
panel's bird,” and “exactly one bird per panel” while separately reporting a
count of seven (`levelbuilder/api/flatkey.py:228-237`). That invites the model to
invent birds in empty cells or reinterpret the grid.

Recommendation: explicitly define row-major occupied cells 1 through `{count}`,
state that remaining cells are empty padding and must contain no subject, and
say the output must retain exactly `{count}` birds. Keep the validated 3x3 cap
and splitter unchanged.

### 7. The background prompt says “portrait” for the canonical square request

**Expected saving:** retry-risk reduction, potentially **$0.068 per rejected
background**; incidence is not measured.

Both scene-prompt assemblers hard-code “full-bleed portrait”
(`levelbuilder/prompts.py:1073-1076` and
`levelbuilder/api/routes.py:145-160`), while the canonical create request is 1:1
(`PIPELINE.md:24-26`). The server recipe request does not carry aspect ratio into
prompt assembly (`levelbuilder/api/routes.py:90-99`), even though session
creation separately persists it (`levelbuilder/api/routes.py:985-1000`). This is
a clear instruction/input mismatch and there are two duplicated assemblers that
can drift.

Recommendation: make purpose wording aspect-neutral (“full-bleed mobile-game
background”) or pass the actual aspect into one shared assembler. Prefer the
small wording fix; composition specifics already live in the view prompt. Add a
canonical recipe snapshot test so the library-backed server path and direct
helper cannot diverge unnoticed.

### 8. Avoid encoding the same full 2688px painted result twice

**Expected saving:** **one full PNG encode and one image-sized temporary write
per level** (likely seconds, hardware-dependent) with no provider-cost change.

Magenta finalization atomically saves the same in-memory `result` first as
`inpainted.png` and then as `color.png`
(`levelbuilder/api/inpaint.py:5207-5213`). `_atomic_save_image` performs a fresh
PIL encode for every destination (`levelbuilder/api/inpaint.py:533-555`).

Recommendation: encode once to an atomic canonical file, then create the second
artifact from those exact bytes (atomic copy or hard link where supported). Keep
both filenames because consumers may depend on them. The nearby overlay, bw,
eval, and JSON outputs are distinct artifacts and are not redundant.

## Metering gaps and provider-call inventory

1. **Smart placement: unmetered.** Four default calls for 16 birds, as described
   in finding 2.
2. **fal ESRGAN: unmetered.** The canonical route calls
   `merceka_core.image.upscale_image` (`levelbuilder/api/routes.py:1557-1576`).
   That function posts to fal and downloads the output without a ledger record
   (`/Users/base/dev/appletolye/merceka-core/merceka_core/image.py:667-699`). Add
   a row even when fal supplies no USD field; the ledger contract supports
   unknown-cost calls (`/Users/base/dev/appletolye/merceka-core/merceka_core/costs.py:55-81`).
3. **OpenAI-direct images: unmetered, but not canonical.** The editor exposes
   direct OpenAI image models (`levelbuilder/api/routes.py:567-573`), while the
   shared image client has direct calls at
   `/Users/base/dev/appletolye/merceka-core/merceka_core/image.py:202`, `:266`,
   and `:380` with no adjacent cost record. This should be fixed globally, but
   it does not reduce canonical-lane spend today.
4. **OpenRouter image generation/editing is metered.** The shared image edit
   path requests usage and records provider cost
   (`/Users/base/dev/appletolye/merceka-core/merceka_core/image.py:820-854`), so
   background, paint, and flat-key calls routed there are covered.
5. **VLM detection is metered.** Both provider branches record usage, as noted
   in finding 3.
6. **OpenRouter sprite judge is unmetered, but not used by the canonical batch
   success path.** Its implementation uses the same unmetered LLM client
   (`levelbuilder/api/sprite_judge.py:217-250`). If enabled for calibration,
   those calls need ledger coverage too.

## Steps reviewed but not recommended for removal

- **ESRGAN remains necessary on current evidence.** The locked comparison says
  soft 1K/Lanczos input caused invented junk and ESRGAN avoided it
  (`PIPELINE.md:24-26`, `60-62`). The current implementation already hashes the
  source and reuses a matching upscale (`levelbuilder/api/routes.py:1235-1258`
  and `1478-1500`), so the safe optimization is metering, not skipping or
  recomputing the upscale.
- **The 2048 square send, 2688 canvas, radius, chrome crop, and export gates are
  left unchanged.** Their evidence and invariants are explicit in
  `PIPELINE.md:22-43`.
- **No broad PNG-round-trip rewrite is justified.** The materialization path
  already opens `color.png` once, crops in memory, performs paid batching before
  a thread pool, and retains the image until completion
  (`levelbuilder/api/session.py:2791-2839`). The clear duplicate is the
  `inpainted.png`/`color.png` double encode in finding 8.

## Suggested validation order

1. Prompt snapshot + one canonical magenta A/B for findings 1 and 7.
2. Add LLM/fal/OpenAI-direct metering; establish the real placement and retry
   baseline before claiming dollar savings.
3. A/B a one-call smart shortlist against 64/four-call placement, measuring
   accepted locations and HITL edit minutes.
4. Parallelize flat-key chunks, then separately test partial-grid wording and
   deterministic panel validation against native2k. Report cost, wall time,
   fallback count, and HITL rejects per level.
5. Set a documented VLM audit cadence with anomaly triggers.
