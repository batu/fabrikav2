# Local segmentation and matting candidates for painted bird cutouts

**Research date:** 2026-08-03

**Scope:** current, locally runnable methods for an RTX 4090; primary sources only. No model was installed or run in this research pass, so every quality judgment below is a hypothesis for the benchmark, not a result.

## Task-specific conclusion

The aligned clean background is a cue none of the surveyed learned models accepts directly. It should not be thrown away: use native-resolution registered difference plus the hitbox as a **coarse target prior**, not as the final alpha. The most defensible production-capable shootout is:

1. **BiRefNet_HR-matting** as the direct, prompt-free alpha baseline.
2. **SAMRefiner with HQ-SAM, then ViTMatte**: coarse diff mask in, learned topology refinement, trimap, alpha matte out.
3. **HQ-SAM 2 box/point mask, then ViTMatte**: tests whether the HQ decoder alone fixes SAM2-primary topology and edge errors.
4. **SAM 3 text + geometry, then ViTMatte**: tests whether `bird` concept discrimination fixes wrong-subject grabs, while the box/hitbox selects the instance.
5. **SAM2Matting-T and ZIM as research-only reference ceilings**, because their published licenses are non-commercial.

MatAnyone is a poor one-frame candidate: both current generations are human **video** matting models whose main input contract is a video plus a first-frame mask. Matte Anything is a viable older all-in-one control, but it is a heavier combination of SAM, GroundingDINO, and ViTMatte rather than a distinct edge model.

For every lane, keep the bird's dark painted outline and held/worn items in the foreground prior, constrain component selection to the ID-joined hitbox, record any model-internal resize, and downsample only the final alpha/RGBA.

## Candidate matrix

