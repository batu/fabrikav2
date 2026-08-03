# SAM3 cutout deep dive

**Research snapshot:** 2026-08-03

**Scope:** primary-source research and decision-ready method specifications for [SAM3 pipeline deep-dive](https://github.com/batu/fabrikav2/issues/26)
**Benchmark status:** both upstream zero-shot variants were run over all 20 fixed cases; neither meets the visual cutout bar. Codex results are pre-filter diagnostics, not human acceptance.

## Bottom line

1. **SAM 3.1 exists.** Meta released it on 2026-03-27, and the current upstream `main` includes it. However, SAM 3.1 is an **Object Multiplex video release**, not a new still-image predictor. There is no `sam3.1` image checkpoint or `build_sam3_image_model(version="sam3.1")` path.
2. The current code to pin is upstream `main` commit [`96914d2425f90a64f45ca977c2b5165418099543`](https://github.com/facebookresearch/sam3/commit/96914d2425f90a64f45ca977c2b5165418099543), not the `sam3.1` branch. The release branch has diverged and lacks subsequent `main` fixes. Upstream exposes no GitHub tags or GitHub Release objects as of this snapshot; checkpoints are distributed through gated Hugging Face repositories ([tags API](https://api.github.com/repos/facebookresearch/sam3/tags), [releases API](https://api.github.com/repos/facebookresearch/sam3/releases)).
3. Two honest zero-shot variants were run live:
   - **SAM3 base image PCS:** `facebook/sam3/sam3.pt` through `build_sam3_image_model()` and `Sam3Processor`.
   - **SAM3.1 single-frame Object Multiplex:** `facebook/sam3.1/sam3.1_multiplex.pt` through the video predictor, loading each PNG as a one-frame video.
4. **The two hard masks are almost the same** (mean cross-method IoU `0.991979`). SAM3.1 is not an image-quality successor here: it emits a hard binary edge and shows the same missing-item topology. Base SAM3 exposes a probability edge, but it also leaves visible ghost/fringe residue.
5. Neither is a native-resolution matting model. Both resize the network input to **1008×1008** and produce segmentation masks; only the result is mapped back to the source size.
6. The live result makes the next training order sharp: **Variant 4, hitbox-driven interactive decoder adaptation**, must recover complete topology first; feed that mask into **Variant 5, ViTMatte-S**, for the production alpha. Variant 6 remains the cheaper distillation target after quality is proven.

## Live benchmark execution

### Exact live recipe

The run used the fixed 20-case manifest from [Benchmark set + judging harness for cutout candidates](https://github.com/batu/fabrikav2/issues/15). All 20 live authoring sessions were revalidated, and every dog and hitbox was joined independently by stable `id`. Inputs were copied to the ticket work directory; the read-only source sessions were not modified.

- Code: upstream `main@96914d2425f90a64f45ca977c2b5165418099543`.
- Weights: the pinned base and 3.1 revisions listed in the checkpoint audit below.
- Inputs: original painted crops plus the aligned clean crop at the recorded source box. The official processors then resize internally to 1008×1008.
- Prompts: exactly `the bird` and `the bird and what it holds`, as requested by the ticket.
- Enumeration threshold: `0.05`, deliberately low so a prompt miss remains observable rather than being hidden by the public default.
- Selection: choose the predicted instance that best overlaps both the stable-ID hitbox core and registered clean-to-painted change within the hitbox neighborhood. Prompt outputs are never unioned.
- RGBA: inverse-composite the selected painted pixels against the known clean crop. Base SAM3 uses its probability mask remapped through a `0.35..0.65` alpha ramp; SAM3.1 uses the only public output it exposes, `out_binary_masks`.
- SAM3.1 compatibility: current upstream `main` passes unsupported `offload_state_to_cpu` into the multiplex `init_state`. The runner filters session arguments against the actual signature, then uses the same official `add_prompt` and `close_session` paths. Passing an explicit checkpoint also causes the builder to load the full multiplex checkpoint into the tracker submodel before loading the assembled model, so the live path lets the builder resolve its cached checkpoint itself.

This live baseline intentionally tests the ticket's two concept prompts. The six-prompt and text-plus-hitbox matrix later in this report is the next zero-shot expansion if the map elects to spend another ticket on prompt engineering; it is not represented as part of these scores.

### Measured results on the RTX 4090

| Method | Non-empty outputs | Model load | 20-case inference | Peak CUDA allocation | Prompt behavior | Codex pre-filter | Visual result |
|---|---:|---:|---:|---:|---|---:|---|
| SAM3 base image | 20/20 | 6.7125 s | 4.0242 s | 5.043 GiB | `the bird` chosen 20/20; held-item phrase returned zero masks in 13/20 cases | 19/20 | **Reject** — missing topology plus soft fringe/ghost residue |
| SAM3.1 one-frame multiplex | 20/20 | 10.4308 s | 6.1607 s | 5.651 GiB | `the bird` chosen 20/20; held-item phrase returned zero masks in 20/20 cases | 16/20 | **Reject** — same topology with binary/stair-step edge and specks |

The base prompt emitted 341 masks across the 20 crops, while SAM3.1 emitted 23. The held-item phrase emitted seven base masks total and no SAM3.1 masks. In other words, the relation-like phrase did not rescue accessories; the deterministic hitbox/change selector always chose `the bird`.

The aggregate alpha inspection matches the sheets:

- base SAM3 has `10.0583%` partially transparent pixels among nonzero alpha pixels; some of that is useful antialiasing, but the large held-object misses retain pale ghost fragments;
- SAM3.1 has `0%` partial alpha because the public API returns a binary mask;
- base and 3.1 hard masks have mean IoU `0.991979`, with minimum `0.973560`, so 3.1 does not supply a materially different still-image topology;
- base has five multi-component cases and three cases with components of at most eight pixels; 3.1 has four and two respectively. Both violate the zero-satellite requirement on at least some cases.

### Concrete visual failures

- `pirate_shipwreck_island_palm_root_ship_ribs_bird_0e47__cmp_crop__dog_05`: both variants retain the timber perch and cut a large transparent hole through the belly/hammer region. This is the one base rejection caught by Codex; 3.1 rejected it too.
- `square_hawaii_waterfall_flash_4k__dog_11`: base SAM3 leaves a translucent compass-shaped ghost; SAM3.1 drops the compass. The base Codex pre-filter nevertheless passed it, demonstrating the pre-filter/visual mismatch.
- `square_yucatan_cenote_flash_4k__dog_14`: the magnifying glass is omitted rather than treated as part of the bird.
- `square_pirate_cove_flash_4k__dog_06`: the 3.1 candidate has a visible satellite speck behind the tail.
- Several small 768-pixel cases lose or tighten thin feet, broom/accessory pixels, or the held-item boundary. SAM3.1's binary output makes those edges visibly harsher at 2×.

The zero-shot decision is therefore **not clean enough**. These runs answer the research question but do not claim a winning method, Batu approval, or corpus acceptance.

### Reproduction artifacts

- [Ticket-local prepare/inference runner](2026-08-03-sam3-cutout/run_sam3_benchmark.py)
- [Runner regression tests](2026-08-03-sam3-cutout/test_run_sam3_benchmark.py)
- [Sanitized aggregate result](2026-08-03-sam3-cutout/benchmark-summary.json)
- [Portal progress report](https://portal.basegamelab.com/s/find-the-bird-reskin-0728), post `p_eabdfa` (informational; this AFK ticket does not request a verdict)
- Five full-resolution comparison sheets and both candidate trees remain under `.work/ticket-26-sam3/`; they are intentionally uncommitted binary evidence and are attached to the Portal progress report.

Prepare and revalidate the fixed source cohort from this worktree:

```sh
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-sam3-cutout/run_sam3_benchmark.py prepare \
  --manifest /Users/base/dev/appletolye/fabrikav2/.worktrees/cutout-lab-15/docs/evidence/2026-08-03-cutout-benchmark/benchmark-manifest.json \
  --work .work/ticket-26-sam3
```

On the 4090 host, install pinned upstream `main@96914d2`, PyTorch 2.10.0/CUDA 12.8, the base package, plus the currently omitted runtime imports `einops`, `pycocotools`, and `psutil`. Copy `prepared.json`, `inputs/`, and the runner into the isolated host directory, authenticate to the gated Hugging Face repositories without printing or persisting the token, then run:

```sh
.venv/bin/python ticket26/run_sam3_benchmark.py infer \
  --prepared ticket26/prepared.json \
  --input-root ticket26/inputs \
  --output-root ticket26/results \
  --checkpoint-version sam3

.venv/bin/python ticket26/run_sam3_benchmark.py infer \
  --prepared ticket26/prepared.json \
  --input-root ticket26/inputs \
  --output-root ticket26/results \
  --checkpoint-version sam3.1
```

## Upstream release and checkpoint audit

| Item | Verified state on 2026-08-03 | Consequence |
|---|---|---|
| Repository | `facebookresearch/sam3`, default branch `main`, pinned at [`96914d2`](https://github.com/facebookresearch/sam3/commit/96914d2425f90a64f45ca977c2b5165418099543) | Pin the commit; do not install a moving `main` for benchmark evidence. |
| Base SAM3 checkpoint | Gated [`facebook/sam3`](https://huggingface.co/facebook/sam3/tree/3c879f39826c281e95690f02c7821c4de09afae7), revision `3c879f39826c281e95690f02c7821c4de09afae7`; `sam3.pt` is 3,450,062,241 bytes | This is the only upstream still-image checkpoint used by `build_sam3_image_model()`. |
| SAM 3.1 release | Official release date 2026-03-27; Meta calls it Object Multiplex and documents video efficiency/tracking changes ([release notes](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/RELEASE_SAM3p1.md#L1-L22)) | It is real, but it is not “a better 3.1 image model.” |
| SAM 3.1 checkpoint | Gated [`facebook/sam3.1`](https://huggingface.co/facebook/sam3.1/tree/daa63191845a41281374e725f4c9e51c7a824460), revision `daa63191845a41281374e725f4c9e51c7a824460`; the only model weight is `sam3.1_multiplex.pt`, 3,502,755,717 bytes | Evaluate it via the single-frame video API, not the still-image processor. |
| `sam3.1` branch | Branch tip [`20dba30`](https://github.com/facebookresearch/sam3/commit/20dba30a35a497606b06cf241f5b5605ea10e77e); its release was merged to `main` as [`9f22cb9`](https://github.com/facebookresearch/sam3/commit/9f22cb976fb6e38dad5bb34940fad852dd897d0e) and `main` has later fixes ([comparison](https://github.com/facebookresearch/sam3/compare/sam3.1...main)) | Use pinned `main`, not `git checkout sam3.1`. |
| Python package version | `sam3.__version__` remains `0.1.0` ([source](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/__init__.py#L5-L7)) | Do not use the Python version string to decide whether the checkout contains SAM 3.1. |

The absence of a 3.1 still-image checkpoint follows directly from the builder: `build_sam3_image_model()` downloads `version="sam3"`, while `version="sam3.1"` selects `sam3.1_multiplex.pt` only in the multiplex video builders ([builder and download code](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model_builder.py#L573-L673), [unified video selector](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model_builder.py#L1244-L1319)).

## What upstream actually supports

### Model and input contract

SAM3 is an 848M-parameter detector/tracker with a shared vision encoder. Its detector is DETR-like and accepts text, geometry, and image-exemplar conditioning; its tracker inherits SAM2-style interactive segmentation ([upstream model summary](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/README.md#L197-L202), [paper](https://arxiv.org/abs/2511.16719)). The image builder instantiates a 32-layer, width-1024 ViT at 1008-pixel input, a six-layer fusion encoder, six-layer decoder, and a segmentation head ([architecture source](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model_builder.py#L77-L243)).

`Sam3Processor` always resizes every input to `(1008, 1008)`, then bilinearly maps mask probabilities back to the original width and height. It exposes `masks`, `masks_logits` (despite the name, these have already passed through sigmoid), absolute `xyxy` boxes, and scores ([processor source](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/sam3_image_processor.py#L14-L29), [output path](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/sam3_image_processor.py#L183-L223)). Therefore:

- preserve the source crop at native resolution for final RGBA assembly;
- pad non-square crops to square with their aligned clean-background pixels before SAM, rather than stretching the bird;
- call the network at its native **model** resolution of 1008;
- remap the selected mask to the unpadded source crop;
- never describe this as native-resolution segmentation. It is native-size output from a fixed-resolution segmentation model.

### Prompt APIs

Base image PCS:

```python
from PIL import Image
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

model = build_sam3_image_model()
processor = Sam3Processor(model, confidence_threshold=0.5)
state = processor.set_image(Image.open(painted_crop).convert("RGB"))
state = processor.set_text_prompt(state=state, prompt="bird")

masks = state["masks"]                 # bool N x H x W
mask_probabilities = state["masks_logits"]
boxes_xyxy = state["boxes"]
scores = state["scores"]
```

The documented image API also accepts positive and negative boxes. `add_geometric_prompt()` expects normalized `[center_x, center_y, width, height]`, while the official notebook demonstrates converting an absolute `xywh` box first ([processor API](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/sam3_image_processor.py#L114-L153), [official notebook](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/examples/sam3_image_predictor_example.ipynb)). The separate interactive image path supports points, boxes, mask feedback, and multimask output through `model.predict_inst(...)` ([official SAM1-task notebook](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/examples/sam3_for_sam1_task_example.ipynb)).

SAM3.1 single-frame PCS:

```python
from sam3 import build_sam3_predictor

predictor = build_sam3_predictor(
    version="sam3.1",
    compile=False,
    use_fa3=False,
    async_loading_frames=False,
)
started = predictor.handle_request({
    "type": "start_session",
    "resource_path": str(painted_crop),  # PNG is accepted as one frame
})
session_id = started["session_id"]

response = predictor.handle_request({
    "type": "add_prompt",
    "session_id": session_id,
    "frame_index": 0,
    "text": "bird",
    "output_prob_thresh": 0.5,
})
outputs = response["outputs"]
masks = outputs["out_binary_masks"]
scores = outputs["out_probs"]
boxes_xywh_normalized = outputs["out_boxes_xywh"]

predictor.handle_request({"type": "close_session", "session_id": session_id})
```

The loader explicitly accepts a single `.png` as a one-frame video and resizes it to the configured model size ([loader](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/io_utils.py#L27-L125)). The shared request API also accepts normalized `bounding_boxes`, `bounding_box_labels`, points, and text ([request dispatcher](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/sam3_base_predictor.py#L49-L77), [prompt conversion](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/sam3_base_predictor.py#L149-L207)). The public 3.1 response exposes **binary** masks, not a soft alpha or raw mask logit ([output implementation](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/sam3_multiplex_tracking.py#L675-L796)).

### Prompt matrix for bird cutouts

SAM3's concept prompt is defined as a short noun phrase, not a free-form instruction ([paper abstract](https://arxiv.org/abs/2511.16719)). Use this fixed prompt matrix for both live variants:

1. `bird`
2. `the bird`
3. `bird holding an object`
4. `bird wearing an object`
5. `bird with an accessory`
6. `the bird and what it holds` — included because the ticket explicitly requests it, but treat it as a stress probe rather than assuming the model understands the relation.

For each prompt, test text-only and text plus one positive hitbox box. The positive box is the hitbox circle's bounding square, converted into crop coordinates and expanded by 1.25×; clamp it to the crop and normalize it. Select the output whose mask contains the hitbox center and whose box has the greatest overlap with the hitbox disk. If no mask contains the center, mark the prompt as a miss; do not silently take the global top score. Union prompt outputs only when every added component overlaps the selected subject box; otherwise prompt ensembling can reintroduce scenery or another bird.

The source join remains `session.json dogs[].id == hitboxes.json[].id`; dog-array position is never an identity key.

## Installation, hardware, and license

### Reproducible environment

The current README calls for Python 3.12+, PyTorch 2.7+, and CUDA 12.6+, and its concrete install example uses PyTorch 2.10.0 from the CUDA 12.8 index ([installation](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/README.md#L65-L109)). Checkpoint access is manually gated on Hugging Face and requires authentication ([access instructions](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/README.md#L111-L117)). For the 4090:

- install pinned repository commit `96914d2`;
- use PyTorch 2.10.0 + CUDA 12.8 as upstream demonstrates;
- start with BF16 autocast and TF32 enabled;
- set `use_fa3=False` and `compile=False` for the first SAM3.1 shakedown. Flash Attention 3 is optional upstream, and compilation can increase first-run memory and time;
- record `torch.cuda.max_memory_allocated()` around one crop before attempting the full 20-case benchmark.

Meta documents 848M total parameters. The released weight files are about 3.2–3.3 GiB. Meta's SAM3.1 release commit reports approximately 17.7 GB on an H100 for five tracked objects with compilation, but does not publish an RTX 4090 figure ([official release commit](https://github.com/facebookresearch/sam3/commit/20dba30a35a497606b06cf241f5b5605ea10e77e)). Every 4090 VRAM/time number below is therefore labeled as an estimate until measured live.

### License

The controlling upstream file is the custom **SAM License**, not the stale MIT classifier in `pyproject.toml`. It grants a worldwide, royalty-free limited right to use, reproduce, distribute, modify, and make derivatives, but requires redistribution under the same agreement and includes trade-control, no-reverse-engineering, termination, and warranty/liability terms ([SAM License](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/LICENSE)). The Hugging Face cards classify the license as `other`. This research sees no express non-commercial-only clause, but shipping should use the actual SAM License text and legal review rather than calling SAM3 MIT or unrestricted.

ViTMatte's own code is MIT-licensed ([license](https://github.com/hustvl/ViTMatte/blob/main/LICENSE)); a pipeline using both remains subject to the SAM License for its SAM components and weights.

## Six concretely specified variants

All costs below exclude the one-time creation of flat-key source birds. Once checkpoints and training data exist, marginal inference is local electricity and is effectively free compared with a paid image API.

| # | Method | Live now? | Primary target | 4090 fit | Estimated marginal cost |
|---|---|---:|---|---|---:|
| 1 | SAM3 base image concept + hitbox selection | Yes | Zero-shot topology | Measured 5.043 GiB peak | `<$0.001/sprite` |
| 2 | SAM3.1 Object Multiplex on a single image | Yes | Latest upstream release topology | Measured 5.651 GiB peak | `<$0.001/sprite` |
| 3 | SAM3 mask-head-only domain adaptation | Future training | Illustration mask boundary and accessories | Expected to fit | `<$0.001/sprite` |
| 4 | Hitbox-driven interactive decoder adaptation | Future training | Complete target topology | Expected to fit | `<$0.001/sprite` |
| 5 | Frozen SAM3 + ViTMatte-S alpha refinement | Future training | Anti-aliased, fringe-free alpha | Expected to fit | `<$0.001/sprite` |
| 6 | Frozen SAM3 + tiny outline-aware BoundaryNet | Future training | Cheap narrow-band alpha repair | Comfortable | `<$0.001/sprite` |

### Variant 1 — SAM3 base image concept + hitbox selection

**Checkpoint and architecture**

- Code: pinned `main@96914d2`.
- Weights: `facebook/sam3@3c879f3/sam3.pt`.
- API: `build_sam3_image_model()` + `Sam3Processor`.
- Model input: square 1008×1008; output restored to the padded crop's size.

**Expanded follow-up recipe**

The live two-prompt baseline is recorded above. This expanded matrix is specified for a future prompt-engineering ticket; it was not used to inflate the live result.

1. Read the active painted variant and its `.box.json`; join to the hitbox by stable `id`.
2. Pad the painted crop to square with pixels from the aligned clean-background crop. Keep the padding transform.
3. Run all six prompts at confidence thresholds `0.35` and `0.50`.
4. For every prompt, run:
   - text-only;
   - text plus one positive normalized box from the 1.25× hitbox square.
5. Call `processor.reset_all_prompts(state)` between prompt/geometry combinations; otherwise a prior geometric prompt remains in state.
6. Select only masks geometrically tied to the hitbox center. Record the prompt, threshold, model score, hitbox containment, area, and box overlap.
7. Emit two alpha candidates for fair inspection:
   - upstream hard mask (`masks`);
   - upstream probability map (`masks_logits`), clipped outside the selected hard component. Label this “probability alpha,” not ground-truth matting.
8. Undo square padding, multiply the original painted RGB by alpha, and save straight-alpha RGBA.

**Expected behavior**

- Best chance among the two upstream baselines to expose a soft boundary signal.
- Text-plus-box should suppress neighboring illustrations while retaining concept semantics.
- Main risk: a concept mask may treat the held item as a different concept, and interpolated probability is not a true foreground alpha.

**MEASURED — 4090 resources:** 5.043 GiB peak CUDA allocation, 6.7125 seconds model load, and 4.0242 seconds for all 20 two-prompt crops after load. This is approximately 0.20 seconds per crop for two prompts. Local energy remains comfortably below `$0.001/sprite`.

### Variant 2 — SAM3.1 single-frame Object Multiplex

**Checkpoint and architecture**

- Code: pinned `main@96914d2`, which includes SAM 3.1.
- Weights: `facebook/sam3.1@daa6319/sam3.1_multiplex.pt`.
- API: `build_sam3_predictor(version="sam3.1")`.
- Input: pass the painted PNG path directly as a one-frame video.
- Output: `out_binary_masks`, `out_probs`, normalized `out_boxes_xywh`.

**Expanded follow-up recipe**

The live two-prompt baseline is recorded above. This expanded matrix is specified for a future prompt-engineering ticket; it was not used to inflate the live result.

1. Build once with `compile=False`, `use_fa3=False`, `async_loading_frames=False`.
2. Start a new session for each padded crop; direct PNG input avoids JPEG damage.
3. Run the same six-prompt matrix at `output_prob_thresh` values `0.35` and `0.50`.
4. For the text-plus-hitbox branch, add `bounding_boxes=[[x, y, w, h]]`, `bounding_box_labels=[1]`, with normalized `xywh` coordinates, in the same `add_prompt` request.
5. Call `reset_session` before changing text prompts, as the official 3.1 notebook requires; alternatively use one fresh session per prompt.
6. Apply the same hitbox-containment selection. Emit the upstream binary mask without implying it is a soft alpha.
7. Close every session to release per-session tensors. Record close-session GPU telemetry where available.

**Expected behavior**

- This is the only honest way to test the latest upstream 3.1 weights on a still image.
- It may change detector topology or accessory inclusion, but 3.1's advertised advance is multi-object video efficiency, so a still-image quality gain is not promised by Meta.
- The public API returns hard masks; a refinement stage is mandatory if binary edges fail at 1–2× sprite scale.

**MEASURED — 4090 resources:** 5.651 GiB peak CUDA allocation, 10.4308 seconds model load, and 6.1607 seconds for all 20 two-prompt one-frame crops after load. This is approximately 0.31 seconds per crop for two fresh sessions. The earlier 16–22 GB planning estimate was conservative because Meta's 17.7 GB figure covers five-object compiled tracking rather than this one-object, one-frame eager path. Marginal energy remains below `$0.001/sprite`.

### Variant 3 — SAM3 mask-head-only illustration adaptation

**Goal:** preserve SAM3's concept detector while teaching the existing segmentation head the exact dark-outline boundary of flat-key/composited 2D birds.

**Starting point**

- `facebook/sam3/sam3.pt`, `build_sam3_image_model(eval_mode=False, enable_segmentation=True)`.
- Freeze the ViT, text encoder, fusion encoder/decoder, geometry encoder, and scoring heads. Train only `segmentation_head`, including its pixel decoder.
- This is deliberately not a full 848M-parameter fine-tune; full AdamW state plus activations is too risky on 24 GB without measurement.

**Training data**

- Generate at least **1,000 unique flat-key bird RGBA assets**, with at least 40% holding or wearing an item and deliberate coverage of feet, thin tails, open wings, binocular straps, book corners, hats, and glasses.
- Composite each exact RGBA onto 20 randomly sampled clean-background crops from the game at 10 scales/locations: about **10,000 composites**. Add another 10,000 hard cases with low contrast, line art, water, and outline-like background edges.
- Target hard mask: `alpha >= 0.5`; preserve the soft alpha separately for Variants 5–6.
- COCO annotations: `bbox`, RLE `segmentation`, `area`, `iscrowd=0`, category/prompt `bird`. Add background-only negatives and wrong-concept queries because the [SAM3 paper](https://arxiv.org/abs/2511.16719) explicitly grounds its data engine in hard negatives.
- Split 70/15/15 by **source bird identity and background level**, never by derived composite, to prevent near-duplicate leakage.

**Trainer configuration**

Start from Meta's Roboflow image fine-tune config, set `enable_segmentation: true`, `load_segmentation: true`, `with_seg_masks: true`, enable the `Masks` loss with Meta's example weights `loss_mask: 200` and `loss_dice: 10`, and enable checkpoint saving ([official config](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/train/configs/roboflow_v100/roboflow_v100_full_ft_100_images.yaml#L74-L160), [data/model toggles](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/train/configs/roboflow_v100/roboflow_v100_full_ft_100_images.yaml#L222-L320)). Meta's loss is focal mask loss plus Dice ([implementation](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/train/loss/loss_fns.py#L575-L635)).

Proposed run: BF16, batch 1, gradient accumulation 8, AdamW `lr=1e-4`, weight decay 0.1, 30,000 optimizer steps, validation every 2,000, early-stop on held-item boundary F-score. Save the best checkpoint, not merely the last.

**ESTIMATE — 4090 resources:** 10–16 GB peak VRAM, 6–18 hours. Trainable checkpoint delta likely tens to low hundreds of MB. Inference cost and speed remain essentially Variant 1.

**Risk:** if the detector query never includes a held item, changing only the mask head cannot reliably invent that missing topology.

### Variant 4 — hitbox-driven interactive decoder adaptation

**Goal:** exploit the information the game already has—the exact target hitbox—so segmentation does not depend on open-vocabulary concept completeness.

**Starting point**

- Load `facebook/sam3/sam3.pt` with `enable_inst_interactivity=True`.
- Freeze the shared vision backbone and all concept-detector modules.
- Train the interactive SAM-style mask decoder, its mask tokens, and IoU-quality head only.
- Inference uses `model.predict_inst(state, point_coords=..., point_labels=..., box=..., multimask_output=True)` as demonstrated by Meta's official interactive notebook.

**Prompt curriculum**

For every exact-alpha composite, create five prompt views:

1. positive point at the stable hitbox center;
2. positive point sampled from the alpha's eroded opaque core;
3. tight alpha box expanded 10%;
4. hitbox square expanded 25%;
5. point + box plus 1–3 negative points sampled just outside alpha but inside the box.

Ensure at least half the examples contain a held/worn item. Perturb points by ±8% of bird diameter and boxes by ±15% so the adapter does not overfit perfect prompts.

**Loss and schedule**

- Best-of-three multimask selection by target Dice during training.
- Binary focal/BCE + Dice on `alpha >= 0.5`.
- IoU-head regression to actual mask IoU.
- Add a 4× weight in a six-pixel band around the target outline so thin feet and the dark sticker border matter.
- 50,000 prompt examples, BF16, batch 1, accumulation 16, AdamW `lr=2e-4`, 40,000 steps.

The shipped Hydra image fine-tune config does not expose a ready interactive-decoder training recipe, and its historical multi-step interactive loss classes are commented out ([source](https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/train/loss/loss_fns.py#L720-L935)). This variant therefore needs a small explicit trainer; it must not be presented as a config-only upstream feature.

**ESTIMATE — 4090 resources:** 8–14 GB peak VRAM, 6–14 hours, with a small trainable checkpoint. Estimated inference is 0.2–1.0 seconds per crop and `<$0.001/sprite`.

**Expected advantage:** this is the best topology-recovery candidate when text masks drop hats, binoculars, books, tails, or feet. **Risk:** a binary decoder still does not solve semi-transparent edge matting by itself.

### Variant 5 — frozen SAM3 + ViTMatte-S alpha refinement

**Goal:** let SAM3 own topology and a dedicated matting network own the anti-aliased edge.

**Architecture**

- Freeze the better of Variant 1 or 2 and cache its masks for all training composites.
- Use the official MIT-licensed **ViTMatte-S** architecture: 4-channel RGB+trimap input, 512-pixel training crops, ViT-S with width 384, 12 blocks, plus its detail-capture decoder ([official model config](https://github.com/hustvl/ViTMatte/blob/main/configs/common/model.py)).
- Initialize the ViT from the official DINO preprocessing route described by the project ([training guide](https://github.com/hustvl/ViTMatte/blob/main/docs/train.md)).

**Training data and trimaps**

- Reuse the 20,000 composite/alpha pairs from Variant 3 and create 2–4 randomized composites per pair.
- Turn the frozen SAM mask into a trimap: erode by 2–6 pixels for known foreground, dilate by 4–16 pixels for known background, and label the band unknown.
- During training, inject realistic SAM defects: one-pixel stair steps, small holes, 1–12 pixel erosions/dilations, detached specks, and partial accessory omissions no farther than 24 pixels from the current mask. Do not inject whole missing birds—the matte cannot recover arbitrary topology.
- Sample 512×512 patches centered on the unknown band at native crop scale. Keep 25% full-crop views for global consistency.
- Target the exact soft alpha from the flat-key RGBA.

**Loss and schedule**

Use ViTMatte's official unknown-region L1, known-region L1, Laplacian-pyramid, and gradient-penalty losses ([criterion](https://github.com/hustvl/ViTMatte/blob/main/modeling/criterion/matting_criterion.py)). Proposed single-4090 run: BF16, batch 2, accumulation 8, AdamW `lr=5e-4` (matching the official ViTMatte-S config), 50,000 steps, early stopping on held-item gradient/connection errors. At inference, process the boundary at 512-pixel tiles with overlap, preserve known foreground/background outside the unknown band, and stitch with a cosine window.

**ESTIMATE — 4090 resources:** 8–12 GB peak VRAM, 8–20 hours. Inference adds roughly 0.05–0.5 seconds per crop; local marginal cost remains `<$0.001/sprite`.

**Expected advantage:** directly optimizes soft alpha and boundary gradients, which is the defect class that defeated prior SAM2-only extraction. **Risk:** cannot repair a held object missing beyond the trimap band.

### Variant 6 — outline-aware BoundaryNet residual

**Goal:** a smaller, faster style-specific alternative to ViTMatte when topology is already correct.

**Architecture**

- Freeze the winning SAM mask.
- Build a 5-level U-Net with base width 16, depthwise-separable 3×3 blocks, and about 1–3M parameters.
- Eight input channels: painted RGB (3), aligned clean RGB (3), SAM probability/binary mask (1), and signed distance to the SAM boundary (1).
- Predict an alpha residual only in a ±24-pixel boundary band. Force alpha to 1 in the eroded core and 0 outside the dilated support.

**Training recipe**

- Use 50,000 256×256 boundary patches from the same identity-split synthetic composites.
- Oversample dark sticker outlines, feathers against line art, tiny feet, and accessory straps.
- Loss: soft-alpha L1 + 0.5× Laplacian-pyramid + 0.5× Sobel gradient + 0.25× outside-band leakage. The Laplacian and gradient forms can be taken directly from ViTMatte's primary implementation.
- BF16, batch 16, AdamW `lr=3e-4`, 30,000 steps, cosine decay.

**ESTIMATE — 4090 resources:** 2–5 GB peak VRAM, 1–4 hours. Inference adds 10–100 ms per crop and costs much less than $0.001 per sprite.

**Expected advantage:** uses the aligned clean crop to distinguish dark outline from scenery and is cheap enough for thousands of birds. **Hard limit:** a ±24-pixel residual cannot recover a wing, hat, or held object missing farther from the SAM support; that is intentional so it cannot hallucinate scenery.

## Shared synthetic-data contract

Every trained variant should use one immutable corpus manifest with:

- `sourceBirdId`, generator recipe/version, and original flat-key/RGBA paths;
- exact soft alpha, hard alpha threshold, and opaque-core mask;
- clean background id/path and crop box;
- composite transform (scale, rotation, translation, color transform);
- held/worn-item tags and thin-structure tags;
- prompt/hitbox coordinates;
- identity-grouped train/validation/test split;
- SHA-256 for every source and target.

Data acceptance checks before training:

1. `RGB_composite == alpha * bird_rgb + (1-alpha) * clean_rgb` within the recorded color-space tolerance.
2. Alpha includes the dark sticker outline and held/worn object; branch, perch, and cast shadow are excluded.
3. No split contains a transform of a bird identity found in another split.
4. Validation includes tiny `r≈24`, reflective water, dense line art, low contrast, and every held/worn-item family.
5. All future training data comes from the flat-key generation route or another rights-cleared exact-alpha source; rejected historical cutouts are never labels.

## Decision gates after the live zero-shot sheet

Use the fixed 20-bird benchmark and Batu's Portal verdict; model scores are only diagnostics.

1. **Whole subject passes, edges fail:** train Variant 5. It directly targets the remaining failure.
2. **Held/worn items or thin anatomy fail outside a narrow boundary band:** train Variant 4, then feed its masks into Variant 5.
3. **Text-only is required for future scenes and geometry prompts are unavailable:** try Variant 3, but do not expect mask-head-only training to fix detector omissions.
4. **Variant 5 works but is operationally heavier than needed:** distill its alpha into Variant 6 using the same exact-alpha corpus.
5. **Neither upstream zero-shot variant finds the whole subject consistently:** do not spend time tuning morphology. The failure is topology, so graduate a training ticket for Variant 4.

## Estimate ledger and unknowns

All entries in this table are **inferences to be measured**, not upstream benchmark results.

| Variant | Trainable portion | Data volume | Estimated 4090 training | Estimated 4090 inference | Biggest unknown |
|---|---|---:|---:|---:|---|
| 1 | None | 20 benchmark crops | N/A | **Measured:** 5.043 GiB; 4.0242 s/20 | Expanded prompt+box behavior |
| 2 | None | 20 benchmark crops | N/A | **Measured:** 5.651 GiB; 6.1607 s/20 | Expanded prompt+box behavior and upstream session fix |
| 3 | Segmentation head/pixel decoder | 20k composites | 10–16 GB; 6–18 h | Same as V1 | Whether detector queries already contain accessories |
| 4 | Interactive mask decoder + IoU head | 50k prompt examples | 8–14 GB; 6–14 h | 0.2–1 s | Small trainer implementation and optimum prompt mix |
| 5 | ViTMatte-S | 40k–80k composite views | 8–12 GB; 8–20 h | +0.05–0.5 s | Tiling seam control at native crop size |
| 6 | 1–3M BoundaryNet | 50k boundary patches | 2–5 GB; 1–4 h | +0.01–0.1 s | Safe band width versus accessory extent |

No paid inference API is part of any winning recipe. After one-time checkpoint download and any one-time training, every method trends to effectively zero marginal cost per sprite on the local 4090.

## Primary-source index

- Meta SAM3 repository snapshot: <https://github.com/facebookresearch/sam3/tree/96914d2425f90a64f45ca977c2b5165418099543>
- Meta SAM3 paper: <https://arxiv.org/abs/2511.16719>
- Meta SAM3.1 release notes: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/RELEASE_SAM3p1.md>
- Base checkpoint repository: <https://huggingface.co/facebook/sam3/tree/3c879f39826c281e95690f02c7821c4de09afae7>
- SAM3.1 checkpoint repository: <https://huggingface.co/facebook/sam3.1/tree/daa63191845a41281374e725f4c9e51c7a824460>
- Image builder and checkpoint selector: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model_builder.py>
- Image processor API: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/sam3_image_processor.py>
- Shared video request API: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/model/sam3_base_predictor.py>
- Official image prompt notebook: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/examples/sam3_image_predictor_example.ipynb>
- Official interactive image notebook: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/examples/sam3_for_sam1_task_example.ipynb>
- Official SAM3.1 video notebook: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/examples/sam3.1_video_predictor_example.ipynb>
- Meta fine-tuning guide: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/README_TRAIN.md>
- Meta segmentation fine-tune config: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/sam3/train/configs/roboflow_v100/roboflow_v100_full_ft_100_images.yaml>
- SAM License: <https://github.com/facebookresearch/sam3/blob/96914d2425f90a64f45ca977c2b5165418099543/LICENSE>
- ViTMatte official repository: <https://github.com/hustvl/ViTMatte>
- ViTMatte paper: <https://arxiv.org/abs/2305.15272>
- ViTMatte-S architecture/training config: <https://github.com/hustvl/ViTMatte/blob/main/configs/ViTMatte_S_100ep.py>
