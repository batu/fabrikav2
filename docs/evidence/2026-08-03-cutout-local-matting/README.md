# Ticket #17: local segmentation and matting benchmark

Research date: 2026-08-03

## Result

**No tested off-the-shelf method is suitable for the 20-case Find the Bird
benchmark.** The production-eligible methods all fail the product rule on
common cases: keep the complete bird, dark outline, feet, and held/worn items;
exclude perch, shadow, water, roof, rope, tent, and other scene pixels.

The strongest next move is a style-specific matte model trained from the
flat-key `(painted bird, alpha)` pairs established by ticket #16. That work
should use this fixed cohort as a held-out regression set, stratify the new
synthetic pairs by scene/style before splitting, and retain HQ-SAM2 plus
SAMRefiner as controls. It must not silently promote any result here to the
full corpus.

## Inputs and method

The fixed [20-case benchmark](../2026-08-03-cutout-benchmark/README.md) spans
all 20 active source sessions, hitbox radii 22–256, 15 portrait 768×1376
sources, five native 4096×4096 sources, and the known small-bird, held-item,
water, line-art, and boundary traps. The harness revalidated every dog-to-
hitbox join by stable `id` before inference. Source sessions remained
read-only; all generated data lives under `.work/cutout-lab-17/run/`.

Each prompted method received the same ID-joined hitbox center and a `1.2r`
box. SAM2 masks were selected using model confidence plus overlap with the
registered clean/painted change signal. Matte pixels were decontaminated
against the aligned clean crop before tight cropping. This gives every method
the registered-pair advantage without letting a raw color difference become
the delivered alpha.

## Methods tested on the RTX 4090

| Lane | Production status | 20-case inference | Peak allocated VRAM | What the sheets show |
|---|---|---:|---:|---|
| SAM2.1 Hiera Large native mask | eligible baseline | 3.135 s through the existing HTTP service | service did not expose per-run peak | Frequently selects a coherent scene fragment or attaches scenery; hard edges do not solve topology. |
| SAM2.1 -> ViTMatte-S Distinctions-646 | eligible | 1.059 s after seed generation | 1.49 GiB | Softens the seed boundary, but cannot recover pixels that the trimap called background or remove confident scene pixels. |
| HQ-SAM2 Large -> ViTMatte-S Distinctions-646 | eligible | 3.333 s | 2.43 GiB | Similar topology failures to SAM2; small edge improvements do not fix wrong-subject masks. |
| BiRefNet_HR-matting at 2048 | eligible | 8.886 s | 9.03 GiB | One empty matte; otherwise often a washed fragment or scene saliency rather than the bird. |
| BiRefNet_HR at 2048 | eligible | 8.572 s | 9.03 GiB | Harder alpha, but still retains large scene components or loses the target. |
| SAM2Matting-SAM2.1-T | **reference only** | 0.870 s | 0.79 GiB | Best tested alpha on some correct seeds, especially large 4K birds, but still inherits widespread seed topology errors. |

Times are whole-cohort model-loop wall time after model loading. They are not
end-to-end cold-start latency. GPU: NVIDIA RTX 4090 24,564 MiB, driver 595.84;
PyTorch 2.8.0+cu128. GPU runners were the official SAM2Matting commit
`73dd721d77b56749248aefe5e8824d7f61b9d13c` and official HQ-SAM commit
`e696978d60352dc9a26b12631cd91781502c6546`. The model-inference marginal API
cost is $0 per sprite after checkpoint download; electricity and the separate
Codex pre-filter are excluded.

SAM2Matting is not a shippable winner because its published repository license
is CC BY-NC-SA 4.0. It is included only as a reference ceiling. The other
production lanes use their official MIT/Apache-compatible implementations and
checkpoints, subject to normal product/legal review.

## Quantitative diagnostics

The deterministic alpha diagnostics below describe output shape; they are not
a perceptual quality score. Components use `alpha >= 32`, and partial-alpha
fraction is measured over visible pixels.

| Method | Missing outputs | Multi-component cases | Satellite pixels | Mean partial-alpha fraction |
|---|---:|---:|---:|---:|
| SAM2 native | 0 | 0 | 0 | 0.140 |
| SAM2 -> ViTMatte | 0 | 4 | 169 | 0.616 |
| HQ-SAM2 -> ViTMatte | 0 | 1 | 10 | 0.646 |
| BiRefNet_HR-matting | 1 | 8 | 7,112 | 0.901 |
| BiRefNet_HR | 0 | 7 | 4,845 | 0.648 |
| SAM2Matting-T | 0 | 5 | 92 | 0.554 |

