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

`~/sam2-service` on the host runs `sam2_server.py` (this directory; scp it
over) on port **8977** with SAM2.1-hiera-large. Launch:

```sh
ssh ubuntu-server 'cd ~/sam2-service && setsid nohup ~/.local/bin/uv run python sam2_server.py > sam2_server.log 2>&1 < /dev/null &'
ssh -f -N -L 8977:localhost:8977 ubuntu-server
curl -s http://localhost:8977/health
```

Then `FTD_SAM2_URL=http://localhost:8977` makes SAM2 the ladder's primary
cutout (`FTD_SAM2_PRIMARY=0` reverts to diff-first). Ports 8765/8766/11434
belong to other services on the host — do not touch them.

**GPU contention:** the ollama judge model holds ~22 GiB; SAM2 OOMs while it
is resident. `ollama stop qwen3.5:27b` before mask batches, or sequence the
two workloads.
