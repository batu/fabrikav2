"""Repaint the final worklist via the running server (OpenAI direct lane).

OpenRouter credits are exhausted; `openai/gpt-image-2` routes through
OPENAI_API_KEY (routes.py BASE_MODELS). Serial, resumable.

    uv run --project ../../../tools/level-editor python repaint_all.py
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
WORKSPACE = REPO / "games" / "find_the_bird" / ".levelbuilder" / "levels"
API = "http://localhost:5192"
MODEL = "openai/gpt-image-2"


def main() -> None:
    worklist = json.loads((HERE / "repaint_final.json").read_text())
    out_path = HERE / "repaint_results.json"
    results = json.loads(out_path.read_text()) if out_path.exists() else {}

    for i, key in enumerate(worklist):
        if key in results and results[key].get("ok"):
            continue
        level_id, dog_name = key.split("/")
        index = int(dog_name.split("_")[1])
        session_path = WORKSPACE / level_id / "session.json"
        if not session_path.exists():
            results[key] = {"ok": False, "error": "no session"}
            continue
        raw = json.loads(session_path.read_text())
        dog = next((d for d in raw.get("dogs", []) if d.get("index") == index), None)
        if dog is None or not dog.get("id"):
            results[key] = {"ok": False, "error": "no dog meta/stable id"}
            continue
        prompt = raw.get("dog_prompt") or (
            "Add exactly one small cartoon bird in the scene's coloring-book "
            "sticker style, doing something charming with its surroundings."
        )
        start = time.time()
        try:
            response = httpx.post(
                f"{API}/api/sessions/{level_id}/dogs/by-id/{dog['id']}/regen",
                json={"prompt": prompt, "inpaintModel": MODEL},
                timeout=420.0,
            )
            response.raise_for_status()
            payload = response.json()
            results[key] = {"ok": True, "variant": payload.get("variantIndex"),
                            "seconds": round(time.time() - start, 1)}
        except Exception as exc:  # noqa: BLE001 — keep the batch going
            results[key] = {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:200]}"}
        out_path.write_text(json.dumps(results, indent=1))
        print(f"[{i + 1}/{len(worklist)}] {key} -> {results[key]}", flush=True)

    ok = sum(1 for r in results.values() if r.get("ok"))
    print(f"done: {ok}/{len(worklist)} repainted")


if __name__ == "__main__":
    main()
