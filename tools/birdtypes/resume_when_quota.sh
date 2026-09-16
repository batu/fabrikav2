#!/bin/zsh
# agy's individual quota was exhausted 2026-09-16 23:00 (429, "resets in 2h31m").
# Poll cheaply with ONE call every 20 min; the moment it answers, run the full
# classifier (which itself skips everything already in classified.jsonl) and
# rebuild bird-types.json.
cd "$(dirname "$0")/../.."
PROBE=$(uv run --no-project python -c "import json;print(json.load(open('tools/birdtypes/worklist.json'))[0]['sprite_abs'])")
for i in $(seq 1 40); do
  OUT=$(agy -p="Open the image at $PROBE. Reply with STRICT JSON only: {\"ok\":true}" \
        --dangerously-skip-permissions --output-format json 2>&1)
  if echo "$OUT" | grep -q '"ok"'; then
    echo "[$(date)] quota back after $i probes; classifying"
    uv run --no-project python tools/birdtypes/classify.py
    uv run --no-project python tools/birdtypes/build_bird_types.py
    echo "[$(date)] classification complete"
    exit 0
  fi
  echo "[$(date)] probe $i: still blocked ($(echo "$OUT" | grep -o 'RESOURCE_EXHAUSTED[^\"]*' | head -1))"
  sleep 1200
done
echo "[$(date)] gave up after 40 probes"
exit 1
