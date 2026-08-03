# Ticket #27: style-specific bird matte pilot

Research date: 2026-08-03

## Result

**Do not advance this fine-tuned ViTMatte lane.** A decoder-only fine-tune on
240 exact-alpha synthetic pairs passed the fixed Codex pre-filter on **1 of 20**
locked real cases. Ticket #17's SAM2-native production control passed **8 of
20**. The newly required registered-difference -> SAMRefiner(HQ-SAM) -> stock
ViTMatte control also passed only **1 of 20**.

The synthetic validation loss was low, but it did not predict product fitness.
On real scenes, the candidate still inherited missing or contaminated topology
from the registered-difference trimap. It produced eight multi-component cases,
4,502 satellite pixels, one empty cutout, missing anatomy, washed-out bird
interiors, and retained scene fragments. ViTMatte remains an edge refiner, not
a reliable target finder.

This is Codex's non-authoritative research conclusion. Batu's Portal verdict is
the only acceptance authority, so ticket #27 remains open pending that verdict.

## Locked experiment

The fixed [20-case benchmark](../2026-08-03-cutout-benchmark/README.md) was
locked before this ticket and joined source dogs to hitboxes by stable `id`.
None of its 20 bird IDs was used for synthetic selection, training, validation,
checkpoint selection, or parameter tuning. The holdout was first run after the
epoch-19 checkpoint had been selected by synthetic validation unknown-region
MAD. No holdout-driven retry or hyperparameter change followed.

Source sessions remained read-only at the handoff's external levelbuilder root.
All generated images, training pairs, checkpoints, raw mattes, judge panels,
and sheets stayed under `.work/cutout-ticket-27/` in this worktree or the
ticket's isolated GPU work directory.

## Synthetic exact-alpha corpus

The pilot reused ticket #16's flat-first contract: generate a bird against a
flat key, recover its alpha locally, and deterministically composite those same
pixels over a clean style-matched scene crop. The recovered alpha is therefore
the exact training target rather than a second model's estimate.

- 32 `gpt-image-2` low-quality 1024x1024 calls cost an estimated **$0.283248**.
- A manual sheet review excluded two generated birds before composition: one
  retained a perch branch and one retained detached ground debris.
- The remaining 30 birds produced eight deterministic augmentations each:
  **184 train pairs** from 12 scene levels and **56 validation pairs** from four
  disjoint scene levels.
- No scene level, prompt family, stable bird ID, or generated variant crossed
  the train/validation boundary.
- Synthetic trimaps included random unknown-only distractors to teach that a
  registered-change prior can contain scenery.

The flat-key call is a bounded training-data expense, not an inference expense.
Once trained, all tested local lanes have zero marginal API cost per sprite;
checkpoint download and electricity are excluded.

## Candidate model and training

The commercially usable small base was
`hustvl/vitmatte-small-distinctions-646` at immutable Hugging Face revision
`6a0e75d7214b01f4d1163ede0f15b23afbbd480b`. Upstream ViTMatte code was pinned
at commit `8cd7ef068380977c3962c4cb733cb1fe7f2241a5` (MIT); the checkpoint card is
Apache-2.0, subject to normal product/legal review.

Only the decoder was trained: 2,068,961 of 25,814,753 parameters. Twenty epochs
at batch size 2 and learning rate `2e-5` took 85.168 seconds on an RTX 4090 and
peaked at 1,151,378,944 allocated CUDA bytes. Epoch 19 won the synthetic
validation gate:

| Synthetic metric | Best value |
|---|---:|
| Mean absolute difference | 0.002967 |
| Unknown-region MAD | 0.009089 |
| SAD | 68.063 |

The selected `model.safetensors` SHA-256 is
`f75d28397c1e1adf476c0c444ed1344ecee8ee940c11e954a4924990f2fba4e8`.
The 20-case candidate inference took 1.265 seconds including warm-up, with a
0.0331-second mean model loop (0.0164 seconds after the first case) and
1,912,936,448 peak allocated CUDA bytes.

## Required controls

The all-20 Portal sheets compare the rejected historical sprite, ticket #17's
best production lane, the same stock ViTMatte architecture, the newly required
SAMRefiner hybrid, and the fine-tuned candidate.

