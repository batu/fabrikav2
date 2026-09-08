"""Read-only, frozen-input difficulty experiment. No authoring/server imports.

The score is a detector-miss proxy, not measured human difficulty. OpenRouter
is explicit because its response carries metered cost; there is no fallback,
automatic retry, or sequence mutation. Dry-run is entirely offline.
"""

from __future__ import annotations

import base64
import fcntl
import hashlib
import io
import json
import math
import os
import statistics
from contextlib import contextmanager
from pathlib import Path

import httpx
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

VERSION = "difficulty-v1"
SCORE_VERSION = "completion-bottleneck-v2"
SCORE_DEFINITION = "100 × (0.80 × worst miss fraction + 0.15 × hardest-3 mean miss fraction + 0.05 × mean miss fraction)"
DEFAULT_MODEL = "google/gemini-3.8-flash"
ASTRA_MODEL = "openai/gpt-6-astra"
API = "https://openrouter.ai/api/v1"
MAX_ASSET_BYTES = 64 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_PREPARED_BYTES = 128 * 1024 * 1024
PROMPT = (
    "Find every dog visible in this illustrated scene. Return one tight bounding "
    "box per dog, including partially hidden dogs. Do not include other animals "
    "or dog-shaped scenery. Coordinates are [ymin, xmin, ymax, xmax], integers "
    "normalized to 0–1000 relative to the entire supplied image. "
    "Return JSON only, with a dogs array of objects containing box_2d."
)


class DifficultyError(ValueError):
    pass


class Detection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    box_2d: list[int] = Field(min_length=4, max_length=4)

    @field_validator("box_2d")
    @classmethod
    def valid_box(cls, box):
        y0, x0, y1, x1 = box
        if not (0 <= x0 < x1 <= 1000 and 0 <= y0 < y1 <= 1000):
            raise ValueError("box must have positive area and coordinates within 0–1000")
        return box


class Detections(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    dogs: list[Detection] = Field(max_length=300)


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text())


