# Generation-time bird extraction research

**Ticket:** [#16](https://github.com/batu/fabrikav2/issues/16)
**Date:** 2026-08-03
**Scope:** Primary-source survey plus four cost-bounded `gpt-image-2` probes. The
survey agent made no provider calls; the ticket driver later ran the experiments
below for an estimated **$0.047806 total**.

## Answer

**Yes: make the paint step yield the bird first, then deterministically composite
that exact keyed/RGBA bird into the untouched clean scene.** This is the only
tested cloud route that makes the scene bird and flyout identical by construction
and adds approximately zero extraction cost beyond the paint call itself.

Do **not** redraw an already-painted bird in a second generative call. A strict
same-individual pre-filter rejected one of three retrospective redraws even though
all three were complete, clean bird-only sprites. Do not use a prompted two-panel
scene/cutout response as a production contract either: one probe was visually
encouraging, but the API does not promise typed/correlated outputs and the call
regenerated and reformatted the scene.

## Experiment results

### Flat-key-first probe

The probe used three cases inherited from the fixed benchmark, resolved from the
read-only authoring sessions by stable bird `id` (never array position):

| Case | Stress | Input/output tokens | Seconds | Estimated cost |
| --- | --- | ---: | ---: | ---: |
| Venice tiny telescope | r=24, dense line art, held object | 243 / 196 | 22.451 | $0.007338 |
| Hawaii water compass | native 4K, reflection, held object | 1,090 / 196 | 21.046 | $0.014114 |
| Yucatán clean anchor | native 4K, thin legs, magnifier | 1,122 / 196 | 23.885 | $0.014370 |
| **Flat-first total** | | | | **$0.035822** |

For controlled comparison, each call asked `gpt-image-2` to repaint the existing
bird alone on `#FF00FF`. The model did **not** obey the pixel-solid background
instruction: every result contained a subtle smooth magenta gradient. The
deterministic keyer therefore fits that background field from border pixels,
recovers/defringes alpha, keeps only the largest connected subject component,
and uses the prior sprite box only for comparison placement. The resulting three
PNGs have zero border alpha and no satellite components.

This retrospective redraw deliberately tests the risky version of the idea:

- Shared Codex bird-only/completeness pre-filter: **3/3 pass**.
- Strict same-individual visual pre-filter: **2/3 pass**.
- The Venice bird failed identity: body/head proportions, pose, markings,
  expression, and its telescope/gear changed. Hawaii and Yucatán still read as
  the same individual to the pre-filter.

The production route avoids that failure: generate the flat bird **before** the
scene edit, key it once, and use that exact RGBA both as the flyout and as the
pixels composited into the clean crop. No second model call redraws it.

### Same-call paired-output probe

One low-quality `2048x1024` edit asked for the Hawaii scene in the left panel and
the same bird isolated on magenta in the right panel. It cost an estimated
**$0.011984** (1,048 input / 132 output tokens, 21.070 seconds). The result looked
closely related and preserved the compass, but the model regenerated the scene,
changed output geometry, and did not return pixel-identical bird art. This is a
useful exploratory sample, not a callable artifact contract.

### Reproduce

```sh
# Validates stable-id joins without spending.
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-generation-time-extraction/run_experiment.py validate

# Paid calls; OPENAI_API_KEY must already be present in the environment.
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-generation-time-extraction/run_experiment.py flat \
  --out .work/cutout-ticket-16 --quality low

# Re-key the saved provider raws without another paid call.
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-generation-time-extraction/run_experiment.py rekey \
  --out .work/cutout-ticket-16
```

The binary outputs stay under gitignored `.work/cutout-ticket-16/`; the Portal
report carries the review samples. Neither Codex pre-filter is human acceptance.

## Survey findings

| Route | What is actually documented | Close-match consequence | Verdict |
| --- | --- | --- | --- |
| **(a) Generate the bird first, then composite it** | GPT Image 2 can generate/edit images, accept multiple image inputs, and always treats edit inputs at high fidelity, but it **does not support transparent backgrounds**. Gemini can edit from images and combine multiple reference images, but its current guide likewise says to request a white background because transparent output is unsupported. | If the exact extracted/keyed bird pixels are composited deterministically, the flyout and scene necessarily use the same individual. The unresolved problem becomes visual integration: scale, lighting, outline, edge treatment, shadow, and occlusion. | **Best production-oriented experiment.** Use a flat key or a local RGBA generator, then deterministic compositing. Do not ask a second generative call to redraw the bird. |
| **(b) One edit call returns both scene and isolated bird** | OpenAI's `n` requests multiple images, not named correlated artifacts. Gemini can produce interleaved image blocks but warns that it may not follow the requested output count. Neither provider documents a schema for “edited scene + isolated RGBA of the same subject.” | A prompt may produce two visually related outputs, but there is no contract that they depict the same bird pixel-for-pixel—or even that both outputs arrive. | **Reject as a pipeline contract.** At most, test it as an exploratory prompt baseline. |
| **(c) Edit API/model also returns a mask or alpha** | OpenAI and Google expose masks as caller-supplied or internally generated edit guidance. Their documented responses contain edited image data, not the mask used. GPT Image masks are explicitly approximate guidance. | An internal mask cannot be used as the flyout alpha if the API never returns it. | **No qualifying OpenAI/Google API found.** The useful candidates are local layered models, below. |

### OpenAI GPT Image 2

**Documented facts**

- [`gpt-image-2`](https://developers.openai.com/api/docs/models/gpt-image-2) supports both image generation and image editing. The [image generation guide](https://developers.openai.com/api/docs/guides/image-generation) documents multiple input images, multiple generated images through `n`, and automatic high-fidelity processing of every image input for GPT Image 2.
- The same guide says masks are input guidance, may not be followed with exact shape precision, and apply to the first image when multiple images are supplied. Its examples return only base64-encoded output images.
- GPT Image 2 currently rejects `background: "transparent"`; output background is opaque/automatic. PNG output therefore does not imply an alpha cutout.
- Current documented square-image output prices are $0.006 low, $0.053 medium, and $0.211 high at 1024×1024, excluding text/image input tokens. The free API tier is not supported for GPT Image 2.

**Inference and experimental implication**

- The safest GPT Image 2 route is **bird first on an exact flat key**, chroma-key it deterministically, then place that exact RGBA into the clean scene. If integration needs generative help, permit an edit only in a narrow exterior band for contact shadow/edge harmonization and re-overlay the original bird afterward. This preserves the close-match invariant even though GPT Image masks are approximate.
- A second edit call that takes the isolated bird plus scene as references may preserve identity well, but “high fidelity” is not an identity guarantee. Treat any model-redrawn bird pixels as a failure unless a pixel/visual comparison passes.
- `n=2` is not route (b): it yields alternatives under one prompt, not typed `scene` and `cutout` outputs with shared identity.

### Google Gemini and Imagen

**Documented facts**

- Google's current [Gemini image-generation guide](https://ai.google.dev/gemini-api/docs/image-generation) documents image editing, multi-image composition, and multi-turn editing. It says Gemini 3.1 Flash Image supports character resemblance for up to four characters and fidelity for up to ten objects in one workflow.
- The [Generate Content version of the guide](https://ai.google.dev/gemini-api/docs/generate-content/image-generation) explicitly says Gemini image models do not generate transparent backgrounds. It describes “semantic masking” as a prompt that tells the model what to edit, not as returned mask data. The guide also warns that the model may not follow the exact requested number of output images.
- Imagen's [mask-edit documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/edit-insert-objects) allows caller-provided masks or automatic foreground/background/semantic mask detection. Even for automatic masks, the documented response contains only generated PNG prediction bytes; it does not return the detected mask. The same documentation now directs users away from the listed Imagen capability endpoints toward Gemini image models.
- Current [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) lists Gemini 3.1 Flash Image at $0.067 per 1K output ($0.034 batch) and Gemini 3 Pro Image at $0.134 per 1K/2K output ($0.067 batch), before input charges. Neither image model has a standard free tier.

**Inference and experimental implication**

- Gemini is a credible route-(a) compositor because it explicitly supports multi-image composition and object fidelity. It is not a native cutout source: the bird must first be keyed from a flat background or supplied as an existing RGBA-equivalent asset.
- Asking one interaction for “the scene, then the isolated bird” is not reliable enough for route (b): output count is nondeterministic and alpha is unsupported. A contact sheet/two-panel image would still require extraction and would not prove identity.
- Imagen's automatic foreground mask is interesting but unusable here as documented: the mask remains internal. The deprecated/migration-targeted endpoint also makes it a poor new dependency.

### Local layered models

#### LayerDiffuse — the only documented one-pass foreground/background/blend candidate

**Documented facts**

- The official [LayerDiffuse Forge project](https://github.com/lllyasviel/sd-forge-layerdiffuse) is an Apache-2.0 WIP extension for native transparent image/layer diffusion. Its SD1.5 **Generate Everything Together** mode produces foreground, background, and blended image in one diffusion process; background-conditioned mode produces foreground plus blend.
- The project warns that the generated blend passes through VAE/diffusion and can differ from the foreground/background. It recommends compositing the real foreground and background in ordinary software when exact pixels matter.
- The official [Diffusers CLI implementation](https://github.com/lllyasviel/LayerDiffuse_DiffusersCLI) documents transparent SDXL text-to-image and image-to-image output, automatic model downloads, and an 8 GB Nvidia VRAM requirement. The CLI is WIP and has not ported every Forge layer workflow.

**Inference and experimental implication**

- This is the only surveyed implementation that directly approximates routes (b) and (c): one local generation can yield an RGBA foreground and a composed scene. It has near-zero marginal monetary cost. The published 8 GB requirement covers the transparent Diffusers CLI; the joint Forge mode's actual footprint on the available RTX 4090 still needs a live probe.
- The close-match acceptance image must be a deterministic recomposite of the returned RGBA foreground over its returned background—not LayerDiffuse's separately decoded blend. The generated blend can be retained only as a visual-integration reference.
- Risk is substantial: the joint mode is SD1.5-era, WIP, and demonstrated at modest resolutions. A three-bird pilot must first prove the required painted style, intact dark outline, held-item completeness, and scene quality before considering scale.

#### Qwen-Image-Layered — local post-pass, not generation-time

**Documented facts**

- The official [Qwen-Image-Layered model card](https://huggingface.co/Qwen/Qwen-Image-Layered) decomposes one image into multiple RGBA layers, supports a variable layer count, is Apache-2.0, and provides local Diffusers inference. The published model is 20B parameters in BF16 and recommends 640px for the current version.
- The [official repository](https://github.com/QwenLM/Qwen-Image-Layered) says the released weights are tuned for image-to-multi-RGBA decomposition; text-to-multi-RGBA generation is limited, and prompts describe the overall image rather than selecting individual layer semantics.

**Inference and experimental implication**

- This is a strong local route-(c) **comparison baseline** for a final painted crop, especially with recursive decomposition, but it does not eliminate post-generation extraction and cannot be instructed to return “the bird layer” as a hard contract.
- A 20B BF16 model implies roughly 40 GB for weights alone, so the available 24 GB GPU will need quantization/offload; throughput and quality on tiny illustrated birds remain unverified. Test one crop before any corpus run.

### Stability API boundary check

Stability's official [API reference](https://platform.stability.ai/docs/api-reference) documents a separate Remove Background endpoint that returns the foreground with background removed, while its inpaint endpoints consume masks and return edited images. [Pricing](https://platform.stability.ai/pricing) is five credits per removal at $0.01 per credit: $0.05 each, or $14.25 for 285 birds. It does not return a mask alongside the paint edit and is neither free nor local, so it is not a qualifying generation-time route. A 20-sample quality check would cost $1 if separately authorized, but none was run here.

## Recommended experiment order

1. **Local, zero-provider-cost feasibility:** run LayerDiffuse SD1.5 joint generation on three representative bird prompts. Save returned foreground/background/blend and a deterministic foreground-over-background composite. Reject immediately if the deterministic composite cannot match the required scene quality.
2. **Best production-oriented cloud pilot, when paid calls are authorized:** use GPT Image 2 to make the bird on a flat key, extract it deterministically, place it in the clean crop, and optionally edit only the exterior contact band. Compare the final scene bird directly with the stored RGBA flyout.
3. **Google comparison:** repeat route (a) with Gemini 3.1 Flash Image multi-image composition. Do not test same-call paired outputs beyond a single exploratory cell; the API does not promise the required artifact contract.
4. **Extraction fallback:** run Qwen-Image-Layered on one already-painted crop only if LayerDiffuse style quality fails or the cloud route's compositing looks pasted-on. Measure whether one RGBA layer captures the entire bird without background fragments.

For every candidate, the hard gate is identical: deterministic identity match, whole bird/held item, clean alpha at 1–2× sprite scale, no satellite fragments, and acceptable integration into the painted scene. Provider completion or an apparently related second image is not evidence of close match.