| Method | Prefilter pass | Reject | Error | Multi-component cases | Satellite pixels |
|---|---:|---:|---:|---:|---:|
| SAM2 native (#17 best production lane) | 8 | 12 | 0 | 0 | 0 |
| SAM2 -> stock ViTMatte (#17) | 4 | 16 | 0 | 4 | 169 |
| Registered difference -> SAMRefiner(HQ-SAM) -> stock ViTMatte | 1 | 19 | 0 | 4 | 35 |
| **Registered difference -> fine-tuned ViTMatte** | **1** | **17** | **2** | **8** | **4,502** |

The two candidate errors were Codex CLI timeouts; every completed candidate
judgment except the native-4K Yucatán anchor rejected the sprite. Treating both
errors as unknown rather than failures does not change the comparison.

The SAMRefiner control used official SAMRefiner commit
`4bb7f95738c7a2e805f189210fb09e02a2197557` (MIT) and its vendored HQ-SAM tree
`a097774e71ab472b52d74dc5001442ad8f6a6355` (Apache-2.0). Because the GPU host
does not have the CUDA toolkit needed to compile FastGeodis, the runner replaced
SAMRefiner's generalized distance call with SciPy CPU Euclidean distance.
SAMRefiner fixes `lambda=0`, making this mathematically the same distance field,
not an approximate substitute. The full 20-case hybrid took 8.265 seconds and
peaked at 6,213,660,160 allocated CUDA bytes.

## What the all-20 sheets show

- Fine-tuning sometimes removes more background than stock ViTMatte, but not
  reliably enough to offset topology failures.
- The candidate returns an empty sprite on the small line-art case and only
  fragments on several small 768x1376 birds.
- Market, tent, fence, water, timber, and shoreline pixels remain attached in
  common boundary cases.
- Some birds lose body fill or anatomy even when their external silhouette is
  recognizable.
- The native-4K Yucatán magnifier bird is the candidate's only prefilter pass;
  broad success is not hidden by one source format.
- SAMRefiner improves some mask boundaries but usually preserves the wrong
  connected scene region, so it does not solve target topology either.

The five generated sheets are in `.work/cutout-ticket-27/review/`. Each row
shows clean, painted, rejected, SAM2 native, SAM2 -> stock ViTMatte,
SAMRefiner(HQ-SAM) -> stock ViTMatte, and fine-tuned ViTMatte.

## Reproduce

Build the deterministic manifest and synthetic pairs locally after loading the
existing image API key into the environment:

```sh
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-style-specific-bird-matte/pilot.py all \
  --work .work/cutout-ticket-27 --workers 3
```

Train and run the selected checkpoint on a CUDA host:

```sh
python remote_vitmatte.py train \
  --work work --output checkpoint --epochs 20 \
  --batch-size 2 --learning-rate 2e-5

python remote_vitmatte.py infer \
  --work work --checkpoint checkpoint/best --output outputs
```

Run the required production-compatible hybrid on the same prepared holdout:

```sh
python remote_samrefiner.py \
  --work work --output outputs \
  --samrefiner-repo external/SAMRefiner \
  --samhq-repo external/SAMRefiner/sam-hq \
  --hq-checkpoint checkpoints/sam_hq_vit_h.pth
```

Local validation and fixed benchmark tooling:

```sh
uv run --project tools/level-editor ruff check \
  docs/evidence/2026-08-03-style-specific-bird-matte/*.py

uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-cutout-local-matting/run_benchmark.py measure \
  --work .work/cutout-ticket-27/baseline17 \
  --method sam2-native --method sam2-vitmatte \
  --method samrefiner-hqsam-vitmatte --method finetuned-vitmatte \
  --out .work/cutout-ticket-27/alpha-diagnostics.json
```

The committed [`run-summary.json`](run-summary.json) records the immutable
model revisions, checkpoint digest, split sizes, cost, speed, VRAM,
deterministic diagnostics, and prefilter summaries.

## Scope boundary

This ticket trained one bounded pilot and evaluated exactly the locked 20-case
cohort. It did not process the full corpus, modify any source asset, replace a
runtime sprite, claim human acceptance, or execute ticket #19's final method
shootout. No newly specifiable fog emerged: the measured result answers the
ticket's question directly, pending Batu's verdict.