def inside(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise DifficultyError("asset paths must be relative")
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise DifficultyError("asset path escapes its root")
    return path


def checked_asset(root: Path, descriptor: dict) -> tuple[Path, bytes]:
    path = inside(root, descriptor["path"])
    data = bounded_read(path)
    if sha(data) != descriptor["sha256"]:
        raise DifficultyError(f"asset hash changed: {descriptor['path']}")
    return path, data


def bounded_read(path: Path) -> bytes:
    with path.open("rb") as stream:
        data = stream.read(MAX_ASSET_BYTES + 1)
    if len(data) > MAX_ASSET_BYTES:
        raise DifficultyError(f"asset exceeds {MAX_ASSET_BYTES} byte limit: {path.name}")
    return data


def prepare(manifest_path: Path, root: Path, *, model: str, repeats: int, max_edge: int) -> dict:
    if model != ASTRA_MODEL and (not model.startswith("google/gemini-") or "/" in model.removeprefix("google/")):
        raise DifficultyError("use an explicit OpenRouter Gemini model ID or openai/gpt-6-astra")
    if not 1 <= repeats <= 5 or not 256 <= max_edge <= 2048:
        raise DifficultyError("repeats must be 1–5 and max-edge 256–2048")
    manifest = json.loads(bounded_read(manifest_path))
    if not isinstance(manifest, dict):
        raise DifficultyError("manifest must be a JSON object")
    if manifest.get("schemaVersion") != 1 or not 1 <= len(manifest.get("levels", [])) <= 100:
        raise DifficultyError("expected a schemaVersion 1 manifest with 1–100 levels")
    for key in ("catalog", "bundledManifest"):
        if key in manifest:
            checked_asset(root, manifest[key])
    config = {"version": VERSION, "model": model, "repeats": repeats,
              "maxEdge": max_edge, "thinking": "low", "maxTokens": 8192,
              "temperature": None if model == ASTRA_MODEL else 1,
              "prompt": PROMPT, "schema": Detections.model_json_schema(),
              "view": "whole-scene aspect-preserving thumbnail; not a device capture",
              "matching": "greedy one-to-one IoU >= 0.15 against sprite rectangles"}
    levels = []
    ids = set()
    sprite_digests = {}
    prepared_bytes = 0
    for row in manifest["levels"]:
        level_path, raw = checked_asset(root, row["levelJson"])
        level = json.loads(raw)
        level_id = row["levelId"]
        if (not isinstance(level_id, str) or not level_id or level_id in (".", "..")
                or "/" in level_id or "\\" in level_id or level_id in ids or level["id"] != level_id):
            raise DifficultyError("duplicate or mismatched level identity")
        ids.add(level_id)
        # Only exported Find the Dog inputs are accepted, independent of selected game.
        public = (root / "games/find_the_dog/public").resolve()
        if level_path != inside(public, f"levels/{level_id}/level.json"):
            raise DifficultyError("pilot level is not an exported Find the Dog level")
        image_path, image_raw = checked_asset(root, row["colorImage"])
        if image_path != inside(public, level["colorImage"]):
            raise DifficultyError("pilot artwork does not match level.json")
        width, height = level["width"], level["height"]
        if not all(type(v) is int and v > 0 for v in (width, height)) or width * height > MAX_IMAGE_PIXELS:
            raise DifficultyError("invalid scene dimensions")
        dogs = level["dogs"]
        if not 1 <= len(dogs) <= 300 or len({d["id"] for d in dogs}) != len(dogs):
            raise DifficultyError("expected 1–300 uniquely identified dogs")
        targets, sprite_hashes = [], []
        for dog in dogs:
            sprite = dog["sprite"]
            x, y, w, h = (float(sprite[k]) for k in ("x", "y", "width", "height"))
            if not all(math.isfinite(v) for v in (x, y, w, h)) or not (
                w > 0 and h > 0 and x >= 0 and y >= 0 and x + w <= width and y + h <= height
            ):
                raise DifficultyError(f"invalid/out-of-scene sprite rectangle: {level_id}/{dog['id']}")
            sprite_path = inside(public, sprite["image"])
            if sprite_path not in sprite_digests:
                sprite_digests[sprite_path] = sha(bounded_read(sprite_path))
            sprite_hashes.append({"dogId": dog["id"], "path": str(sprite_path.relative_to(root)),
                                  "sha256": sprite_digests[sprite_path]})
            targets.append({"id": dog["id"], "box": [y, x, y + h, x + w]})
        if sha(canonical(sprite_hashes)) != row["spriteSetSha256"]:
            raise DifficultyError(f"sprite set changed: {level_id}")
        with Image.open(io.BytesIO(image_raw)) as source:
            if source.size != (width, height):
                raise DifficultyError(f"artwork dimensions disagree with level.json: {level_id}")
            image = source.convert("RGB")
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, "PNG")
            image_size = list(image.size)
            image.close()
        png = buffer.getvalue()
        prepared_bytes += len(png)
        if prepared_bytes > MAX_PREPARED_BYTES:
            raise DifficultyError("prepared images exceed 128 MiB; use a smaller pilot or max-edge")
        fingerprint = sha(canonical({"input": row, "config": config, "imageSha256": sha(png)}))
        levels.append({"levelId": level_id, "dogCount": len(dogs), "dimensions": [width, height],
                       "imageSize": image_size, "imageSha256": sha(png), "fingerprint": fingerprint,
                       "medianSpriteLinearFraction": statistics.median(
                           math.sqrt((t['box'][2] - t['box'][0]) * (t['box'][3] - t['box'][1]) / (width * height))
                           for t in targets), "targets": targets, "png": png})
    return {"config": config, "manifestSha256": sha(canonical(manifest)), "levels": levels}


def plan_report(prepared: dict) -> dict:
    return {"status": "dry_run", "config": prepared["config"],
            "manifestSha256": prepared["manifestSha256"],
            "plannedCalls": len(prepared["levels"]) * prepared["config"]["repeats"],
            "ranking": None, "paidCalls": 0,
            "levels": [{k: v for k, v in row.items() if k not in ("png", "targets")}
                       for row in prepared["levels"]]}