| Candidate | Inference input/output | Official compute/install facts | License signal | Fit for this task |
|---|---|---|---|---|
| [BiRefNet_HR-matting](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting) | One RGB image -> soft foreground prediction; no prompt or aligned-pair input | Trained and demonstrated at 2048x2048. Current repo requires PyTorch >=2.5 and NumPy <2. The repo reports standard 1024 BiRefNet FP16 at 57.7 ms / 3.5 GB on RTX 4090, but publishes **no HR-matting VRAM figure**. | [MIT](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE) | Best direct-alpha baseline when the crop makes the bird the dominant subject. Main risk: branch/shadow/context may also look salient; use hitbox/diff for component gating. |
| [ViTMatte](https://github.com/hustvl/ViTMatte) | RGB image + 3-state trimap -> alpha matte | Official repo pins torch 2.0.0 and uses Detectron2; the official HF base checkpoint is [387 MB](https://huggingface.co/hustvl/vitmatte-base-composition-1k/tree/main). HF's config records a 512 image-size backbone and pads inputs to a multiple of 32. No official VRAM minimum is published. | Repo [MIT](https://github.com/hustvl/ViTMatte/blob/main/LICENSE); HF checkpoint card says [Apache-2.0](https://huggingface.co/hustvl/vitmatte-base-composition-1k) | Strong edge/alpha second stage. Build the trimap from an HQ/refined mask plus registered diff. It cannot repair a trimap that confidently labels missing feet, tail, or held items as background. |
| [HQ-SAM](https://github.com/SysCV/sam-hq) | RGB image + points and/or xyxy box -> binary mask | Python >=3.8, PyTorch >=1.7. The paper reports inference memory of 5.1/7.6/10.3 GB for B/L/H; Light HQ-SAM is 3.7 GB, 40.3 MB, and 41.2 FPS. | [Apache-2.0](https://github.com/SysCV/sam-hq/blob/main/LICENSE) | Direct use of box + hitbox, with a decoder trained on 44K fine masks. It improves binary boundaries, but still needs ViTMatte for anti-aliased alpha. |
| [HQ-SAM 2 beta](https://github.com/SysCV/sam-hq/tree/main/sam-hq2) | RGB image + click/box -> binary mask | Python >=3.10, PyTorch >=2.3.1, custom CUDA extension; BF16 example. Official large checkpoint is 224.7M parameters. The README says its speed is on par with SAM2.1 but gives no VRAM number. | [Apache-2.0](https://github.com/SysCV/sam-hq/blob/main/sam-hq2/LICENSE) | Especially cheap to compare with the rejected SAM2.1-large route because only the HQ checkpoint/decoder class changes. Still segmentation, not matting. |
| [SAMRefiner](https://github.com/linyq2117/SAMRefiner) | RGB image + coarse binary mask -> refined binary mask; supports SAM or HQ-SAM | Python >=3.8, PyTorch >=1.7; default example uses SAM-H. No separate VRAM number is published, so budget the selected SAM/HQ-SAM backbone. | [MIT](https://github.com/linyq2117/SAMRefiner/blob/main/LICENSE), plus the selected SAM dependency | Most task-shaped bridge from the aligned pair: turn diff into a coarse prompt, then mine distance points, elastic boxes, and Gaussian mask prompts. Use HQ-SAM output to generate a ViTMatte trimap. |
| [SAM 3 / 3.1](https://github.com/facebookresearch/sam3) | RGB image + text noun phrase, points, boxes, masks, or positive/negative visual exemplars -> masks, boxes, scores | 848M parameters; Python >=3.12, PyTorch >=2.7, CUDA >=12.6. Checkpoint access is gated on Hugging Face. Official docs publish no inference VRAM minimum. | Custom [SAM License](https://github.com/facebookresearch/sam3/blob/main/LICENSE), not MIT/Apache; it has no stated non-commercial-only clause but needs product review | Use simple text `bird` plus geometry, not a long instruction. It may reject distractors better than SAM2, but concept masks may omit a separately understood hat/book/binoculars, so diff/geometry must protect those pixels. It is a semantic/topology stage, not an alpha stage. |
| [Matte Anything](https://github.com/hustvl/Matte-Anything) | Image + click; also supports text through GroundingDINO -> RGBA/alpha | Installs SAM, Detectron2/ViTMatte, and GroundingDINO; official quick start uses SAM ViT-H + ViTMatte-B + GroundingDINO-T. No aggregate VRAM figure is published. | [MIT](https://github.com/hustvl/Matte-Anything/blob/main/LICENSE), subject to dependency/checkpoint terms | Useful control for the exact `SAM -> pseudo-trimap -> ViTMatte` architecture, but heavier and less controllable than wiring the known hitbox/diff directly. |
| [SAM2Matting](https://github.com/FudanCVL/SAM2Matting) | Image/video + mask, point, box, or text (SAM3 variant) -> alpha matte | Python 3.10; requirements pin torch 2.8, torchvision 0.23, and torch-tensorrt 2.8. SAM2.1-T, SAM2.1-B+, and SAM3 checkpoints are released. No VRAM number is documented. | [CC BY-NC-SA 4.0, non-commercial research only](https://github.com/FudanCVL/SAM2Matting#license) | Technically the closest direct method: official claims include animals, anime, translucent objects, and fine-detail progressive matting. Benchmark as a reference, not a shippable winner without a commercial license. Start with T, not SAM3. |
| [ZIM](https://github.com/naver-ai/ZIM) | RGB image + positive/negative points and/or xyxy box -> fine matte masks | Pip package and ViT-B/L checkpoints; optional ONNX Runtime GPU. No official VRAM minimum. | [CC BY-NC 4.0](https://github.com/naver-ai/ZIM#license) | Excellent direct promptable-alpha reference using the known box/hitbox. Non-commercial terms block it as the production method absent separate permission. |
| [SEMat](https://github.com/XiaRho/SEMat) | Interactive SAM/HQ-SAM/SAM2 matting checkpoints -> alpha | Python 3.8.8, Detectron2; official repo ships dataset-oriented inference commands and a Gradio demo, but no VRAM figure. | [CC BY-NC 4.0](https://github.com/XiaRho/SEMat/blob/master/LICENSE) | Relevant natural-scene alpha reference, but integration is heavier and non-commercial. Lower same-day priority than SAM2Matting-T or ZIM. |
| [MatAnyone](https://github.com/pq-yang/MatAnyone) / [MatAnyone 2](https://github.com/pq-yang/MatAnyone2) | Video or frame folder + first-frame segmentation mask -> foreground/alpha video | v1 Python >=3.8; v2 Python 3.10 with pip, uv, CLI, and HF APIs. Both permit unlimited native resolution unless `--max-size` is set; neither repo publishes VRAM. | [NTU S-Lab non-commercial license](https://github.com/pq-yang/MatAnyone/blob/main/LICENSE) | Deprioritize. The official task is human video matting and temporal memory cannot help a single crop. The GUI accepts an image, but this does not make it a cartoon still-image specialist. |

## Important primary-source details

### BiRefNet variants

The [official repository](https://github.com/ZhengPeng7/BiRefNet) distinguishes segmentation and matting weights. For this task, compare at least:

- [`BiRefNet_HR-matting`](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting): trained at 2048x2048 for transparency; approximately 444 MB checkpoint.
- [`BiRefNet_HR`](https://huggingface.co/ZhengPeng7/BiRefNet_HR): high-resolution dichotomous segmentation; useful to see whether a harder interior mask preserves the sticker outline better.
- Optionally [`BiRefNet_dynamic`](https://huggingface.co/ZhengPeng7/BiRefNet_dynamic), trained across 256-2304 resolutions, if fixed 2048 resizing visibly changes narrow feet or outlines.

The standard interface is image-only. The aligned clean crop, box, and hitbox must therefore be used outside the model for ROI selection, rejecting satellite components, and checking that the predicted subject overlaps the changed pixels.

### ViTMatte is a refiner, not a target finder

The [official implementation](https://github.com/hustvl/ViTMatte#demo) and [Transformers documentation](https://huggingface.co/docs/transformers/model_doc/vitmatte) require both image and trimap. The trimap is concatenated as a fourth channel. A useful benchmark matrix is therefore:

- diff-derived trimap -> ViTMatte;
- HQ-SAM 2 mask-derived trimap -> ViTMatte;
- SAMRefiner(HQ-SAM) mask-derived trimap -> ViTMatte;
- SAM 3 target mask-derived trimap -> ViTMatte.

Use a narrow range of erosion/dilation widths expressed relative to crop size. Preserve a protected interior formed from strong registered-change pixels, so the matte model cannot erase small held items or the dark outline merely because the segmentation model missed them.

### SAM 3 concept prompts do not replace geometry

The [official paper](https://arxiv.org/html/2511.16719v2#S3.SS3) defines concept prompts as short noun phrases and positive/negative visual exemplars. The [official README](https://github.com/facebookresearch/sam3#basic-usage) shows text returning masks, boxes, and scores, while the image notebook also supports visual boxes. For this corpus:

- set the image to the painted crop;
- use the short concept `bird`;
- use the hitbox-centered positive point or box to select the intended instance;
- if a crop has a second bird-like decoration, add a negative exemplar/box;
- union back strongly changed pixels connected to the selected bird before generating the trimap.

This avoids asking the text model to understand the product-specific rule that a book, hat, or binoculars is part of the cutout even if it is semantically a different object.

### HQ-SAM and SAMRefiner target the known failure differently

HQ-SAM adds a high-quality output token and fuses early/final ViT features; its [official paper](https://papers.neurips.cc/paper_files/paper/2023/file/5f828e38160f31935cfe9f67503ad17c-Paper-Conference.pdf) is explicitly about fine boundaries and intricate structures. SAMRefiner instead consumes an existing coarse mask and derives noise-tolerant points, boxes, and mask prompts from it. The aligned clean/painted pair makes the latter unusually well matched to this task: the diff can be an imperfect prompt without being trusted as the delivered edge.

## Sweep of the official SAM survey catalog

The named [Awesome-Segment-Anything](https://github.com/liliu-avril/Awesome-Segment-Anything) repository is the continuously updated catalog attached to the authors' [SAM survey](https://arxiv.org/abs/2305.08196). It is discovery evidence, not proof on painted cutouts. The relevant entries were followed to their official sources above.

- 2023 list: [HQ-SAM, Matting Anything, and Matte Anything](https://github.com/liliu-avril/Awesome-Segment-Anything/blob/main/Paper_List/paper_list_2023.md). Matting Anything has no more compelling maintained runnable path than the candidates above; Matte Anything is the practical integration.
- 2024 list: [ZIM and SEMat](https://github.com/liliu-avril/Awesome-Segment-Anything/blob/main/Paper_List/paper_list_2024.md). Both are direct matting references, both non-commercial.
- 2025/current: [SAMRefiner](https://github.com/linyq2117/SAMRefiner) is the standout coarse-mask refinement route for exploiting the registered pair.
- 2026/current: [SAM2Matting](https://github.com/FudanCVL/SAM2Matting) is the most directly relevant released generalized matting model. [SAMA, “Segment and Matte Anything in a Unified Model”](https://arxiv.org/abs/2601.12147), has a paper but no linked official runnable code in the survey, so it is not a same-day candidate.
- Illustration-specific: the list includes [SegAnimeChara](https://dl.acm.org/doi/10.1145/3588028.3603685), but it is anime-character semantic segmentation, not alpha matting, and the survey links no code. The current SAM2Matting repo is the only surveyed runnable method found with an explicit `anime` open-world claim. BiRefNet's repo also links the third-party anime fine-tune [ToonOut](https://github.com/MatteoKartoon/BiRefNet), but that is not an upstream checkpoint and should not displace the official HR-matting baseline without separate license/provenance review.

## Recommended benchmark order on the 4090

1. **BiRefNet_HR-matting** at its documented 2048 transform. Lowest integration cost; direct alpha.
2. **HQ-SAM 2 large -> ViTMatte-S/B** using box + hitbox. Reuses the known SAM2 setup while changing the boundary decoder.
3. **SAMRefiner(HQ-SAM) -> ViTMatte** using the registered diff as the initial coarse mask. This is the highest-value paired-input experiment.
4. **SAM 3 -> ViTMatte** using `bird` plus geometry. Run only after checkpoint access and confirm the 848M model fits the 24 GB card; official sources provide no VRAM guarantee.
5. **SAM2Matting-T and ZIM** as non-commercial quality references. If they win visually, the result specifies what a licensable specialized model/fine-tune must match; it does not authorize shipping their weights.
6. Run **Matte Anything** only if a ready-made control is useful. Skip MatAnyone unless a future task needs temporal flyout/video matting.

Record peak VRAM and wall time in the actual run; the absence of an official figure is not evidence that a model fits. All methods are local after checkpoint download and therefore have no per-sprite API fee, but model licenses still determine whether a winner can ship.
