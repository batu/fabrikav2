# GPU judge lane (ubuntu-server / "pato", RTX 4090)

The semantic sprite judge's free batch backend runs on the 4090 host via
Ollama — no custom serving code.

## Model

`qwen3.5:27b` (Q4_K_M, vision-capable), already pulled on the host.
Throughput observed 2026-07-31: ~26 s/judgment after first-load (~90 s cold).

## Access

Ollama binds localhost on the GPU host. Open a tunnel before batch runs:

```sh
ssh -f -N -L 11435:localhost:11434 ubuntu-server
```

The `OllamaJudge` backend (`levelbuilder/api/sprite_judge.py`) defaults to
`http://localhost:11435`; override with `LEVEL_EDITOR_OLLAMA_URL`.

## Health check

```sh
curl -s http://localhost:11435/api/version
```

## SAM2 (cutout masking, plan U7)

A separate uv project at `~/sam2-service` on the host carries torch + SAM2
for mask extraction. Checkpoints download from Hugging Face on first use.