def match(targets: list[dict], detections: list[Detection], dimensions: list[int]) -> dict:
    width, height = dimensions
    boxes = [[y0 * height / 1000, x0 * width / 1000, y1 * height / 1000, x1 * width / 1000]
             for y0, x0, y1, x1 in (d.box_2d for d in detections)]
    pairs = []
    unique_boxes = {}
    for j, box in enumerate(boxes):
        unique_boxes.setdefault(tuple(box), j)
    for i, target in enumerate(targets):
        a = target["box"]
        for b, j in unique_boxes.items():
            intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
            union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection
            overlap = intersection / union if union else 0
            if overlap >= 0.15:
                pairs.append((-overlap, i, j))
    # Same nearest/best-first one-to-one policy as eval/score.py; boxes use
    # IoU instead of generous tap radii to reject whole-scene guesses.
    used_targets, used_detections = set(), set()
    for _, i, j in sorted(pairs):
        if i not in used_targets and j not in used_detections:
            used_targets.add(i)
            used_detections.add(j)
    return {"foundIds": [t["id"] for i, t in enumerate(targets) if i in used_targets],
            "recall": len(used_targets) / len(targets),
            "precision": len(used_detections) / len(boxes) if boxes else None,
            "falsePositives": len(boxes) - len(used_detections)}


def rank(prepared: dict, responses: dict) -> list[dict]:
    ranked = []
    repeats = prepared["config"]["repeats"]
    for level in prepared["levels"]:
        trials = [match(level["targets"], Detections.model_validate(responses[f"{level['fingerprint']}-{i}"]).dogs,
                        level["dimensions"]) for i in range(repeats)]
        dogs = [{"id": t["id"], "foundIn": sum(t["id"] in trial["foundIds"] for trial in trials),
                 "trials": repeats} for t in level["targets"]]
        misses = sorted((1 - dog["foundIn"] / repeats for dog in dogs), reverse=True)
        mean_miss = statistics.mean(misses)
        tail_miss = statistics.mean(misses[:max(1, math.ceil(len(misses) * 0.2))])
        worst_miss = misses[0]
        top_three_miss = statistics.mean(misses[:3])
        warnings = ["uncalibrated detector proxy; sprite rectangles are approximate ground truth"]
        if max(misses) == 0:
            warnings.append("detection saturated: this does not establish human ease")
        if min(misses) == 1:
            warnings.append("no targets matched: inspect detection/matching before interpreting difficulty")
        elif worst_miss == 1:
            warnings.append("unresolved bottleneck: at least one dog was never matched; inspect before comparing saturated hardest dogs")
        if any(0 < dog["foundIn"] < repeats for dog in dogs):
            warnings.append("repeat disagreement: ranking is uncertain")
        if any(t["precision"] is not None and t["precision"] < 0.8 for t in trials):
            warnings.append("low precision: inspect matching and false detections")
        ranked.append({"levelId": level["levelId"], "score": round(100 * (0.8 * worst_miss + 0.15 * top_three_miss + 0.05 * mean_miss), 4),
                       "worstDogMissFraction": worst_miss, "hardest3MissFraction": top_three_miss,
                       "bottleneckDogIds": [dog["id"] for dog in dogs if 1 - dog["foundIn"] / repeats == worst_miss],
                       "neverMatchedDogIds": [dog["id"] for dog in dogs if dog["foundIn"] == 0],
                       "meanMissFraction": mean_miss, "hardest20PercentMissFraction": tail_miss,
                       "dogCount": level["dogCount"], "medianSpriteLinearFraction": level["medianSpriteLinearFraction"],
                       "dogs": dogs, "trials": trials, "warnings": warnings})
    # Stable display ordering only; equal scores do not establish relative difficulty.
    return sorted(ranked, key=lambda r: (r["score"], r["levelId"]))


