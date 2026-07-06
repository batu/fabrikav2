#!/usr/bin/env python
"""Tier-2 fidelity judge PILOT (card KEghp3x4 §2).

ONE real Gemini judgment on the marble_run *menu* pair — v1 Android reference
vs v2 harness capture — via merceka-core. Advise mode: findings are triaged by
the conductor, not a hard gate (reference-fidelity-harness.md § "Judge role").

Lanes (in order):
  1. Google direct (`gemini/…`, GOOGLE_API_KEY) — the card's intended lane.
  2. OpenRouter (`openrouter/google/gemini-2.5-flash`, OPENROUTER_API_KEY) —
     fallback when the Google prepay account is depleted (observed 429 on
     2026-07-06). Still a real Gemini model, still through merceka-core.

Prompt follows the ce-design-implementation-reviewer discipline: element-by-
element, spacing/color/typography deltas, severity + confidence per finding.
Output is structured JSON so collectRun artifacts consume it without parsing.

Run (from anywhere):
    set -a; source /Users/base/dev/appletolye/.env; set +a
    uv run --project /Users/base/dev/appletolye/merceka-core python judge_menu_pair.py

Writes tier2-gemini-verdict.json next to this script.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN_DIR = HERE.parent  # evidence/2026-07-06-fidelity-harness/
REF = RUN_DIR / "refs" / "menu.png"
CANDIDATE = RUN_DIR / "screenshots" / "menu.png"
OUT = HERE / "tier2-gemini-verdict.json"
PAIR = HERE / "menu-pair-sidebyside.png"

GOOGLE_MODEL = "gemini-flash-latest"          # merceka-core's documented Flash alias
OPENROUTER_MODEL = "openrouter/google/gemini-2.5-flash"

SYSTEM = (
    "You are a design-implementation reviewer comparing a v2 game-UI "
    "implementation (CANDIDATE) against its authoritative v1 reference (REFERENCE). "
    "Work element-by-element. Report concrete spacing, color, typography, and "
    "chrome deltas. This is ADVISE mode: flag what a human grader should look at; "
    "do not moralize. Every finding needs a severity (P1 = breaks the reference "
    "character, P2 = noticeable, P3 = minor) and your confidence (high/medium/low). "
    "Intentional modernization that preserves feel is not a defect — say so."
)

PROMPT_TWO_IMAGE = (
    "State: marble_run MENU (home).\n"
    "IMAGE 1 = REFERENCE (v1, real Android build 'basegamelab', Pixel 6a).\n"
    "IMAGE 2 = CANDIDATE (v2 marble_run, harness/Chromium capture).\n\n"
    "Compare them element by element (top bar: coin pill + gear; title banner; "
    "board; saga chain + level medallions; primary LEVEL button; background). "
    "For each material delta, emit a finding. Then give an overall_fidelity verdict."
)

PROMPT_PAIR = (
    "State: marble_run MENU (home). This single image is a SIDE-BY-SIDE pair:\n"
    "LEFT = REFERENCE (v1, real Android build 'basegamelab', Pixel 6a).\n"
    "RIGHT = CANDIDATE (v2 marble_run, harness/Chromium capture).\n\n"
    "Compare them element by element (top bar: coin pill + gear; title banner; "
    "board; saga chain + level medallions; primary LEVEL button; background). "
    "For each material delta, emit a finding. Then give an overall_fidelity verdict. "
    "Respond with ONLY a JSON object matching the requested schema."
)

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "state": {"type": "string"},
        "overall_fidelity": {"type": "string", "enum": ["high", "medium", "low"]},
        "summary": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "element": {"type": "string"},
                    "axis": {"type": "string", "enum": ["layout", "palette", "typography", "chrome", "motion"]},
                    "delta": {"type": "string"},
                    "severity": {"type": "string", "enum": ["P1", "P2", "P3"]},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "intentional_modernization": {"type": "boolean"},
                },
                "required": ["element", "axis", "delta", "severity", "confidence"],
            },
        },
    },
    "required": ["state", "overall_fidelity", "summary", "findings"],
}


def _google_direct() -> dict:
    from google import genai
    from google.genai import types

    client = genai.Client(http_options=types.HttpOptions(timeout=600_000))
    contents = [
        types.Part.from_bytes(data=REF.read_bytes(), mime_type="image/png"),
        types.Part.from_bytes(data=CANDIDATE.read_bytes(), mime_type="image/png"),
        PROMPT_TWO_IMAGE,
    ]
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM,
        response_mime_type="application/json",
        response_schema=RESPONSE_SCHEMA,
        temperature=0.2,
    )
    resp = client.models.generate_content(model=GOOGLE_MODEL, contents=contents, config=config)
    return {"lane": f"google-direct/{GOOGLE_MODEL}", "verdict": json.loads(resp.text)}


def _compose_pair() -> Path:
    from PIL import Image

    left, right = Image.open(REF), Image.open(CANDIDATE)
    h = max(left.height, right.height)
    lw = round(left.width * h / left.height)
    rw = round(right.width * h / right.height)
    gap = 24
    canvas = Image.new("RGB", (lw + gap + rw, h), (16, 19, 26))
    canvas.paste(left.resize((lw, h)), (0, 0))
    canvas.paste(right.resize((rw, h)), (lw + gap, 0))
    canvas.save(PAIR)
    return PAIR


def _openrouter() -> dict:
    from merceka_core.llm import LLM

    pair = _compose_pair()
    llm = LLM(OPENROUTER_MODEL, system_prompt=SYSTEM)
    raw = llm.generate_with_resource(PROMPT_PAIR, pair)
    text = raw if isinstance(raw, str) else json.dumps(raw)
    start, end = text.find("{"), text.rfind("}")
    verdict = json.loads(text[start : end + 1]) if start != -1 else {"raw": text}
    return {"lane": OPENROUTER_MODEL, "verdict": verdict}


def main() -> int:
    for p in (REF, CANDIDATE):
        if not p.exists():
            print(f"missing image: {p}", file=sys.stderr)
            return 2

    lane_result: dict | None = None
    google_err: str | None = None
    if os.environ.get("GOOGLE_API_KEY"):
        try:
            lane_result = _google_direct()
        except Exception as exc:  # noqa: BLE001 — fall back to OpenRouter on any Google error
            google_err = f"{type(exc).__name__}: {exc}"
            print(f"google-direct lane failed → {google_err}\nfalling back to OpenRouter…", file=sys.stderr)

    if lane_result is None:
        if not os.environ.get("OPENROUTER_API_KEY"):
            print("both lanes unavailable (no GOOGLE credits, no OPENROUTER_API_KEY)", file=sys.stderr)
            return 2
        lane_result = _openrouter()

    record = {
        "tier": 2,
        "judge": "gemini",
        "lane": lane_result["lane"],
        "mode": "advise",
        "google_direct_error": google_err,
        "pair": {"reference": "refs/menu.png", "candidate": "screenshots/menu.png"},
        "verdict": lane_result["verdict"],
    }
    OUT.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} (lane={lane_result['lane']})")
    print(json.dumps(lane_result["verdict"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
