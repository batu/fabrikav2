"""Read-only current-pose audit against independently prompted SAM3 subjects.

This evaluates exported placements, not proposed replacements. SAM masks are
estimates of visible subjects, not ground truth or a semantic correctness gate.
"""

from __future__ import annotations

import base64
import hashlib
import html
import io
import json
import math
from collections.abc import Callable
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy import ndimage

from levelbuilder.golden_cutouts import placement_box_metrics

from .cleanup_geometry import CleanupSite, Rect, cleanup_polygons_for_site
from .placement_segmenter import SegmenterUnavailable
from .sprite_eval import BirdInputs, _alpha_in_crop, _atomic_write_json

VERSION = "current-pose-residue-v2"
MIN_CONFIDENCE = 0.80


def runtime_sprite_box(dog: dict) -> tuple[int, int, int, int]:
    """Mirror GameScene.spawnPickupImage's origin, including flipped anchors."""
    sprite = dog["sprite"]
    width, height = float(sprite["width"]), float(sprite["height"])
    ax, ay = float(sprite.get("anchorX", 0.5)), float(sprite.get("anchorY", 0.5))
    if not all(math.isfinite(v) for v in (width, height, ax, ay, dog["x"], dog["y"])):
        raise ValueError("non-finite sprite geometry")
    if min(width, height) <= 0 or not (0 <= ax <= 1 and 0 <= ay <= 1):
        raise ValueError("invalid sprite geometry")
    ax = 1 - ax if sprite.get("flipX") else ax
    ay = 1 - ay if sprite.get("flipY") else ay
    x, y = float(dog["x"]) - ax * width, float(dog["y"]) - ay * height
    return round(x), round(y), round(x + width), round(y + height)


def _bounds(mask: np.ndarray) -> list[int]:
    y, x = np.nonzero(mask)
    return [int(x.min()), int(y.min()), int(x.max()) + 1, int(y.max()) + 1]


def mask_metrics(sprite: np.ndarray, subject: np.ndarray) -> dict:
    if sprite.shape != subject.shape:
        raise ValueError("mask dimensions differ")
    if not sprite.any() or not subject.any():
        return {"score": None, "reason": "empty sprite or subject"}
    intersection = int((sprite & subject).sum())
    union = int((sprite | subject).sum())
    sb, tb = _bounds(sprite), _bounds(subject)
    geometry = placement_box_metrics(sb, tb)
    return {
        "score": round(100 * intersection / union, 2),
        "spritePrecision": round(intersection / int(sprite.sum()), 4),
        "subjectRecall": round(intersection / int(subject.sum()), 4),
        "centerErrorPx": round(geometry["centerPx"], 2),
        "centerErrorNormalized": round(
            geometry["centerPx"] / math.hypot(tb[2] - tb[0], tb[3] - tb[1]), 4
        ),
        "widthRatio": round((sb[2] - sb[0]) / (tb[2] - tb[0]), 4),
        "heightRatio": round((sb[3] - sb[1]) / (tb[3] - tb[1]), 4),
        "spriteBounds": sb,
        "subjectBounds": tb,
    }


def select_subject(masks: np.ndarray, scores: list[float], point: tuple[float, float]):
    """Choose by model confidence and scene-only guards, NEVER sprite overlap."""
    if masks.ndim != 3 or len(masks) != len(scores) or not len(scores):
        raise ValueError("invalid segmentation response")
    if not all(math.isfinite(score) and 0 <= score <= 1 for score in scores):
        raise ValueError("invalid segmentation confidence")
    x, y = round(point[0]), round(point[1])
    candidates = []
    for index, mask in enumerate(masks.astype(bool)):
        area = float(mask.mean())
        border = np.concatenate((mask[0], mask[-1], mask[:, 0], mask[:, -1]))
        if 0.002 <= area <= 0.65 and border.mean() < 0.05 and mask[y, x]:
            candidates.append(index)
    if not candidates:
        index = int(np.argmax(scores))
        return (
            masks[index].astype(bool),
            scores[index],
            ["subject mask failed scene-only guards"],
        )
    index = max(candidates, key=lambda i: scores[i])
    confidence = scores[index]
    reasons = [] if confidence >= MIN_CONFIDENCE else ["low segmentation confidence"]
    return masks[index].astype(bool), confidence, reasons