def model_preflight(client: httpx.Client, config: dict) -> dict:
    response = client.get(f"{API}/models")
    if response.status_code != 200:
        raise DifficultyError(f"model catalog HTTP {response.status_code}")
    models = response.json().get("data", [])
    model = next((m for m in models if m.get("id") == config["model"]), None)
    if not model or "image" not in model.get("architecture", {}).get("input_modalities", []):
        raise DifficultyError("exact image-capable model unavailable; no fallback")
    required = {"structured_outputs", "response_format", "max_tokens", "reasoning"}
    if config["temperature"] is not None:
        required.add("temperature")
    if not required.issubset(model.get("supported_parameters", [])):
        raise DifficultyError("model does not support required request controls")
    if config["thinking"] not in model.get("reasoning", {}).get("supported_efforts", []):
        raise DifficultyError("model does not support the fixed thinking effort")
    pricing = model["pricing"]
    tiers = [pricing, *pricing.get("overrides", [])]
    # Astra has long-context tiers. Reserve at the highest published rate,
    # including cache writes, even though our actual image request is small.
    rates = {k: max(float(t.get(k, 0)) for t in tiers)
             for k in ("prompt", "completion", "image", "internal_reasoning", "request", "input_cache_write")}
    if any(not math.isfinite(float(t.get(k, 0))) or float(t.get(k, 0)) < 0
           for t in tiers for k in rates):
        raise DifficultyError("invalid tiered model pricing")
    if not all(math.isfinite(v) and v >= 0 for v in rates.values()) or not all(k in pricing for k in ("prompt", "completion")):
        raise DifficultyError("missing/invalid model pricing")
    context = model["context_length"]
    if type(context) is not int or context <= 0:
        raise DifficultyError("missing model context bound")
    # Deliberately reserve the entire model context, plus maximum output, not
    # a guessed image token count. Reserve is NOT reported as actual spend.
    reserve = context * (max(rates["prompt"], rates["input_cache_write"]) + rates["image"]) + config["maxTokens"] * (
        rates["completion"] + rates["internal_reasoning"]) + rates["request"]
    if not math.isfinite(reserve):
        raise DifficultyError("invalid price reservation")
    return {"model": config["model"], "pricing": pricing, "priceCaps": rates, "contextLength": context,
            "perCallReserveUsd": reserve, "accountAccessVerified": False}


def request_payload(config: dict, level: dict, pricing: dict) -> dict:
    return {"model": config["model"], "messages": [{"role": "user", "content": [
        {"type": "text", "text": config["prompt"]},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(level["png"]).decode()}},
    ]}], "max_tokens": config["maxTokens"],
            **({"temperature": config["temperature"]} if config["temperature"] is not None else {}),
            "reasoning": {"effort": config["thinking"]},
            "provider": {"require_parameters": True, "allow_fallbacks": False,
                         "max_price": {"prompt": float(pricing["prompt"]) * 1e6,
                                       "completion": float(pricing["completion"]) * 1e6,
                                       "image": float(pricing.get("image", 0)),
                                       "request": float(pricing.get("request", 0))}},
            "response_format": {"type": "json_schema", "json_schema": {
                "name": "dog_detections", "strict": True, "schema": config["schema"]}}}


