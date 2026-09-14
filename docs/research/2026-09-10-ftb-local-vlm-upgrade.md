# Local VLM upgrade candidates for FTB visual review

**Date:** 2026-09-10

**Target:** Ubuntu workstation, RTX 4090 24 GB; judge sprite-to-anchor alignment and faint cleanup residue from rendered crops. Existing `qwen3.5:27b` and `gemma4:26b` are roughly 17 GB each.

## Recommendation

**Live outcome:** both Qwen3.8-27B and Muse Glimmer 30B were installed and tested. Neither established an accuracy improvement for FTB residue. All three tested models (including the existing Qwen3.5) missed the known tail fragment in the wider crop. With a manually selected enlarged detail, Qwen3.5 and Muse flagged it; Qwen3.8 still missed it. Keep automatic pixel flags and uncertainty; do not promote a VLM to automatic clearance. See [recorded pilot](../evidence/2026-09-10-ftb-vlm-pilot/README.md). This small, non-thinking pilot is a smoke test, not a general model ranking.

The primary-source survey selected **`qwen3.8:27b` as the first candidate**. Its official 27B model is a native image/video model under Apache-2.0, and Ollama publishes a Linux-compatible image tag at **18 GB** with image input and a 256K context window. Qwen reports the strongest relevant proxies here: **OSWorld-Verified 84.3, Vision2Web 62.9, OmniDocBench 1.5 91.1, and RealWorldQA 85.9**. Those scores do not prove pixel-level residue sensitivity, but UI grounding, visual reconstruction, document perception, and real-world perception are closer to this job than general reasoning scores. [Qwen model card and benchmarks](https://huggingface.co/Qwen/Qwen3.8-27B) · [Ollama tags](https://ollama.com/library/qwen3.8/tags) · [HF API metadata](https://huggingface.co/api/models/Qwen/Qwen3.8-27B)

Keep **`muse-glimmer:30b` as the second challenger** if the Qwen pilot does not clearly improve alignment/residue judgments. Meta released it on **2026-08-10** under Apache-2.0 and explicitly designed its approximately 4-bit build to keep the language model under 20 GB while leaving room for KV cache, perception encoder, and speculative drafter inside a 24/32 GB memory envelope. Ollama's default 30B image-capable quant is **18 GB**. Its reported multimodal results—**ScreenSpot Pro 75.4, OmniDocBench 1.5 75.8, MMMU Pro 74.0**—support screenshot perception, although Qwen's official table reports a materially higher OmniDocBench score. [Meta announcement and local-memory description](https://research.meta.ai/blog/introducing-muse-glimmer-open-agentic-model) · [Meta/Ollama benchmark table](https://ollama.com/library/muse-glimmer) · [Ollama tags](https://ollama.com/library/muse-glimmer/tags) · [HF API metadata](https://huggingface.co/api/models/meta-models/Muse-Glimmer-30B)

Treat **`ornith-1.5:9b` as a low-memory control**, not the expected quality winner. Ornith describes the August 2026 release as a 9B dense vision model derived from Qwen3.5/Gemma4 work; its official Hugging Face metadata specifies MIT, while Ollama provides a **6.6 GB**, image-capable 256K tag. The publisher reports strong coding/agentic results (for example SWE-bench Verified 70.6), but publishes **no visual-perception, grounding, or fine-detail benchmark** for the 9B model. It may be useful for cheap first-pass triage, but there is no primary-source evidence that it improves this visual task over the installed 27B/26B baselines. [Ornith release and evaluations](https://ornith.ai/ornith_1_5.html) · [official model card](https://huggingface.co/ornith-ai/Ornith-1.5-9B) · [Ollama tags](https://ollama.com/library/ornith-1.5/tags) · [HF API metadata](https://huggingface.co/api/models/ornith-ai/Ornith-1.5-9B)

## Practical comparison

| Candidate | Official release evidence | License | Ollama image build | 4090 24 GB assessment |
|---|---|---|---|---|
| Qwen3.8-27B | HF repository updated 2026-08-14; native vision encoder | Apache-2.0 | `qwen3.8:27b`, 18 GB | Best first pilot; similar footprint to the current models, with roughly 6 GB left before runtime/cache overhead |
| Muse Glimmer 30B | Meta announcement 2026-08-10 | Apache-2.0 | `muse-glimmer:30b`, 18 GB | Realistic; uniquely documented by its publisher for a complete 24 GB quantized runtime envelope |
| Ornith-1.5-9B | Official August 2026 announcement; HF repository created 2026-08-18 | MIT | `ornith-1.5:9b`, 6.6 GB | Easy fit and useful latency control; visual quality is unsubstantiated |

All three have first-party Ollama tags accepting text and image input, so they use the existing Ollama-shaped API. Runtime-version compatibility still requires a live check. Exact peak VRAM depends on image resolution, context length, Ollama version, KV-cache settings, and GPU offload; artifact size is not a guarantee of full-GPU residency.

## Live installation check

The existing Ubuntu Ollama 0.20.4 rejected `qwen3.8:27b` with HTTP 412 (newer runtime required). A separate official Ollama 0.34.0 archive was installed at `/home/batu/ftb-vlm-runtime`, serving only `127.0.0.1:11438`, with its own model directory. The existing service on 11434 was not restarted or replaced. `qwen3.8:27b` downloaded successfully; installed digest prefix `22130167c4c2`, locally reported size 17 GB. [Official release](https://github.com/ollama/ollama/releases/tag/v0.34.0) · [Manual installation documentation](https://docs.ollama.com/linux)

The local pilot uses identical before/after crops for four birds, fixed prompt, non-thinking responses, 8,192 context, a 500-token response cap, and releases each model after its request. No cloud inference API or paid model service is used. General benchmark improvements remain distinct from the recorded FTB pilot results.

## Exclusions and caveats

- **`qwen3.8-flash-next:125b-mlx` is not a 4090 candidate.** Ollama lists only a **105 GB MLX** build, which is for Apple Silicon and far exceeds 24 GB. Its 6B active-parameter count reduces compute per token, not stored-weight memory. [Ollama model page](https://ollama.com/library/qwen3.8-flash-next)
- **`ornith-1.5:35b` is marginal rather than practical.** Its 23 GB Ollama artifact leaves essentially no stated room for the vision stack and KV cache on a 24 GB card; CPU offload would weaken the local-review latency case. [Ollama tags](https://ollama.com/library/ornith-1.5/tags)
- Vendor benchmarks evaluate broad screenshot/UI or perception tasks, not alpha-edge residue, one-to-three-pixel displacement, transparent padding, or FTB art. The deciding evidence must be a blind local set containing accepted crops and known failures, scored for false accepts and false rejects at the same render resolution used by the pipeline.
- For a fair pilot, pin Ollama model digests and prompting, disable or standardize thinking, use identical crops, and record latency plus peak VRAM. A model should replace a baseline only if it improves error detection without inflating false rejections.