The shared Codex semantic pre-filter uses the benchmark's exact bird-plus-held-
items rule at subject/completeness thresholds of 0.8. It is non-authoritative;
Batu's Portal verdict remains the only acceptance authority.

| Method | Prefilter pass | Reject | Error |
|---|---:|---:|---:|
| SAM2 native | 8 | 12 | 0 |
| SAM2 -> ViTMatte | 4 | 16 | 0 |
| HQ-SAM2 -> ViTMatte | 3 | 17 | 0 |
| SAM2Matting-T reference | 8 | 12 | 0 |

Even the noncommercial reference misses the gate in 12 of 20 cases. The four
SAM2->ViTMatte passes are one 768×1376 case and three native-4K cases; broad
success is not hidden by one source format.

## Visual findings

- Small 768×1376 birds remain the hardest. Candidate lanes variously return a
  mushroom, roof, fence, paving, rope, water, or only a bird fragment.
- ViTMatte is an edge refiner, not a target finder. It improves alpha only when
  its seed already encloses the right bird and product-specific attachments.
- HQ-SAM2 does not materially change the failure class. It frequently selects
  the same local scene topology as SAM2 despite a finer boundary decoder.
- Image-only saliency is a poor target prior on tight stylized crops:
  BiRefNet's output ranges from empty or partial bird to nearly the whole crop.
- SAM2Matting-T is the strongest reference on several large birds but still
  includes rocks, roofs, tents, water, and perches, or omits anatomy. Its
  noncommercial license independently prevents selection.

The five Portal sheets in `.work/cutout-lab-17/run/sheets-final/` show, for
every case, clean crop, painted crop, rejected historical sprite, SAM2,
SAM2->ViTMatte, HQ-SAM2->ViTMatte, BiRefNet-HR-matting, and SAM2Matting-T on the
game's cream background.

## Survey decisions and unavailable candidates

The [primary-source candidate landscape](../2026-08-03-cutout-local-matting-research/candidate-landscape.md)
covers BiRefNet variants, ViTMatte, HQ-SAM/HQ-SAM2, SAMRefiner, SAM3,
SAM2Matting, ZIM, SEMat, Matte Anything, MatAnyone, and the current
Awesome-Segment-Anything catalog.

- **SAM3 was treated as a first-class candidate, not omitted.** The official
  checkpoint is gated on Hugging Face, and the 4090 host had neither approval,
  authentication, nor a cached checkpoint. No unauthorized credential search
  or substitute weight was used. Its concept-plus-geometry route remains a
  future control, not evidence against the present conclusion.
- **MatAnyone was not run** because both official generations are human-video
  matting systems that require a first-frame mask and carry noncommercial
  terms. Temporal memory provides no task-shaped advantage for a single
  cartoon crop.
- **ZIM and SEMat** are relevant promptable-matte references but also
  noncommercial. SAM2Matting-T already supplied the closer generalized
  noncommercial ceiling.
- **SAMRefiner(HQ-SAM)** is the most relevant unrun production-compatible
  hybrid because it can refine a registered-difference prior. Include it as a
  control in the synthetic-pair fine-tune task; it does not erase the measured
  failure of the off-the-shelf lanes run here.

## Reproduce

```sh
uv run --project tools/level-editor pytest -q \
  docs/evidence/2026-08-03-cutout-local-matting/test_run_benchmark.py \
  docs/evidence/2026-08-03-cutout-benchmark/test_benchmark_harness.py

uv run --project tools/level-editor ruff check \
  docs/evidence/2026-08-03-cutout-local-matting/*.py
```

`run_benchmark.py` prepares the stable prompt/registered-pair inputs, imports
GPU alpha mattes, creates decontaminated RGBA sprites, and emits deterministic
alpha diagnostics. `remote_inference.py` records per-case inference time,
whole-run time, peak allocated CUDA memory, model identity, and PyTorch version.
The existing benchmark harness renders the Portal sheets and runs the resumable
non-authoritative Codex pre-filter.

## Scope boundary

This ticket evaluated exactly the fixed 20-case cohort. It did not process the
full corpus, replace any source or runtime sprite, claim a winner, or ask Batu
to accept outputs. A separate style-specific training task is now specifiable;
the eventual method selection remains ticket #19's Portal decision.
