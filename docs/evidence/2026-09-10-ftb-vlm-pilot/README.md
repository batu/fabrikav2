# Local VLM residue pilot

## Scope

This is a bounded comparison on exported-asset pickup simulations, not a validated production judge. The fixed four-case set contains a visible Hawaii tail fragment, two visually inspected clean controls, and a small Library candidate whose semantic label remains uncertain. Models see identical before/after images and no overlap scores, masks, or residue flags. A separate manually selected detail crop tests sensitivity to image framing; it is not a blind benchmark.

`pilot.py` preserves the exact executed comparison, including model, prompt, crop construction, decoding options, and request timing. Its absolute paths intentionally identify this run's corpus and environment. The `*-detail.json` records retain the separate close-up prompt and coordinates. Raw responses and local inference token counts are saved rather than replacing them with normalized conclusions.

## Verified findings

- Qwen3.5-27B, Qwen3.8-27B and Muse Glimmer 30B all answered **no residue on all four wider crops**, including the visible Hawaii fragment. None is suitable for clearing the automatic pixel flags based on this pilot.
- On the enlarged Hawaii detail, Qwen3.5 answered **yes** while Qwen3.8 still answered **no**. The newer checkpoint did not improve this particular failure.
- Muse also answered **yes** on the enlarged detail, although its description is not precise enough to establish superior localization. That matches the older baseline on one positive example; it does not establish an accuracy upgrade. Total: 12 wider-crop calls and three detail calls, all local.
- Qwen3.8's first request took 73.51 seconds; its subsequent three took 21.82–23.30 seconds. Qwen3.5 took 27.70–33.10 seconds. Every request unloaded its model afterward; these include model-load time and are not warmed-throughput benchmarks.
- Muse's four wider-crop requests took 19.47–27.49 seconds. Its responses included a trailing `<|eot|>` marker despite JSON format being requested; raw outputs preserve that integration limitation.

## Runtime and cost

All inference used the user's Ubuntu RTX 4090. No hosted model endpoint, paid API, or cloud model was invoked. This statement does not price electricity or the surrounding Codex session.

Existing Ollama 0.20.4 continues on port 11434. The official Ollama 0.34.0 runtime is isolated in `/home/batu/ftb-vlm-runtime`, with models in its own `models` directory, serving loopback port 11438. It was started directly, without installing a system service or changing the existing one. `installed-model.json` records both downloaded model identities. Both `qwen3.8:27b` and `muse-glimmer:30b` completed actual image inference. No existing judge default was changed.

To use the installed candidate while that process is running:

```sh
ssh ubuntu-server 'OLLAMA_HOST=127.0.0.1:11438 /home/batu/ftb-vlm-runtime/bin/ollama run qwen3.8:27b'
```

If the isolated process is no longer running, start it with:

```sh
OLLAMA_HOST=127.0.0.1:11438 \
OLLAMA_MODELS=/home/batu/ftb-vlm-runtime/models \
OLLAMA_CONTEXT_LENGTH=8192 OLLAMA_NUM_PARALLEL=1 \
OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_KEEP_ALIVE=0 \
/home/batu/ftb-vlm-runtime/bin/ollama serve
```

Sequence VLM and SAM work on the single GPU. No live service was stopped for this comparison. Vendor benchmark citations and alternative candidates are in `docs/research/2026-09-10-ftb-local-vlm-upgrade.md`.
