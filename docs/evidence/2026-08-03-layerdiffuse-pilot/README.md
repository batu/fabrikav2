# LayerDiffuse joint-generation pilot

**Ticket:** [LayerDiffuse joint generation pilot on the 4090](https://github.com/batu/fabrikav2/issues/25)

**Date:** 2026-08-03

**Verdict:** **Reject this route for Find the Bird.** The official SD1.5
background-conditioned workflow fit the RTX 4090 comfortably, but none of the
three fixed cases produced the requested bird and held item. The RGBA outputs
also retained unrelated objects or broad scene layers.

Generated images remain under gitignored `.work/cutout-ticket-25/` and in the
linked Portal report. Source authoring sessions were read only.

## What ran

The pilot used the official ComfyUI LayerDiffuse **Generate FG + Blended given
BG** graph, which is the background-conditioned form of the requested joint
workflow:

- ComfyUI `f40076096e2a448c82bbc4a631982274dc85e7c2` (reported as 0.3.15)
- ComfyUI-layerdiffuse `b4f6a9e024064a4489f774a8b91049ce0b606ea3`
- `SD15, Background, attn_sharing, Batch size (2N)`
- DreamShaper 8 SD1.5 checkpoint, SHA-256
  `879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd`
- 512×512, 28 steps, CFG 7, DPM++ 2M Karras, one fixed seed per case
- RTX 4090 24,564 MiB, driver 595.84; Python 3.12.3; Torch 2.13.0+cu130

The first live call reproduced an upstream device-placement defect: the
extension moved the conditioned tensor to CUDA but left its custom control
convolution on CPU. The call failed at
`lib_layerdiffusion/attention_sharing.py:175` with
`Input type (torch.cuda.HalfTensor) and weight type (torch.HalfTensor) should be the same`.
The recorded one-line [compatibility patch](comfyui-layerdiffuse-device.patch)
moves the registered attention-sharing unit to `h.device` at forward entry.
The unchanged official graph then completed all three cases.

## Results

The hard comparison is the ordinary-software foreground-over-input-background
composite, not the separately decoded model blend.

| Case | Source conditioning | Elapsed | Observed total / incremental GPU | Alpha | Finding |
| --- | ---: | ---: | ---: | --- | --- |
| Venice tiny telescope | 132→512, **3.879× upscale** | 6.555 s | 7,238 / 4,078 MiB | 2 components; border max 0 | Produced a witch-like person plus a dog, not a bird. The requested telescope became a wand-like line. |
| Hawaii water compass | 604→512, **0.848× downscale** | 5.017 s | 7,462 / 1,408 MiB | 4 components; border max 131 | Produced a different blue bird, omitted the compass, and included a large opaque rock/base in the foreground. |
| Yucatán clean anchor | 832→512, **0.615× downscale** | 4.584 s | 7,462 / 0 MiB warm | 5 components; border max 255 | Produced a human holding a mirror plus a broad water layer, not the long-beaked bird with magnifier. |

The GPU sampler sums active compute-process memory, so “observed total” includes
the already-running services on the host. The highest incremental rise over the
pre-call baseline was 4,078 MiB; fit was not the blocker.

### Acceptance checks

| Requirement | Result |
| --- | --- |
| Whole bird plus held/worn item | **0/3** |
| Correct scene style and scale | **0/3** |
| Identical scene/flyout pixels via exact composite | Mechanically yes, but for the wrong generated subject |
| No satellite/background fragments | **0/3** by alpha component and visual inspection |
| Winning method near-zero provider cost | Yes ($0 provider cost), but quality gate failed |

No retry or seed sweep is warranted for this ticket. The task explicitly allows
early rejection when the official SD1.5 workflow cannot produce the required
painted style, and all three representative prompts failed the more basic
subject-plus-item gate.

## Artifacts and reproduction

- `pilot-cases.json` — the three stable-id cases, prompts, seeds, and sampler settings
- `run_layerdiffuse_pilot.py` — source validation, conditioning crop preparation,
  official ComfyUI API graph, VRAM/timing capture, exact compositing, alpha checks,
  and comparison sheets
- `comfyui-layerdiffuse-device.patch` — recorded compatibility patch required by
  the first live run
- `.work/cutout-ticket-25/resolved-cases.json` — source boxes and resampling facts
- `.work/cutout-ticket-25/results/run-summary.json` — hashes and measured run data

Prepare the read-only source inputs locally:

```sh
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-layerdiffuse-pilot/run_layerdiffuse_pilot.py \
  prepare --out .work/cutout-ticket-25
```

On the GPU host, install ComfyUI at the pinned commit, install the pinned
ComfyUI-layerdiffuse extension, place DreamShaper 8 under
`ComfyUI/models/checkpoints/`, place `layer_sd15_bg2fg.safetensors` and
`layer_sd15_vae_transparent_decoder.safetensors` under
`ComfyUI/models/layer_model/`, apply the recorded patch, then start ComfyUI on a
private loopback port. Copy the three prepared `background.png` inputs to the
server input directory using the `<caseId>-background.png` names.

Run the graph on the host:

```sh
python run_layerdiffuse_pilot.py --cases pilot-cases.json run \
  --server http://127.0.0.1:8990 \
  --input-root /home/batu/cutout-ticket-25-layerdiffuse/input \
  --output-root /home/batu/cutout-ticket-25-layerdiffuse/output \
  --setup-root /home/batu/cutout-ticket-25-layerdiffuse
```

After copying the output directory back to
`.work/cutout-ticket-25/results/`, render the sheets:

```sh
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-layerdiffuse-pilot/run_layerdiffuse_pilot.py \
  sheets --out .work/cutout-ticket-25/results
```

The source sessions were only opened for stable-id validation and image reads.
No source-session file, game code, export, or runtime sprite was changed.