def summarize(birds: list[dict]) -> dict:
    values = [
        b["score"] for b in birds if b["status"] == "scored" and b["score"] is not None
    ]
    coverage = len(values) / len(birds) if birds else 0
    return {
        "birds": len(birds),
        "scored": len(values),
        "uncertain": sum(b["status"] == "uncertain" for b in birds),
        "errors": sum(b["status"] == "error" for b in birds),
        "coverage": coverage,
        "rankable": coverage >= 0.8 and bool(values),
        "meanScore": round(float(np.mean(values)), 2) if values else None,
        "meanBounds": [
            round(sum(values) / len(birds), 2),
            round((sum(values) + 100 * (len(birds) - len(values))) / len(birds), 2),
        ]
        if birds
        else [None, None],
        "p10Score": round(float(np.percentile(values, 10)), 2) if values else None,
        "below50": sum(v < 50 for v in values),
        "residueFlags": sum(
            b.get("residueFirst", {}).get("flagged", False)
            for b in birds
            if b["status"] == "scored"
        ),
        "finalResidueFlags": sum(
            b.get("residueFinal", {}).get("flagged", False)
            for b in birds
            if b["status"] == "scored"
        ),
    }


def residue_metrics(
    scene: np.ndarray, restore: np.ndarray, subject: np.ndarray, erase: np.ndarray
) -> dict:
    """Candidate residue: visible subject outside erase, or surviving in restore.

    Matching restored colors can be coincidental; flag for visual review rather
    than claiming a semantic proof. Remove isolated compression/edge specks.
    """
    outside = subject & ~erase
    similar = (
        np.max(np.abs(scene.astype(np.int16) - restore.astype(np.int16)), axis=2) <= 12
    )
    restored = subject & erase & similar
    labels, count = ndimage.label(outside | restored)
    sizes = np.bincount(labels.ravel())
    keep = sizes >= 12
    keep[0] = False
    residue = keep[labels] if count else np.zeros_like(subject)
    remaining = int(residue.sum())
    area = int(subject.sum())
    return {
        "remainingPixels": remaining,
        "remainingFraction": round(remaining / max(1, area), 4),
        "outsideCleanupPixels": int((outside & residue).sum()),
        "restoreMatchPixels": int((restored & residue).sum()),
        "flagged": remaining >= 24 and remaining / max(1, area) >= 0.01,
    }


def _sites(level: dict) -> list[CleanupSite]:
    sites = []
    for dog in level["dogs"]:
        cleanup = dog.get("sprite", {}).get("cleanup")
        rect = (
            None
            if cleanup is None
            else Rect(
                cleanup["x"],
                cleanup["y"],
                cleanup["x"] + cleanup["width"],
                cleanup["y"] + cleanup["height"],
            )
        )
        sites.append(CleanupSite(dog["id"], dog["x"], dog["y"], rect))
    return sites


def _erase_mask(
    site: CleanupSite,
    sites: list[CleanupSite],
    size: tuple[int, int],
    box: tuple[int, int, int, int],
    found: set[str],
) -> np.ndarray:
    mask = Image.new("L", (box[2] - box[0], box[3] - box[1]))
    draw = ImageDraw.Draw(mask)
    polygons = cleanup_polygons_for_site(
        site, sites, *size, lambda other: other.bird_id not in found
    )
    for polygon in polygons:
        draw.polygon(
            [(point.x - box[0], point.y - box[1]) for point in polygon], fill=255
        )
    return np.asarray(mask) > 0


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _asset(root: Path, relative: str) -> Path:
    path = (root.parent / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"asset escapes levels directory: {relative}")
    return path


def _segment(client, crop: Image.Image, cache: Path) -> dict:
    buffer = io.BytesIO()
    crop.save(buffer, format="PNG")
    request = {
        "image_png_b64": base64.b64encode(buffer.getvalue()).decode(),
        "model": client.identity,
    }
    key = _sha(
        json.dumps({"version": VERSION, "request": request}, sort_keys=True).encode()
    )
    target = cache / f"{key}.json"
    try:
        return json.loads(target.read_text())
    except FileNotFoundError:
        pass
    result = client.predict(request)
    # Validate before admitting a remote response to the resumable cache.
    _decode(result, crop.size)
    _atomic_write_json(target, result)
    return result


