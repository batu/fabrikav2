#!/usr/bin/env python3
"""Fixed Find the Bird cutout benchmark, Portal sheets, and Codex pre-filter.

This is deliberately a standalone tool. It reads authoring assets but never
writes to them. Candidate methods write into their own roots using the stable
``<levelId>/<dogDir>.png`` layout declared by the manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import textwrap
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from levelbuilder.api.sprite_judge import (
    SUBJECT_RULE,
    JudgeCase,
    make_backend,
)

HERE = Path(__file__).resolve().parent
DEFAULT_MANIFEST = HERE / "benchmark-manifest.json"
SCHEMA_VERSION = 1
CREAM = (255, 248, 232)
INK = (48, 43, 37)
MUTED = (111, 100, 87)
SHEET_BG = (39, 37, 34)
CARD_BG = (246, 239, 224)
ERROR_BG = (116, 42, 42)

LABEL_WIDTH = 520
CELL_WIDTH = 420
ROW_HEIGHT = 330
HEADER_HEIGHT = 88


class ManifestError(RuntimeError):
    """The fixed benchmark or a candidate method violates its contract."""


@dataclass(frozen=True)
class ResolvedCase:
    case: dict[str, Any]
    level_dir: Path
    background_path: Path
    painted_path: Path
    prior_sprite_path: Path
    dog: dict[str, Any]
    hitbox: dict[str, Any]
    source_box: tuple[int, int, int, int]


@dataclass(frozen=True)
class MethodSpec:
    name: str
    root: Path
    template: str = "{candidatePath}"


def _json_dump(data: Any) -> str:
    return json.dumps(data, indent=2, sort_keys=False) + "\n"


def _atomic_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(_json_dump(data))
    temporary.replace(path)


def _manifest_hash(manifest: dict[str, Any]) -> str:
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def _safe_child(root: Path, relative: str, *, label: str) -> Path:
    relpath = Path(relative)
    if relpath.is_absolute():
        raise ManifestError(f"{label} must be relative to its root: {relative!r}")
    root_resolved = root.expanduser().resolve()
    candidate = (root_resolved / relpath).resolve()
    if candidate == root_resolved or not candidate.is_relative_to(root_resolved):
        raise ManifestError(f"{label} escapes root {root_resolved}: {relative!r}")
    return candidate


def _required(mapping: dict[str, Any], keys: tuple[str, ...], *, label: str) -> None:
    missing = [key for key in keys if key not in mapping]
    if missing:
        raise ManifestError(f"{label} missing required fields: {', '.join(missing)}")


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"cannot read manifest {path}: {exc}") from exc
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise ManifestError(
            f"unsupported manifest schemaVersion {manifest.get('schemaVersion')!r}; "
            f"expected {SCHEMA_VERSION}"
        )
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ManifestError("manifest cases must be a non-empty list")
    required = (
        "caseId",
        "levelId",
        "dogDir",
        "birdId",
        "activeVariant",
        "hitbox",
        "sourceSize",
        "sourceBox",
        "paintedCrop",
        "variantBox",
        "priorSprite",
        "candidatePath",
        "tags",
        "note",
    )
    seen: set[str] = set()
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            raise ManifestError(f"case {index} must be an object")
        _required(case, required, label=f"case {index}")
        case_id = case["caseId"]
        if not isinstance(case_id, str) or not case_id:
            raise ManifestError(f"case {index} has invalid caseId")
        if case_id in seen:
            raise ManifestError(f"duplicate caseId: {case_id}")
        seen.add(case_id)
        if not isinstance(case["tags"], list) or not case["tags"]:
            raise ManifestError(f"{case_id}: tags must be a non-empty list")
    return manifest


def _read_json(path: Path, *, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"cannot read {label} {path}: {exc}") from exc


def resolve_case(case: dict[str, Any], source_root: Path) -> ResolvedCase:
    """Resolve one case and enforce the dog-to-hitbox stable-id join."""
    case_id = str(case["caseId"])
    level_dir = _safe_child(source_root, str(case["levelId"]), label=f"{case_id} levelId")
    session = _read_json(level_dir / "session.json", label=f"{case_id} session")
    hitboxes = _read_json(level_dir / "hitboxes.json", label=f"{case_id} hitboxes")

    dogs = session.get("dogs") or []
    dog_matches = [dog for dog in dogs if dog.get("id") == case["birdId"]]
    if len(dog_matches) != 1:
        raise ManifestError(
            f"{case_id}: expected one session dog with id {case['birdId']!r}, "
            f"found {len(dog_matches)}"
        )
    dog = dog_matches[0]
    try:
        expected_dog_dir = f"dog_{int(dog['index']):02d}"
        active_variant = int(dog["activeVariant"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ManifestError(f"{case_id}: malformed session dog: {dog!r}") from exc
    if expected_dog_dir != case["dogDir"]:
        raise ManifestError(
            f"{case_id}: dogDir {case['dogDir']!r} does not match stable dog index "
            f"{dog['index']!r} ({expected_dog_dir})"
        )
    if active_variant != case["activeVariant"]:
        raise ManifestError(
            f"{case_id}: active variant drifted from {case['activeVariant']} to {active_variant}"
        )

    hitbox_matches = [hitbox for hitbox in hitboxes if hitbox.get("id") == case["birdId"]]
    if len(hitbox_matches) != 1:
        raise ManifestError(
            f"{case_id}: expected one hitbox joined by id {case['birdId']!r}, "
            f"found {len(hitbox_matches)}"
        )
    hitbox = hitbox_matches[0]
    actual_hitbox = {key: hitbox.get(key) for key in ("x", "y", "r")}
    if actual_hitbox != case["hitbox"]:
        raise ManifestError(
            f"{case_id}: hitbox drift: manifest={case['hitbox']!r} source={actual_hitbox!r}"
        )

    source_box_raw = case["sourceBox"]
    if (
        not isinstance(source_box_raw, list)
        or len(source_box_raw) != 4
        or not all(isinstance(value, int) for value in source_box_raw)
    ):
        raise ManifestError(f"{case_id}: sourceBox must contain four integers")
    source_box = tuple(source_box_raw)
    x0, y0, x1, y1 = source_box
    if x0 < 0 or y0 < 0 or x1 <= x0 or y1 <= y0:
        raise ManifestError(f"{case_id}: invalid sourceBox {source_box}")

    variant_box_path = _safe_child(
        source_root, str(case["variantBox"]), label=f"{case_id} variantBox"
    )
    variant_box = _read_json(variant_box_path, label=f"{case_id} variant box").get("box")
    if variant_box != source_box_raw:
        raise ManifestError(
            f"{case_id}: source box drift: manifest={source_box_raw!r} source={variant_box!r}"
        )

    background_path = level_dir / "bg_00.png"
    painted_path = _safe_child(
        source_root, str(case["paintedCrop"]), label=f"{case_id} paintedCrop"
    )
    prior_sprite_path = _safe_child(
        source_root, str(case["priorSprite"]), label=f"{case_id} priorSprite"
    )
    for label, path in (
        ("background", background_path),
        ("painted crop", painted_path),
        ("prior sprite", prior_sprite_path),
    ):
        if not path.is_file():
            raise ManifestError(f"{case_id}: missing {label}: {path}")

    with Image.open(background_path) as background:
        background_size = list(background.size)
    if background_size != case["sourceSize"]:
        raise ManifestError(
            f"{case_id}: source size drift: manifest={case['sourceSize']!r} "
            f"source={background_size!r}"
        )
    session_size = [session.get("bg_width"), session.get("bg_height")]
    if session_size != case["sourceSize"]:
        raise ManifestError(
            f"{case_id}: session size drift: manifest={case['sourceSize']!r} "
            f"session={session_size!r}"
        )
    if x1 > background_size[0] or y1 > background_size[1]:
        raise ManifestError(f"{case_id}: sourceBox exceeds background bounds")
    with Image.open(painted_path) as painted:
        expected_crop_size = (x1 - x0, y1 - y0)
        if painted.size != expected_crop_size:
            raise ManifestError(
                f"{case_id}: painted crop size {painted.size} != box size {expected_crop_size}"
            )

    return ResolvedCase(
        case=case,
        level_dir=level_dir,
        background_path=background_path,
        painted_path=painted_path,
        prior_sprite_path=prior_sprite_path,
        dog=dog,
        hitbox=hitbox,
        source_box=source_box,
    )


def resolve_manifest(manifest: dict[str, Any], source_root: Path) -> list[ResolvedCase]:
    return [resolve_case(case, source_root) for case in manifest["cases"]]


def parse_method_spec(raw: str) -> MethodSpec:
    """Parse NAME=ROOT[::TEMPLATE]; default template is candidatePath."""
    if "=" not in raw:
        raise ManifestError("method must be NAME=ROOT or NAME=ROOT::TEMPLATE")
    name, remainder = raw.split("=", 1)
    name = name.strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise ManifestError(f"invalid method name: {name!r}")
    if "::" in remainder:
        root_raw, template = remainder.split("::", 1)
    else:
        root_raw, template = remainder, "{candidatePath}"
    if not root_raw.strip() or not template.strip():
        raise ManifestError(f"method {name!r} needs a root and a non-empty template")
    return MethodSpec(name=name, root=Path(root_raw).expanduser(), template=template)


def format_method_path(method: MethodSpec, case: dict[str, Any]) -> Path:
    try:
        relative = method.template.format_map(case)
    except (KeyError, ValueError) as exc:
        raise ManifestError(
            f"method {method.name!r} template cannot format {case.get('caseId')}: {exc}"
        ) from exc
    return _safe_child(method.root, relative, label=f"method {method.name!r} output")


def _font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    names = (
        "/System/Library/Fonts/SFNS.ttf" if not bold else "/System/Library/Fonts/SFNS-Bold.ttf",
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
    )
    for name in names:
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _open_context(resolved: ResolvedCase) -> tuple[Image.Image, Image.Image]:
    with Image.open(resolved.background_path) as background:
        clean = background.convert("RGB").crop(resolved.source_box).copy()
    with Image.open(resolved.painted_path) as painted_file:
        painted = painted_file.convert("RGB").copy()
    return clean, painted


def _contain(
    image: Image.Image,
    size: tuple[int, int],
    background: tuple[int, int, int],
    *,
    max_scale: float | None = None,
) -> tuple[Image.Image, float]:
    source = image.convert("RGBA")
    scale = min(size[0] / source.width, size[1] / source.height)
    if max_scale is not None:
        scale = min(scale, max_scale)
    scale = max(scale, 0.01)
    resized = source.resize(
        (max(1, round(source.width * scale)), max(1, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGB", size, background)
    offset = ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2)
    canvas.paste(resized, offset, resized)
    return canvas, scale


def _draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    *,
    width: int,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int],
    line_height: int,
) -> int:
    estimated_chars = max(10, int(width / max(7, getattr(font, "size", 14) * 0.55)))
    lines: list[str] = []
    for paragraph in text.splitlines() or [""]:
        lines.extend(textwrap.wrap(paragraph, width=estimated_chars) or [""])
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def _candidate_status(path: Path) -> dict[str, Any]:
    status: dict[str, Any] = {
        "path": str(path),
        "exists": path.is_file(),
        "hasAlpha": False,
        "hasTransparentPixels": False,
    }
    if not status["exists"]:
        status["error"] = "missing candidate PNG"
        return status
    try:
        with Image.open(path) as image:
            bands = image.getbands()
            has_alpha = "A" in bands
            status.update({
                "format": image.format,
                "mode": image.mode,
                "size": list(image.size),
                "hasAlpha": has_alpha,
            })
            if has_alpha:
                alpha_min, alpha_max = image.getchannel("A").getextrema()
                status["hasTransparentPixels"] = alpha_min < 255
                status["alphaRange"] = [alpha_min, alpha_max]
    except (OSError, ValueError) as exc:
        status["error"] = f"invalid image: {exc}"
    return status


def _draw_source_cell(canvas: Image.Image, image: Image.Image, x: int, y: int) -> None:
    preview, _ = _contain(image, (CELL_WIDTH - 24, ROW_HEIGHT - 24), (230, 222, 207))
    canvas.paste(preview, (x + 12, y + 12))


def _draw_candidate_cell(
    canvas: Image.Image,
    path: Path,
    status: dict[str, Any],
    x: int,
    y: int,
) -> None:
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (x + 10, y + 10, x + CELL_WIDTH - 10, y + ROW_HEIGHT - 10),
        radius=12,
        fill=CREAM if status.get("exists") and not status.get("error") else ERROR_BG,
    )
    if status.get("exists") and not status.get("error"):
        with Image.open(path) as source:
            preview, scale = _contain(
                source,
                (CELL_WIDTH - 36, ROW_HEIGHT - 72),
                CREAM,
                max_scale=2.0,
            )
        canvas.paste(preview, (x + 18, y + 18))
        draw.text(
            (x + 20, y + ROW_HEIGHT - 43),
            f"cream preview · {scale:.2f}× · {status.get('size', ['?', '?'])[0]}×"
            f"{status.get('size', ['?', '?'])[1]} px",
            font=_font(17),
            fill=MUTED,
        )
        if not status.get("hasAlpha"):
            draw.text(
                (x + CELL_WIDTH - 122, y + ROW_HEIGHT - 43),
                "NO ALPHA",
                font=_font(17, bold=True),
                fill=(174, 44, 35),
            )
    else:
        message = str(status.get("error") or "missing candidate")
        _draw_wrapped(
            draw,
            message,
            (x + 30, y + 110),
            width=CELL_WIDTH - 60,
            font=_font(20, bold=True),
            fill=(255, 236, 225),
            line_height=27,
        )


def render_sheets(
    manifest: dict[str, Any],
    source_root: Path,
    methods: list[MethodSpec],
    out_dir: Path,
    *,
    rows_per_page: int = 4,
) -> dict[str, Any]:
    """Render clean/painted/method columns into legible Portal PNG pages."""
    if rows_per_page < 1:
        raise ManifestError("rows_per_page must be at least 1")
    if not methods:
        raise ManifestError("at least one --method is required")
    method_names = [method.name for method in methods]
    if len(method_names) != len(set(method_names)):
        raise ManifestError("method names must be unique")

    resolved_cases = resolve_manifest(manifest, source_root)
    out_dir.mkdir(parents=True, exist_ok=True)
    page_count = (len(resolved_cases) + rows_per_page - 1) // rows_per_page
    sheet_width = LABEL_WIDTH + CELL_WIDTH * (2 + len(methods))
    sheet_height = HEADER_HEIGHT + ROW_HEIGHT * rows_per_page
    pages: list[str] = []
    case_records: list[dict[str, Any]] = []

    statuses: dict[tuple[str, str], tuple[Path, dict[str, Any]]] = {}
    for resolved in resolved_cases:
        for method in methods:
            path = format_method_path(method, resolved.case)
            statuses[(resolved.case["caseId"], method.name)] = (path, _candidate_status(path))

    for page_index in range(page_count):
        canvas = Image.new("RGB", (sheet_width, sheet_height), SHEET_BG)
        draw = ImageDraw.Draw(canvas)
        draw.text(
            (22, 16),
            f"Find the Bird cutout benchmark · page {page_index + 1}/{page_count}",
            font=_font(25, bold=True),
            fill=(255, 250, 240),
        )
        draw.text(
            (22, 49),
            "Cream #fff8e8 · candidate preview up to 2×",
            font=_font(16),
            fill=(199, 190, 175),
        )
        columns = ["CLEAN", "PAINTED", *[method.name for method in methods]]
        for column_index, label in enumerate(columns):
            x = LABEL_WIDTH + column_index * CELL_WIDTH
            draw.text(
                (x + 14, 48),
                label,
                font=_font(18, bold=True),
                fill=(255, 240, 200),
            )

        page_cases = resolved_cases[
            page_index * rows_per_page:(page_index + 1) * rows_per_page
        ]
        for row_index, resolved in enumerate(page_cases):
            case = resolved.case
            global_index = page_index * rows_per_page + row_index
            y = HEADER_HEIGHT + row_index * ROW_HEIGHT
            row_fill = CARD_BG if global_index % 2 == 0 else (237, 229, 212)
            draw.rectangle((0, y, sheet_width, y + ROW_HEIGHT - 2), fill=row_fill)
            label_draw = ImageDraw.Draw(canvas)
            label_draw.text(
                (20, y + 18),
                f"{global_index + 1:02d} · {case['dogDir']}",
                font=_font(22, bold=True),
                fill=INK,
            )
            label_y = _draw_wrapped(
                label_draw,
                case["levelId"],
                (20, y + 52),
                width=LABEL_WIDTH - 40,
                font=_font(16, bold=True),
                fill=INK,
                line_height=21,
            )
            source_w, source_h = case["sourceSize"]
            label_draw.text(
                (20, label_y + 5),
                f"r={case['hitbox']['r']} · {source_w}×{source_h} · "
                f"variant {case['activeVariant']}",
                font=_font(16),
                fill=MUTED,
            )
            label_y = _draw_wrapped(
                label_draw,
                " · ".join(case["tags"]),
                (20, label_y + 34),
                width=LABEL_WIDTH - 40,
                font=_font(15, bold=True),
                fill=(137, 78, 32),
                line_height=20,
            )
            _draw_wrapped(
                label_draw,
                case["note"],
                (20, label_y + 8),
                width=LABEL_WIDTH - 40,
                font=_font(15),
                fill=MUTED,
                line_height=20,
            )

            clean, painted = _open_context(resolved)
            _draw_source_cell(canvas, clean, LABEL_WIDTH, y)
            _draw_source_cell(canvas, painted, LABEL_WIDTH + CELL_WIDTH, y)

            method_records: dict[str, Any] = {}
            for method_index, method in enumerate(methods):
                path, status = statuses[(case["caseId"], method.name)]
                x = LABEL_WIDTH + CELL_WIDTH * (2 + method_index)
                _draw_candidate_cell(canvas, path, status, x, y)
                method_records[method.name] = status
            case_records.append({
                "caseId": case["caseId"],
                "methods": method_records,
            })

        page_name = f"sheet-{page_index + 1:02d}.png"
        canvas.save(out_dir / page_name, format="PNG", optimize=True)
        pages.append(page_name)

    summary = {
        "schemaVersion": SCHEMA_VERSION,
        "manifestHash": _manifest_hash(manifest),
        "humanAcceptanceRequired": True,
        "cream": "#fff8e8",
        "methods": [
            {"name": method.name, "root": str(method.root.resolve()), "template": method.template}
            for method in methods
        ],
        "pages": pages,
        "cases": case_records,
    }
    _atomic_json(out_dir / "render.json", summary)
    return summary


def run_prefilter(
    manifest: dict[str, Any],
    source_root: Path,
    method: MethodSpec,
    backend: Any,
    output_path: Path,
    *,
    subject_threshold: float = 0.8,
    completeness_threshold: float = 0.8,
    case_ids: set[str] | None = None,
    limit: int | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Run the shared semantic judge as a resumable non-authoritative gate."""
    for name, threshold in (
        ("subject", subject_threshold),
        ("completeness", completeness_threshold),
    ):
        if not 0.0 <= threshold <= 1.0:
            raise ManifestError(f"{name} threshold must be between 0 and 1")

    resolved_cases = resolve_manifest(manifest, source_root)
    if case_ids:
        known = {resolved.case["caseId"] for resolved in resolved_cases}
        unknown = case_ids - known
        if unknown:
            raise ManifestError(f"unknown case ids: {', '.join(sorted(unknown))}")
        resolved_cases = [
            resolved for resolved in resolved_cases if resolved.case["caseId"] in case_ids
        ]
    if limit is not None:
        if limit < 1:
            raise ManifestError("limit must be at least 1")
        resolved_cases = resolved_cases[:limit]

    base_report = {
        "schemaVersion": SCHEMA_VERSION,
        "manifestHash": _manifest_hash(manifest),
        "method": {
            "name": method.name,
            "root": str(method.root.resolve()),
            "template": method.template,
        },
        "backend": getattr(backend, "name", type(backend).__name__),
        "subjectRule": SUBJECT_RULE,
        "thresholds": {
            "subject": subject_threshold,
            "completeness": completeness_threshold,
        },
        "humanAcceptanceRequired": True,
        "results": {},
    }
    if output_path.exists() and not force:
        existing = _read_json(output_path, label="prefilter results")
        for key in ("manifestHash", "method", "subjectRule", "thresholds"):
            if existing.get(key) != base_report[key]:
                raise ManifestError(
                    f"cannot resume {output_path}: {key} differs; use --force or a new output path"
                )
        base_report["results"] = existing.get("results") or {}
    report = base_report

    for index, resolved in enumerate(resolved_cases, start=1):
        case = resolved.case
        case_id = case["caseId"]
        existing = report["results"].get(case_id)
        if existing and existing.get("ok") and not force:
            continue
        candidate_path = format_method_path(method, case)
        status = _candidate_status(candidate_path)
        if not status.get("exists") or status.get("error"):
            record = {
                "schemaVersion": SCHEMA_VERSION,
                "dogId": case_id,
                "subject": 0.0,
                "completeness": 0.0,
                "evidence": "",
                "backend": getattr(backend, "name", type(backend).__name__),
                "ok": False,
                "error": status.get("error") or "missing candidate PNG",
                "candidatePath": str(candidate_path),
                "prefilterPass": False,
            }
        else:
            clean, painted = _open_context(resolved)
            with Image.open(candidate_path) as sprite_file:
                sprite = sprite_file.convert("RGBA").copy()
            verdict = backend.judge(
                JudgeCase(
                    dog_id=case_id,
                    sprite=sprite,
                    painted_crop=painted,
                    clean_crop=clean,
                )
            )
            record = verdict.to_dict()
            record["candidatePath"] = str(candidate_path)
            record["prefilterPass"] = bool(
                verdict.ok
                and verdict.subject >= subject_threshold
                and verdict.completeness >= completeness_threshold
            )
        report["results"][case_id] = record
        _refresh_prefilter_summary(report)
        _atomic_json(output_path, report)
        print(
            f"[{index}/{len(resolved_cases)}] {case_id}: "
            f"ok={record['ok']} pass={record['prefilterPass']} "
            f"subject={record['subject']} completeness={record['completeness']}",
            flush=True,
        )

    _refresh_prefilter_summary(report)
    _atomic_json(output_path, report)
    return report


