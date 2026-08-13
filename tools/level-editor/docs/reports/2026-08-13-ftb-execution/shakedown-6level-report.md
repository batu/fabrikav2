# 6-Level Shakedown Batch — 2026-08-13

Operator request: 6 unused scenes through the whole authoring lane, 3 with 2x2
flatkey cutouts, 3 with 1x1, all on `google/gemini-3.1-flash-image-preview`,
each level tagged with generator/inpaint/cutout provenance, bug-hunt throughout.
Stopped at the HITL boundary — nothing approved, exported, or lined up.

## Levels

| Session | Cutout | State |
|---|---|---|
| japan_festival_grounds_bird_12fb | flatkey 2x2 | 15/15 sprites, canonical, awaiting HITL |
| italy_venice_canal_morning_bird_437e | flatkey 2x2 | 15/15 sprites, canonical, awaiting HITL |
| uk_london_high_street_bird_06d0 | flatkey 2x2 | 15/15 sprites, canonical, awaiting HITL |
| turkey_grand_bazaar_corridor_bird_2dd8 | flatkey 1x1 | 15/15 sprites (4 junk — BUG-10), canonical |
| mexico_dia_de_muertos_plaza_bird_66a9 | flatkey 1x1 | 15/15 sprites, canonical |
| france_alsace_wine_village_bird_1d5c | flatkey 1x1 | QUARANTINED at migration (dog 8 failed — BUG-9) |

Tags (verified on disk in session.json; the GET projection drops them — BUG-2):
`gen:<model>`, `inpaint:magenta:<model>`, `cutout:flatkey-{2x2|1x1}:<model>`.

Hitbox blessing recorded as `human:batu-delegated:shakedown-agent` — real HITL
review is still required per level before any ship action.

## Cost (metered, merceka ledger — never estimated)

- Batch total: **$6.90 across 121 provider calls** (06:30Z–07:2xZ window).
- Split by window (fallback attribution — per-session tags absent, BUG-5):
  2x2 phase ≈ $0.92/level; 1x1 phase ≈ $1.38/level. 1x1 ≈ +50%/level,
  consistent with single-call pricing ($0.034 vs $0.0045/bird).
- Caps honored: worst level ≈ $1.4 < $2; batch $6.90 < $15.

## Bugs found (full detail: shakedown-6level-bugs.jsonl)

1. **BUG-1 (P3)** CLI `create` has no `--tags` although the API accepts tags.
2. **BUG-2 (P2)** Session GET projection drops `tags` (and `view`,
   `aspectRatio`) even though they persist in session.json.
3. **BUG-3 (P1)** `create_session` never initializes `.canonical` — every new
   level is born legacy; residue/derived-crops/scene-previews 409
   (`canonical_required`) until a manual artifact-integrity-migration.
   Canonical-first should mean canonical-from-birth (or auto-migrate at the
   bless boundary).
4. **BUG-5 (P1)** 0/121 ledger rows carry `meta.sessionId` — the P2d
   attribution contextvar is not active in the live lane, so
   `experiment.measured_cost` reads $0 for every level.
5. **BUG-6 (P1)** The all-picked-up pickup preview does not remove all birds;
   residue gate red (117k–272k px vs 500 limit) on every level. Partly the
   composite, mostly BUG-8.
6. **BUG-7 (P2)** `/residue` 500s (`KeyError: 'cleanup'`) on some canonical
   levels instead of a typed error.
7. **BUG-8 (P0, quality)** The magenta paint call mutates the scene OUTSIDE
   bird sites: verified prop swaps (pillow pile → rolled towels + book),
   20 stray diff components >2000px on japan_12fb, extra hallucinated birds
   with no hitbox. Phase alignment is (0,0) so the alignment gate is blind to
   it; no other gate catches it. **Endemic**: control levels sami_589b (4.6%)
   and japan_river_0027 (5.6% of canvas mutated) show the same signature —
   the PIPELINE.md "~4% diff = birds only" premise does not hold.
8. **BUG-9 (P1)** A bird with `status=failed` (france dog 8, no active
   variant) passes the entire author lane silently: sprite-gaps only inspects
   painted dogs, repair keys off sprite-gaps, nothing fails on dog status.
   Caught only by migration quarantine.
9. **BUG-10 (P1, quality)** ~4/15 turkey sprites are props/fragments, not
   birds: small detections (<110px) route to the free extractor which cuts
   the paint-diff verbatim — and under BUG-8 the diff can be a mutated prop.
   No judge gate on that path.

## Proposed follow-ups (not started; ordered by leverage)

1. BUG-8 needs a content-mutation gate (masked SSIM/diff outside bird discs at
   paint acceptance time, reject like the aspect gate) — it's the root of
   BUG-6 and BUG-10.
2. BUG-3: initialize canonical at create (or auto-migrate at bless).
3. BUG-9: author lane fails loudly on `dogs[].status == "failed"`.
4. BUG-5: wire the attribution contextvar into the deployed lane.
5. BUG-2/BUG-7/BUG-1: projection + typed-error + CLI flag cleanups.
