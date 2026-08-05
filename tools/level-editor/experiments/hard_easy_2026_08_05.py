"""Hard/easy bird ratio experiment (2026-08-05).

Five arms, all cloned from the verified fall level (34ea) and reusing its
exact 18 snapped hitbox positions so only the difficulty labels vary:

  sp66  single-pass, 12 easy / 6 hard   (66% easy)
  sp33  single-pass,  6 easy / 12 hard  (33% easy)
  sp00  single-pass,  0 easy / 18 hard  (0% easy)
  dp66  double-pass,  pass1 12 easy -> pass2 6 hard on the painted scene
  dp33  double-pass,  pass1  6 easy -> pass2 12 hard

Hard circles are drawn cyan (#00FFFF); the magenta prompt gains a
camouflage clause (inpaint._magenta_prompt(hard=True)). Measurement:
detect_birds_vlm recall per difficulty class — camouflage working should
show as a hard-class recall drop.

Run: uv run python experiments/hard_easy_2026_08_05.py
Env: OPENROUTER_API_KEY, MERCEKA_FORCE_OPENROUTER=1,
     LEVEL_EDITOR_URL=http://127.0.0.1:5196 (for the CLI subprocess verbs).
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Same game workspace as `run-backend.sh --game find_the_bird` — MUST be
# applied before levelbuilder.api.session imports and caches its roots.
from levelbuilder.settings import resolve_game  # noqa: E402
resolve_game("find_the_bird").apply()

from levelbuilder.api import inpaint as I  # noqa: E402
from levelbuilder.api import session as S  # noqa: E402

SRC = "ad_campaigns_ad_autumn_forest_bird_34ea"
MODEL = "google/gemini-3.1-flash-image-preview"
SEED = 7

ARMS = {
    "he_sp66": {"hard": 6, "double": False},
    "he_sp33": {"hard": 12, "double": False},
    "he_sp00": {"hard": 18, "double": False},
    "he_dp66": {"hard": 6, "double": True},
    "he_dp33": {"hard": 12, "double": True},
}


def cli(*args: str) -> None:
    subprocess.run(
        ["uv", "run", "level-editor", *args],
        cwd=Path(__file__).resolve().parents[1], check=True,
        capture_output=True, text=True,
    )


def load_src():
    raw = S.load_session_raw(SRC)
    hbs = json.loads((S.session_dir(SRC) / "hitboxes.json").read_text())
    base = [{"x": h["x"], "y": h["y"], "r": h.get("r", 57)} for h in hbs]
    return raw, base


def assign(base: list[dict], hard_n: int) -> list[dict]:
    rng = random.Random(SEED)
    hard_idx = set(rng.sample(range(len(base)), hard_n))
    return [
        {**h, **({"difficulty": "hard"} if i in hard_idx else {})}
        for i, h in enumerate(base)
    ]


def vlm_recall(sid: str, hbs: list[dict]) -> dict:
    boxes = I.detect_birds_vlm(sid)
    centers = [(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2) for b in boxes]
    out = {"easy": [0, 0], "hard": [0, 0]}  # [found, total]
    for h in hbs:
        cls = "hard" if str(h.get("difficulty") or "") == "hard" else "easy"
        out[cls][1] += 1
        r = h.get("r", 57) * 1.5
        if any((cx - h["x"]) ** 2 + (cy - h["y"]) ** 2 <= r * r for cx, cy in centers):
            out[cls][0] += 1
    return out


def run_arm(name: str, spec: dict, raw: dict, base: list[dict]) -> dict:
    sid = f"{SRC.rsplit('_', 1)[0]}_{name}"
    print(f"=== {sid} (hard={spec['hard']}, double={spec['double']})", flush=True)
    if not S.session_dir(sid).exists():
        S.clone_session(SRC, sid, reset_paint=True)
    hbs = assign(base, spec["hard"])
    dog_prompt = raw["dog_prompt"]

    if not spec["double"]:
        S.save_hitboxes(sid, hbs)
        I.run_magenta_inpaint(sid, hitbox_list=hbs, dog_prompt=dog_prompt, model=MODEL)
    else:
        easy = [h for h in hbs if h.get("difficulty") != "hard"]
        hard = [h for h in hbs if h.get("difficulty") == "hard"]
        S.save_hitboxes(sid, easy)
        I.run_magenta_inpaint(sid, hitbox_list=easy, dog_prompt=dog_prompt, model=MODEL)
        sdir = S.session_dir(sid)
        # Pass 2 paints ON the pass-1 result: expose it as bg_02 and target it.
        shutil.copyfile(sdir / "color.png", sdir / "bg_02.png")
        I.run_magenta_inpaint(
            sid, hitbox_list=hard, dog_prompt=dog_prompt, model=MODEL, bg_index=2,
        )
        # Session's selected clean bg is untouched, so exports still restore
        # to the true birdless background for BOTH passes (positions are
        # pairwise disjoint by construction).
        S.save_hitboxes(sid, hbs)

    cli("recenter-hitboxes-local", sid, "--prune-empty")
    recall = vlm_recall(sid, json.loads((S.session_dir(sid) / "hitboxes.json").read_text()))
    cli("materialize-hitbox-sprites", sid)
    cli("approve", sid)
    print(f"    recall {recall}", flush=True)
    return {"sid": sid, **spec, "vlm_recall": recall}


def main() -> None:
    raw, base = load_src()
    results = []
    for name, spec in ARMS.items():
        try:
            results.append(run_arm(name, spec, raw, base))
        except Exception as exc:  # noqa: BLE001 — record and continue the sweep
            print(f"    FAILED {name}: {exc}", flush=True)
            results.append({"sid": name, "error": str(exc)})
    out = Path(__file__).with_suffix(".results.json")
    out.write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