def _refresh_prefilter_summary(report: dict[str, Any]) -> None:
    results = list(report["results"].values())
    report["summary"] = {
        "judged": len(results),
        "pass": sum(1 for result in results if result.get("prefilterPass")),
        "reject": sum(
            1 for result in results if result.get("ok") and not result.get("prefilterPass")
        ),
        "error": sum(1 for result in results if not result.get("ok")),
    }


def _source_root(args: argparse.Namespace, manifest: dict[str, Any]) -> Path:
    value = args.source_root or manifest.get("sourceRoot")
    if not value:
        raise ManifestError("source root missing; pass --source-root")
    return Path(value).expanduser()


def _cmd_validate(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    source_root = _source_root(args, manifest)
    resolved = resolve_manifest(manifest, source_root)
    tags = Counter(tag for case in manifest["cases"] for tag in case["tags"])
    radii = [case["hitbox"]["r"] for case in manifest["cases"]]
    sizes = Counter("x".join(map(str, case["sourceSize"])) for case in manifest["cases"])
    print(f"valid: {len(resolved)} cases across {len({r.case['levelId'] for r in resolved})} levels")
    print(f"radii: {min(radii)}..{max(radii)}")
    print("source sizes: " + ", ".join(f"{key}={value}" for key, value in sorted(sizes.items())))
    print("tags: " + ", ".join(f"{key}={value}" for key, value in sorted(tags.items())))
    return 0


def _cmd_render(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    summary = render_sheets(
        manifest,
        _source_root(args, manifest),
        [parse_method_spec(raw) for raw in args.method],
        args.out,
        rows_per_page=args.rows_per_page,
    )
    print(f"rendered {len(summary['pages'])} Portal sheet(s) -> {args.out}")
    for page in summary["pages"]:
        print(args.out / page)
    return 0


def _cmd_judge(args: argparse.Namespace, manifest: dict[str, Any]) -> int:
    kwargs = {"model": args.model} if args.model else {}
    backend = make_backend("codex", **kwargs)
    report = run_prefilter(
        manifest,
        _source_root(args, manifest),
        parse_method_spec(args.method),
        backend,
        args.out,
        subject_threshold=args.subject_threshold,
        completeness_threshold=args.completeness_threshold,
        case_ids=set(args.case) if args.case else None,
        limit=args.limit,
        force=args.force,
    )
    summary = report["summary"]
    print(
        f"prefilter: {summary['pass']} pass, {summary['reject']} reject, "
        f"{summary['error']} error -> {args.out}"
    )
    print("Batu's Portal verdict remains the only acceptance authority.")
    return 0 if summary["error"] == 0 else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--source-root", type=Path)
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="validate manifest and live source joins")
    validate.set_defaults(handler=_cmd_validate)

    render = subparsers.add_parser("render", help="render Portal-ready comparison sheets")
    render.add_argument(
        "--method",
        action="append",
        required=True,
        help="NAME=ROOT[::TEMPLATE]; repeat for side-by-side methods",
    )
    render.add_argument("--out", type=Path, required=True)
    render.add_argument("--rows-per-page", type=int, default=4)
    render.set_defaults(handler=_cmd_render)

    judge = subparsers.add_parser("judge", help="run resumable Codex semantic pre-filter")
    judge.add_argument("--method", required=True, help="NAME=ROOT[::TEMPLATE]")
    judge.add_argument("--out", type=Path, required=True)
    judge.add_argument("--model")
    judge.add_argument("--subject-threshold", type=float, default=0.8)
    judge.add_argument("--completeness-threshold", type=float, default=0.8)
    judge.add_argument("--case", action="append", help="only judge this caseId; repeatable")
    judge.add_argument("--limit", type=int)
    judge.add_argument("--force", action="store_true")
    judge.set_defaults(handler=_cmd_judge)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
        return int(args.handler(args, manifest))
    except ManifestError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
