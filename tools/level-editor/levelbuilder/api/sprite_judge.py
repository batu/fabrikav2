"""Semantic sprite judging (axes: subject correctness, completeness).

Pluggable backends behind one interface. Each backend receives a single
composite panel image (clean crop | painted crop | sprite on checkerboard)
plus the shared prompt, and returns a structured verdict. Backends never
loop or retry policy-decide; the caller owns batching and routing.

Backends:
- OpenRouterJudge: merceka_core LLM over OpenRouter (same plumbing as
  smart_hitboxes vision scoring). Paid; used for gold labels/calibration.
- CodexExecJudge: `codex exec --json -i panel.png` on subscription billing.
- (pato 4090 backend arrives with the U3 service; same panel contract.)
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

JUDGE_SCHEMA_VERSION = 1

# The product rule for what a pickup sprite is (plan R2). Guarded by tests;
# every backend prompt must carry it verbatim.
SUBJECT_RULE = (
    "A valid pickup sprite contains exactly one complete bird PLUS any items the "
    "bird is holding, wearing, or using (binoculars, hat, book, telescope, map). "
    "Perches, branches, stalls, shadows, foliage, and scenery the image model "
    "painted around the bird are BACKGROUND and must NOT be part of the sprite."
)

PROMPT_TEMPLATE = (
    "You are judging one pickup sprite for a hidden-object bird game drawn in a "
    "coloring-book sticker style.\n"
    + SUBJECT_RULE + "\n"
    "The attached panel shows, left to right:\n"
    "1. CLEAN: the background before the bird was painted (may be absent).\n"
    "2. PAINTED: the scene after inpainting.\n"
    "3. SPRITE: the extracted cutout on a checkerboard.\n"
    "Score two axes from 0.0 to 1.0:\n"
    "- subject: is the SPRITE a single recognizable bird plus only its "
    "held/worn items? Background chunks, props (barrels, lanterns, rocks, "
    "leaves), or empty cutouts score near 0.\n"
    "- completeness: comparing SPRITE to the bird visible in PAINTED, is the "
    "whole bird present (head, body, tail, feet when painted) without "
    "truncation or missing parts? If PAINTED is absent judge the sprite alone.\n"
    "Respond with ONLY a JSON object: {\"subject\": <float>, "
    "\"completeness\": <float>, \"evidence\": \"<one sentence>\"}."
)

PANEL_HEIGHT = 512


class JudgeError(RuntimeError):
    pass


@dataclass(frozen=True)
class JudgeCase:
    dog_id: str
    sprite: Image.Image  # RGBA
    painted_crop: Image.Image | None = None
    clean_crop: Image.Image | None = None


@dataclass(frozen=True)
class JudgeVerdict:
    dog_id: str
    subject: float
    completeness: float
    evidence: str
    backend: str
    ok: bool = True
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "schemaVersion": JUDGE_SCHEMA_VERSION,
            "dogId": self.dog_id,
            "subject": self.subject,
            "completeness": self.completeness,
            "evidence": self.evidence,
            "backend": self.backend,
            "ok": self.ok,
            "error": self.error,
        }


def _failed(case: JudgeCase, backend: str, error: str) -> JudgeVerdict:
    return JudgeVerdict(
        dog_id=case.dog_id, subject=0.0, completeness=0.0,
        evidence="", backend=backend, ok=False, error=error,
    )


def _checkerboard(size: tuple[int, int], square: int = 16) -> Image.Image:
    board = Image.new("RGB", size, (200, 200, 200))
    draw = ImageDraw.Draw(board)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle([x, y, x + square - 1, y + square - 1], fill=(150, 150, 150))
    return board


def _fit(img: Image.Image, height: int) -> Image.Image:
    if img.height == 0:
        return img
    width = max(1, round(img.width * height / img.height))
    return img.resize((width, height), Image.LANCZOS)


def build_judge_panel(case: JudgeCase) -> Image.Image:
    """One labeled side-by-side panel: CLEAN | PAINTED | SPRITE."""
    panels: list[Image.Image] = []
    for img in (case.clean_crop, case.painted_crop):
        if img is not None:
            panels.append(_fit(img.convert("RGB"), PANEL_HEIGHT))
    sprite = _fit(case.sprite.convert("RGBA"), min(PANEL_HEIGHT, max(64, case.sprite.height * 2)))
    board = _checkerboard((sprite.width + 32, PANEL_HEIGHT))
    board.paste(sprite, (16, (PANEL_HEIGHT - sprite.height) // 2), sprite)
    panels.append(board)
    gap = 8
    width = sum(p.width for p in panels) + gap * (len(panels) - 1)
    sheet = Image.new("RGB", (width, PANEL_HEIGHT + 24), (30, 30, 30))
    labels = (["CLEAN", "PAINTED"][2 - (len(panels) - 1):]) + ["SPRITE"]
    draw = ImageDraw.Draw(sheet)
    x = 0
    for label, panel in zip(labels, panels):
        sheet.paste(panel, (x, 24))
        draw.text((x + 4, 4), label, fill=(255, 255, 255))
        x += panel.width + gap
    return sheet


def parse_verdict_json(text: str) -> dict:
    """Extract the verdict object from possibly chatty model output."""
    match = re.search(r"\{[^{}]*\"subject\"[^{}]*\}", text, re.DOTALL)
    if not match:
        raise JudgeError(f"no verdict JSON in output: {text[:200]!r}")
    data = json.loads(match.group(0))
    for key in ("subject", "completeness"):
        value = data.get(key)
        if not isinstance(value, (int, float)) or not (0.0 <= float(value) <= 1.0):
            raise JudgeError(f"invalid {key!r} in verdict: {value!r}")
        data[key] = float(value)
    data.setdefault("evidence", "")
    return data


class CodexExecJudge:
    """Judge via `codex exec --json -i panel.png` on subscription billing."""

    name = "codex-exec"

    def __init__(self, model: str | None = None, timeout_s: float = 240.0):
        self.model = model
        self.timeout_s = timeout_s

    def judge(self, case: JudgeCase) -> JudgeVerdict:
        panel = build_judge_panel(case)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
            panel.save(handle, format="PNG")
            panel_path = Path(handle.name)
        try:
            cmd = ["codex", "exec", "--json", "-i", str(panel_path)]
            if self.model:
                cmd += ["-m", self.model]
            cmd += ["--", PROMPT_TEMPLATE]
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=self.timeout_s, check=False,
            )
            if proc.returncode != 0:
                return _failed(case, self.name, f"codex exit {proc.returncode}: {proc.stderr[-300:]}")
            text = _last_codex_message(proc.stdout)
            data = parse_verdict_json(text)
        except FileNotFoundError:
            return _failed(case, self.name, "codex CLI not found on PATH")
        except subprocess.TimeoutExpired:
            return _failed(case, self.name, f"codex timed out after {self.timeout_s}s")
        except (JudgeError, json.JSONDecodeError) as exc:
            return _failed(case, self.name, str(exc))
        finally:
            panel_path.unlink(missing_ok=True)
        return JudgeVerdict(
            dog_id=case.dog_id, subject=data["subject"],
            completeness=data["completeness"], evidence=data["evidence"],
            backend=self.name,
        )


def _last_codex_message(stdout: str) -> str:
    """Pull the final agent message text out of codex --json event lines."""
    texts: list[str] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = event.get("item") or event
        text = item.get("text") or item.get("message") or ""
        if isinstance(text, str) and text:
            texts.append(text)
    if not texts:
        raise JudgeError("no agent message in codex output")
    return texts[-1]


class OpenRouterJudge:
    """Judge via merceka_core LLM over OpenRouter (paid; calibration/gold labels)."""

    name = "openrouter"

    def __init__(self, model: str = "google/gemini-2.5-flash"):
        self.model = model

    def judge(self, case: JudgeCase) -> JudgeVerdict:
        import os

        if not os.environ.get("OPENROUTER_API_KEY"):
            return _failed(case, self.name, "OPENROUTER_API_KEY not configured")
        from merceka_core.llm import LLM

        panel = build_judge_panel(case)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
            panel.save(handle, format="PNG")
            panel_path = Path(handle.name)
        try:
            llm = LLM(model_name=f"openrouter/{self.model}", system_prompt=PROMPT_TEMPLATE)
            response = llm.generate_with_resource(
                "Judge the attached panel.", resource_path=panel_path,
                temperature=0.0, max_tokens=400,
            )
            data = parse_verdict_json(response if isinstance(response, str) else str(response))
        except JudgeError as exc:
            return _failed(case, self.name, str(exc))
        except Exception as exc:  # noqa: BLE001 — provider errors become structured failures
            return _failed(case, self.name, f"{type(exc).__name__}: {exc}")
        finally:
            panel_path.unlink(missing_ok=True)
        return JudgeVerdict(
            dog_id=case.dog_id, subject=data["subject"],
            completeness=data["completeness"], evidence=data["evidence"],
            backend=f"{self.name}:{self.model}",
        )


BACKENDS = {
    "codex": CodexExecJudge,
    "openrouter": OpenRouterJudge,
}


def make_backend(name: str, **kwargs):
    try:
        return BACKENDS[name](**kwargs)
    except KeyError as exc:
        raise JudgeError(f"unknown judge backend {name!r}; known: {sorted(BACKENDS)}") from exc