def _decode(result: dict, size: tuple[int, int]) -> np.ndarray:
    shape = result["shape"]
    if len(shape) != 3 or not 0 <= shape[0] <= 100 or shape[1:] != [size[1], size[0]]:
        raise ValueError("segmentation mask shape mismatch")
    bits = np.unpackbits(
        np.frombuffer(
            base64.b64decode(result["masks_packed_b64"], validate=True), dtype=np.uint8
        )
    )
    return bits[: math.prod(shape)].reshape(shape).astype(bool)


def _panel(
    crop: Image.Image,
    alpha: np.ndarray,
    rgb: np.ndarray,
    mask: np.ndarray,
    departed: Image.Image,
    final: Image.Image,
) -> str:
    rgba = np.dstack((rgb.astype(np.uint8), (alpha * 255).astype(np.uint8)))
    overlay = Image.alpha_composite(
        crop.convert("RGBA"), Image.fromarray(rgba)
    ).convert("RGB")
    tinted = np.array(crop)
    tinted[mask] = (0.45 * tinted[mask] + 0.55 * np.array([0, 210, 165])).astype(
        np.uint8
    )
    surviving = mask & (
        np.max(
            np.abs(
                np.asarray(crop).astype(np.int16)
                - np.asarray(departed).astype(np.int16)
            ),
            axis=2,
        )
        <= 12
    )
    residue_view = np.array(departed)
    residue_view[surviving] = (
        0.35 * residue_view[surviving] + 0.65 * np.array([240, 50, 50])
    ).astype(np.uint8)
    panes = [
        crop,
        overlay,
        Image.fromarray(tinted),
        departed,
        final,
        Image.fromarray(residue_view),
    ]
    width = 300
    height = max(1, round(crop.height * width / crop.width))
    panel = Image.new("RGB", (width * 3, (height + 25) * 2), "white")
    draw = ImageDraw.Draw(panel)
    for i, (pane, label) in enumerate(
        zip(
            panes,
            [
                "Painted scene",
                "Current pickup overlay",
                "Estimated visible subject",
                "After this bird picked first",
                "After all birds picked in order",
                "Matching pixels: residue candidates",
            ],
        )
    ):
        px, py = (i % 3) * width, (i // 3) * (height + 25)
        panel.paste(
            pane.resize((width, height), Image.Resampling.LANCZOS), (px, py + 25)
        )
        draw.text((px + 5, py + 5), label, fill="black")
    buffer = io.BytesIO()
    panel.save(buffer, format="JPEG", quality=82)
    return base64.b64encode(buffer.getvalue()).decode()


def evaluate_level(root: Path, level_id: str, client, cache: Path) -> dict:
    level_path = root / level_id / "level.json"
    level_bytes = level_path.read_bytes()
    level = json.loads(level_bytes)
    scene_path = _asset(root, level["colorImage"])
    scene_bytes = scene_path.read_bytes()
    hashes = {
        str(level_path.relative_to(root)): _sha(level_bytes),
        str(scene_path.relative_to(root)): _sha(scene_bytes),
    }
    scene = Image.open(io.BytesIO(scene_bytes)).convert("RGB")
    if scene.size != (level["width"], level["height"]):
        raise ValueError("scene dimensions do not match level coordinates")
    restore_path = root / level_id / "bg_00.png"
    try:
        restore_bytes = restore_path.read_bytes()
    except FileNotFoundError:
        restore_path = root / level_id / "bg_00.webp"
        restore_bytes = restore_path.read_bytes()
    hashes[str(restore_path.relative_to(root))] = _sha(restore_bytes)
    restore = Image.open(io.BytesIO(restore_bytes)).convert("RGB")
    if restore.size != scene.size:
        if restore.width * scene.height != restore.height * scene.width:
            raise ValueError(
                "restore aspect ratio does not match scene; section stitching unsupported"
            )
        restore = restore.resize(scene.size, Image.Resampling.BILINEAR)
    sites = _sites(level)
    sites_by_id = {site.bird_id: site for site in sites}
    if len(sites_by_id) != len(sites):
        raise ValueError("duplicate bird IDs")
    final_erase = np.zeros((scene.height, scene.width), bool)
    found: set[str] = set()
    full_box = (0, 0, scene.width, scene.height)
    for site in sites:
        final_erase |= _erase_mask(site, sites, scene.size, full_box, found)
        found.add(site.bird_id)
    birds = []
    for dog in level["dogs"]:
        record = {"dogId": dog["id"], "status": "error", "score": None}
        try:
            sprite_path = _asset(root, dog["sprite"]["image"])
            sprite_bytes = sprite_path.read_bytes()
            hashes[str(sprite_path.relative_to(root))] = _sha(sprite_bytes)
            sprite = Image.open(io.BytesIO(sprite_bytes)).convert("RGBA")
            if dog["sprite"].get("flipX"):
                sprite = ImageOps.mirror(sprite)
            if dog["sprite"].get("flipY"):
                sprite = ImageOps.flip(sprite)
            sprite_box = runtime_sprite_box(dog)
            x, y, radius = float(dog["x"]), float(dog["y"]), float(dog["r"])
            if not (
                0 < x < scene.width - 1
                and 0 < y < scene.height - 1
                and 0 < radius < max(scene.size)
            ):
                raise ValueError("invalid target point or radius")
            pad = max(32, round(4 * radius))
            box = (
                max(0, round(x) - pad),
                max(0, round(y) - pad),
                min(scene.width, round(x) + pad),
                min(scene.height, round(y) + pad),
            )
            crop = scene.crop(box)
            point = (x - box[0], y - box[1])
            inputs = BirdInputs(
                dog_id=dog["id"],
                sprite=sprite,
                sprite_box=sprite_box,
                crop_box=box,
                clean_crop=None,
                scene_crop=None,
            )
            alpha, rgb = _alpha_in_crop(inputs)
            masks, confidence, reasons = [], [], []
            neutral = Image.fromarray(
                (rgb * alpha[..., None] + 190 * (1 - alpha[..., None])).astype(np.uint8)
            )
            for source in (crop, neutral):
                response = _segment(client, source, cache)
                decoded = _decode(response, source.size)
                if not len(decoded):
                    mask, conf, why = (
                        np.zeros((source.height, source.width), bool),
                        0,
                        ["no bird detected in scene or pickup sprite"],
                    )
                else:
                    mask, conf, why = select_subject(decoded, response["scores"], point)
                masks.append(mask)
                confidence.append(conf)
                reasons.extend(why)
            subject = masks[0]
            sprite_subject = masks[1] & (alpha >= 0.5)
            metrics = mask_metrics(sprite_subject, subject)
            metrics["fullCutoutOverlap"] = mask_metrics(alpha >= 0.5, subject)["score"]
            if metrics["score"] is None:
                reasons.append("empty sprite or subject")
            if not (
                box[0] <= sprite_box[0] < sprite_box[2] <= box[2]
                and box[1] <= sprite_box[1] < sprite_box[3] <= box[3]
            ):
                reasons.append("sprite extends beyond evaluation crop")
            record.update(metrics)
            site = sites_by_id[dog["id"]]
            erase = _erase_mask(site, sites, scene.size, box, set())
            final_mask = final_erase[box[1] : box[3], box[0] : box[2]]
            painted_array = np.asarray(crop)
            restored_array = np.asarray(restore.crop(box))
            record["residueFirst"] = residue_metrics(
                painted_array, restored_array, subject, erase
            )
            record["residueFinal"] = residue_metrics(
                painted_array, restored_array, subject, final_mask
            )
            departed = Image.fromarray(
                np.where(erase[..., None], restored_array, painted_array)
            )
            final = Image.fromarray(
                np.where(final_mask[..., None], restored_array, painted_array)
            )
            record.update(
                status="uncertain" if reasons else "scored",
                reasons=sorted(set(reasons)),
                segmentationConfidence=confidence,
                runtimeBox=list(sprite_box),
                cropBox=list(box),
                panelJpeg=_panel(crop, alpha, rgb, subject, departed, final),
            )
        except SegmenterUnavailable:
            raise
        except (OSError, ValueError, KeyError, RuntimeError) as error:
            record["reasons"] = [str(error)]
        birds.append(record)
    # A concurrently edited level must not produce a silently mixed result.
    if any(
        _sha((root / path).read_bytes()) != digest for path, digest in hashes.items()
    ):
        raise ValueError("source assets changed during evaluation; retry this level")
    return {
        "levelId": level_id,
        "artifactRevision": level.get("artifactRevision"),
        "sourceHashes": hashes,
        "summary": summarize(birds),
        "birds": birds,
    }


STYLE = """body{font:16px/1.5 system-ui,sans-serif;color:#20302d;background:#f7f8f5;margin:0}main{max-width:1160px;margin:auto;padding:28px}h1{font-size:30px;margin:0 0 12px}a{color:#006b59}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #d3ddd6}th{position:sticky;top:0;background:#f7f8f5}input{padding:10px;width:min(90%,480px);margin:15px 0}img{width:100%;height:auto}article{margin:28px 0;border-top:1px solid #b6c9bf;padding-top:12px}.muted{color:#53685e}.score{font-size:22px;font-weight:700}code{overflow-wrap:anywhere}td:first-child{overflow-wrap:anywhere}details{margin:20px 0}@media(max-width:650px){main{padding:14px}table{font-size:12px}td,th{padding:6px}h1{font-size:25px}}"""


def _page(title: str, body: str) -> str:
    return f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{STYLE} .table-scroll,pre{{overflow-x:auto}} .table-scroll table{{min-width:700px}}</style><main>{body}</main></html>'


def write_report(report: dict, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    ordered = sorted(
        report["levels"],
        key=lambda level: (
            not level["summary"]["rankable"],
            -(level["summary"]["meanScore"] or 0),
        ),
    )
    for index, level in enumerate(ordered):
        level_id, summary = level["levelId"], level["summary"]
        title = level_id.replace("_bird_", " ").replace("_", " ")
        score = summary["meanScore"]
        label = f"{score:.1f}" if score is not None else "—"
        ranking = str(index + 1) if summary["rankable"] else "Unranked"
        rows.append(
            f'<tr><td>{ranking}</td><td><a href="{html.escape(level_id)}.html">{html.escape(title)}</a></td><td>{label}</td><td>{summary["p10Score"]}</td><td>{summary["scored"]}/{summary["birds"]}</td><td>{summary["uncertain"]}</td><td>{summary["residueFlags"]} / {summary["finalResidueFlags"]}</td><td>{summary["errors"]}</td></tr>'
        )
        cards = []
        for bird in sorted(
            level["birds"],
            key=lambda b: (
                b["status"] == "scored",
                b["score"] if b["score"] is not None else -1,
            ),
        ):
            details = {key: value for key, value in bird.items() if key != "panelJpeg"}
            panel = (
                f'<img loading="lazy" alt="Painted bird, current sprite overlay and estimated subject" src="data:image/jpeg;base64,{bird["panelJpeg"]}">'
                if bird.get("panelJpeg")
                else ""
            )
            residue = bird.get("residueFirst", {})
            residue_label = (
                "Possible residue" if residue.get("flagged") else "No residue flagged"
            )
            if bird["status"] != "scored":
                residue_label = "Residue assessment uncertain"
            cards.append(
                f"<article><h2>{html.escape(bird['dogId'])} · {bird['status']} · {bird['score'] if bird['score'] is not None else 'unscored'}</h2><p><b>{residue_label}</b> · outside cleanup: {residue.get('outsideCleanupPixels', '—')} px · matching restored pixels: {residue.get('restoreMatchPixels', '—')} px</p><p>{html.escape(', '.join(bird.get('reasons', [])))}</p>{panel}<details><summary>Measurements</summary><pre>{html.escape(json.dumps(details, indent=2))}</pre></details></article>"
            )
        (output / f"{level_id}.html").write_text(
            _page(
                title,
                f'<a href="index.html">← All levels</a><h1>{html.escape(title)}</h1><p class="score">{label}/100 visible silhouette overlap</p><p>{summary["scored"]}/{summary["birds"]} birds scored; uncertain masks excluded from mean. This is an alignment diagnostic, not human approval.</p>'
                + "".join(cards),
            )
        )
    model = report["segmenter"]["model"]
    body = f"<h1>FTB sprite placement &amp; pickup residue</h1><p>Current pickup silhouettes compared with {html.escape(model)} estimates of the painted birds. Higher overlap is better. No placements were changed.</p>"
    body += f'<p class="score">{len(ordered)} levels · {sum(l["summary"]["birds"] for l in ordered)} birds</p>'
    body += '<p class="muted">Score = mean intersection-over-union × 100 over reliable masks. SAM3 compares bird-body masks in both the painted scene and isolated sprite; held props are excluded from that score. P10 exposes the weak tail. Levels below 80% scored coverage stay unranked. Segmentation confidence is not proof of correct anatomy: occlusion and shape differences can lower overlap without a positioning error. Open each level to inspect center offset, width/height ratios and image evidence.</p>'
    body += '<input type="search" aria-label="Filter levels" placeholder="Filter levels, e.g. hawaii or library" oninput="for(const row of document.querySelectorAll(\'tbody tr\'))row.hidden=!row.textContent.toLowerCase().includes(this.value.toLowerCase())">'
    body += "<p>Residue flags show picked-first / all-picked cases. They identify surviving subject pixels outside cleanup or matching pixels in the restoration image; retained scenery and similar colors can produce false positives. These are review flags, not automatic approvals.</p>"
    body += (
        '<div class="table-scroll" role="region" aria-label="Level rankings" tabindex="0"><table><thead><tr><th>Rank</th><th>Level</th><th>Mean</th><th>P10</th><th>Scored</th><th>Uncertain</th><th>Residue flags</th><th>Errors</th></tr></thead><tbody>'
        + "".join(rows)
        + "</tbody></table></div>"
    )
    body += f"<details><summary>Method and provenance</summary><p>{VERSION}; SAM3 uses independent bird text segmentation on scene and sprite, confidence ≥ {MIN_CONFIDENCE}. Input hashes accompany the JSON report. Scope is local exported files for the selected catalog, not a live CDN readback or device animation test. Residue checks reuse the runtime cleanup polygons with all neighbors protected, then with sequential collection. Similar restored colors may be innocent; flagged images need review.</p></details>"
    (output / "index.html").write_text(_page("FTB sprite placement", body))


def evaluate_catalog(
    root: Path,
    catalog: Path,
    out: Path,
    sam3_command: str,
    level_ids: list[str] | None = None,
    progress: Callable[[str], None] = print,
) -> dict:
    root, out = root.resolve(), out.resolve()
    if out.is_relative_to(root):
        raise ValueError("audit output must be outside the levels directory")
    manifest_bytes = catalog.read_bytes()
    entries = json.loads(manifest_bytes)["levels"]
    ids = [entry["id"] for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate catalog level IDs")
    if level_ids:
        if set(level_ids) - set(ids):
            raise ValueError("requested level is not in the catalog")
        ids = [level_id for level_id in ids if level_id in level_ids]
    if any(
        not level_id or Path(level_id).name != level_id or level_id in (".", "..")
        for level_id in ids
    ):
        raise ValueError("invalid catalog level ID")
    cache = out / "mask-cache"
    cache.mkdir(parents=True, exist_ok=True)
    checkpoints = out / "levels"
    checkpoints.mkdir(exist_ok=True)
    report = {"method": VERSION, "catalogSha256": _sha(manifest_bytes), "levels": []}
    from .placement_segmenter import Sam3Process

    with Sam3Process(sam3_command) as client:
        report["segmenter"] = client.identity
        cache = cache / _sha(json.dumps(report["segmenter"], sort_keys=True).encode())
        cache.mkdir(exist_ok=True)
        for index, level_id in enumerate(ids):
            try:
                level = evaluate_level(root, level_id, client, cache)
            except (OSError, ValueError, KeyError) as error:
                try:
                    failed_ids = [
                        dog["id"]
                        for dog in json.loads(
                            (root / level_id / "level.json").read_text()
                        )["dogs"]
                    ]
                except (OSError, ValueError, KeyError):
                    failed_ids = ["level unavailable"]
                level = {
                    "levelId": level_id,
                    "birds": [
                        {
                            "dogId": bird_id,
                            "status": "error",
                            "score": None,
                            "reasons": [str(error)],
                        }
                        for bird_id in failed_ids
                    ],
                }
                level["summary"] = summarize(level["birds"])
            report["levels"].append(level)
            _atomic_write_json(checkpoints / f"{level_id}.json", level)
            progress(f"{index + 1}/{len(ids)} {level_id}: {level['summary']}")
    if catalog.read_bytes() != manifest_bytes:
        raise ValueError("catalog changed during evaluation")
    verified_hashes_unchanged = all(
        _sha((root / path).read_bytes()) == digest
        for level in report["levels"]
        for path, digest in level.get("sourceHashes", {}).items()
    )
    if not verified_hashes_unchanged:
        raise ValueError("corpus assets changed during evaluation")
    report["inputsUnchanged"] = (
        True if all(level.get("sourceHashes") for level in report["levels"]) else None
    )
    report["inputVerification"] = (
        "complete"
        if report["inputsUnchanged"]
        else "incomplete: failed levels have unverified inputs"
    )
    _atomic_write_json(out / "results.json", report)
    write_report(report, out / "report")
    return report