def write_json(path: Path, value) -> None:
    if path.is_symlink():
        raise DifficultyError("refusing to write through an output symlink")
    temp = path.with_suffix(".tmp")
    # Exclusive creation also refuses a pre-existing or symlinked temp file.
    with temp.open("x") as stream:
        stream.write(json.dumps(value, indent=2, allow_nan=False) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


@contextmanager
def output_lock(out: Path, root: Path):
    out = out.resolve()
    if out == root or out.is_relative_to((root / "games").resolve()):
        raise DifficultyError("output must be outside game/authoring data")
    out.mkdir(parents=True, exist_ok=True)
    marker = out / "difficulty-owner.json"
    if not marker.exists():
        if any(out.iterdir()):
            raise DifficultyError("output directory is nonempty and not owned by difficulty scorer")
        with marker.open("x") as stream:
            json.dump({"version": VERSION}, stream)
    if marker.is_symlink() or read_json(marker) != {"version": VERSION}:
        raise DifficultyError("invalid output ownership marker")
    lock_path = out / "difficulty.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise DifficultyError("another scorer is using this output directory") from error
        yield out


def validated_cache(state: dict, identity: str, expected: set[str]) -> dict:
    if not isinstance(state, dict) or state.get("identity") != identity:
        raise DifficultyError("output belongs to different inputs/settings; use a new empty directory")
    calls = state.get("calls")
    if not isinstance(calls, dict) or not set(calls).issubset(expected):
        raise DifficultyError("cache contains unexpected call identities")
    for call in calls.values():
        if not isinstance(call, dict) or call.get("status") != "complete":
            raise DifficultyError("previous call has unresolved cost/output; reconcile it before further spending")
        cost = call.get("costUsd")
        if type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0:
            raise DifficultyError("cache contains invalid metered cost")
        try:
            Detections.model_validate(call.get("detections"))
        except ValidationError as error:
            raise DifficultyError("cache contains invalid detections") from error
    return calls


def execute(prepared: dict, root: Path, out: Path, budget_usd: float, *, client=None) -> dict:
    if not math.isfinite(budget_usd) or budget_usd <= 0:
        raise DifficultyError("--execute requires a positive finite --budget-usd")
    if client is None:
        with httpx.Client(timeout=180) as network:
            return execute(prepared, root, out, budget_usd, client=network)
    with output_lock(out, root) as out:
        state_path = out / "state.json"
        if state_path.is_symlink():
            raise DifficultyError("refusing a symlinked cache state")
        identity = sha(canonical({"manifest": prepared["manifestSha256"], "config": prepared["config"]}))
        state = read_json(state_path) if state_path.exists() else {"identity": identity, "calls": {}}
        expected = {f"{level['fingerprint']}-{i}" for level in prepared["levels"]
                    for i in range(prepared["config"]["repeats"])}
        calls = validated_cache(state, identity, expected)
        spent = sum(c["costUsd"] for c in calls.values())
        if not math.isfinite(spent) or spent > budget_usd:
            raise DifficultyError("existing metered cost exceeds the supplied budget")
        responses = {k: c["detections"] for k, c in calls.items()}
        if expected - responses.keys():
            key = os.environ.get("OPENROUTER_API_KEY")
            if not key:
                raise DifficultyError("OPENROUTER_API_KEY is required; no provider fallback")
            preflight = model_preflight(client, prepared["config"])
            write_json(out / "preflight.json", preflight)
        new_calls = 0
        for level in prepared["levels"]:
            payload = None
            for trial in range(prepared["config"]["repeats"]):
                cache_key = f"{level['fingerprint']}-{trial}"
                if cache_key in responses:
                    continue
                reserve = preflight["perCallReserveUsd"]
                if spent + reserve > budget_usd:
                    raise DifficultyError(f"budget would be exceeded: metered ${spent:.6f}, next-call reserve ${reserve:.6f}")
                state["calls"][cache_key] = {"status": "pending", "reservedUsd": reserve}
                write_json(state_path, state)  # Crash/timeout cannot silently replay a paid call.
                if payload is None:
                    payload = request_payload(prepared["config"], level, preflight["priceCaps"])
                response = client.post(f"{API}/chat/completions",
                                       headers={"Authorization": f"Bearer {key}"},
                                       json=payload)
                if response.status_code != 200:
                    raise DifficultyError(f"provider HTTP {response.status_code}; request not retried; inspect output state")
                body = response.json()
                write_json(out / f"response-{cache_key}.json", body)
                usage = body.get("usage") or {}
                cost = usage.get("cost")
                from merceka_core import costs

                costs.record(source="openrouter", model=prepared["config"]["model"], usage=usage,
                             usd=cost if isinstance(cost, (float, int)) else None,
                             meta={"operation": VERSION, "levelId": level["levelId"], "trial": trial,
                                   "fingerprint": level["fingerprint"]})
                if type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0:
                    raise DifficultyError("provider returned no valid metered cost; stopping")
                state["calls"][cache_key].update({"costUsd": cost, "responseId": body.get("id")})
                write_json(state_path, state)
                if cost > reserve:
                    raise DifficultyError("provider cost exceeded conservative reservation; stopping for reconciliation")
                if body.get("model") != prepared["config"]["model"]:
                    raise DifficultyError("provider returned a different model; stopping")
                choice = body["choices"][0]
                if choice.get("finish_reason") != "stop":
                    raise DifficultyError("provider response incomplete/refused; stopping without scoring it")
                try:
                    detections = Detections.model_validate_json(choice["message"]["content"]).model_dump()
                except ValidationError as error:
                    raise DifficultyError("provider detections violate schema; raw response saved, no retry") from error
                responses[cache_key] = detections
                state["calls"][cache_key].update({"status": "complete", "detections": detections})
                write_json(state_path, state)
                spent += cost
                new_calls += 1
        report = {**plan_report(prepared), "status": "scored", "paidCalls": new_calls,
                  "meteredTotalUsd": spent, "ranking": rank(prepared, responses),
                  "scoreVersion": SCORE_VERSION, "scoreDefinition": SCORE_DEFINITION,
                  "tieBreakers": ["levelId (display only; equal scores remain tied)"],
                  "humanCalibration": "pending", "sequenceChanged": False}
        write_json(out / "report.json", report)
        return report
