"""Pure, fail-closed projection of one canonical authoring revision."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

from PIL import Image

from .canonical_bird_contract import CanonicalRevisionStore, snapshot_revisions, validate_snapshot
from .cleanup_geometry import CleanupSite, Point, Rect, cleanup_polygons_for_site


class CanonicalExportError(ValueError):
    pass


def _asset_path(session_root: Path, descriptor: dict[str, Any], label: str) -> Path:
    relative = Path(descriptor["path"])
    if relative.is_absolute() or ".." in relative.parts:
        raise CanonicalExportError(f"{label} path leaves the authoring session")
    source = (session_root / relative).resolve()
    try:
        source.relative_to(session_root.resolve())
    except ValueError as error:
        raise CanonicalExportError(f"{label} path leaves the authoring session") from error
    if not source.is_file():
        raise CanonicalExportError(f"{label} asset is missing")
    payload = source.read_bytes()
    if len(payload) != descriptor["bytes"]:
        raise CanonicalExportError(f"{label} byte size does not match its revision")
    if hashlib.sha256(payload).hexdigest() != descriptor["sha256"]:
        raise CanonicalExportError(f"{label} hash does not match its revision")
    return source


def _point_in_polygon(point: Point, polygon: list[Point]) -> bool:
    inside = False
    previous = polygon[-1]
    for current in polygon:
        crosses = (current.y > point.y) != (previous.y > point.y)
        if crosses:
            boundary_x = (previous.x - current.x) * (point.y - current.y) / (previous.y - current.y) + current.x
            if point.x < boundary_x:
                inside = not inside
        previous = current
    return inside


def _validate_cleanup(snapshot: dict[str, Any], width: int, height: int) -> None:
    sites = [CleanupSite(
        bird_id=bird["birdId"],
        x=bird["hitbox"]["x"],
        y=bird["hitbox"]["y"],
        cleanup=Rect(
            bird["cleanup"]["x"], bird["cleanup"]["y"],
            bird["cleanup"]["x"] + bird["cleanup"]["width"],
            bird["cleanup"]["y"] + bird["cleanup"]["height"],
        ),
    ) for bird in snapshot["birds"]]
    for site in sites:
        polygons = cleanup_polygons_for_site(site, sites, width, height, lambda _other: True)
        if not any(_point_in_polygon(Point(site.x, site.y), polygon) for polygon in polygons):
            raise CanonicalExportError(f"{site.bird_id} cleanup does not own its pickup point")


def _level_json(snapshot: dict[str, Any], width: int, height: int) -> dict[str, Any]:
    session_id = snapshot["sessionId"]
    birds = sorted(snapshot["birds"], key=lambda bird: bird["presentationOrder"])
    aliases = {bird["compatibilitySlot"]: bird["birdId"] for bird in birds}
    return {
        "id": session_id,
        "name": f"Level {session_id}",
        "width": width,
        "height": height,
        "colorImage": f"levels/{session_id}/color.png",
        "artifactRevision": snapshot_revisions(snapshot).content_revision,
        "compatibilityAliases": aliases,
        "dogs": [{
            "id": bird["birdId"],
            "compatibilitySlot": bird["compatibilitySlot"],
            "x": bird["hitbox"]["x"],
            "y": bird["hitbox"]["y"],
            "r": bird["hitbox"]["r"],
            "sprite": {
                "image": f"levels/{session_id}/dogs/{bird['compatibilitySlot']}/sprite_000.png",
                **bird["sprite"]["placement"],
                "cleanup": {key: bird["cleanup"][key] for key in ("x", "y", "width", "height")},
                "anchorX": bird["sprite"]["anchorX"],
                "anchorY": bird["sprite"]["anchorY"],
                "flipX": bird["sprite"]["flipX"],
                "flipY": bird["sprite"]["flipY"],
            },
        } for bird in birds],
    }


def _artifact_manifest(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "contentRevision": snapshot_revisions(snapshot).content_revision,
        "scene": {"path": "color.png", "sha256": snapshot["assets"]["scene"]["sha256"]},
        "restore": {
            "path": "bg_00.png",
            "sha256": snapshot["restore"]["asset"]["sha256"],
            "sourceSceneSha256": snapshot["restore"]["sourceSceneSha256"],
        },
        "birds": [{
            "birdId": bird["birdId"],
            "compatibilitySlot": bird["compatibilitySlot"],
            "sprite": {
                "path": f"dogs/{bird['compatibilitySlot']}/sprite_000.png",
                "sha256": bird["sprite"]["asset"]["sha256"],
            },
            "cleanupSourceSpriteSha256": bird["cleanup"]["sourceSpriteSha256"],
        } for bird in snapshot["birds"]],
    }


def export_canonical_revision(
    store: CanonicalRevisionStore,
    destination_root: Path,
    *,
    expected_content_revision: str | None = None,
) -> dict[str, Any]:
    """Stage, validate and atomically install one unchanged canonical revision."""
    current = store.read()
    if current.snapshot is None or current.pointer is None:
        raise CanonicalExportError("canonical authoring revision is unavailable")
    snapshot = validate_snapshot(current.snapshot)
    revision = current.pointer.content_revision
    if expected_content_revision is not None and expected_content_revision != revision:
        raise CanonicalExportError("canonical content revision changed before export")
    final_review = snapshot.get("reviews", {}).get("finalCutouts")
    if not isinstance(final_review, dict) or final_review.get("contentRevision") != revision:
        raise CanonicalExportError("current canonical revision is not final-cutout reviewed")

    session_root = store.session_root
    scene = _asset_path(session_root, snapshot["assets"]["scene"], "scene")
    restore = _asset_path(session_root, snapshot["restore"]["asset"], "restore")
    sprite_sources = {
        bird["birdId"]: _asset_path(session_root, bird["sprite"]["asset"], f"{bird['birdId']} sprite")
        for bird in snapshot["birds"]
    }
    with Image.open(scene) as image:
        width, height = image.size
    with Image.open(restore) as image:
        if image.size != (width, height):
            raise CanonicalExportError("restore dimensions do not match the scene revision")
    _validate_cleanup(snapshot, width, height)
    level = _level_json(snapshot, width, height)

    destination_root.mkdir(parents=True, exist_ok=True)
    staging = destination_root / f".export-{snapshot['sessionId']}-{uuid.uuid4().hex}"
    target = destination_root / snapshot["sessionId"]
    backup = destination_root / f".export-backup-{snapshot['sessionId']}-{uuid.uuid4().hex}"
    try:
        staging.mkdir()
        shutil.copy2(scene, staging / "color.png")
        shutil.copy2(restore, staging / "bg_00.png")
        for bird in snapshot["birds"]:
            output = staging / "dogs" / bird["compatibilitySlot"] / "sprite_000.png"
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(sprite_sources[bird["birdId"]], output)
        # Bundle derivatives ship with the package (2560/q70 webp for scene +
        # restore bg), matching the legacy exporter. Canonical exports missed
        # them, so 33 packages shipped PNG-only and the native bundle blew
        # its 200MB cap at 42 levels (2026-08-14).
        from PIL import Image as _Image

        for stem in ("color", "bg_00"):
            with _Image.open(staging / f"{stem}.png") as img:
                im = img.convert("RGB")
                if im.width > 2560:
                    im = im.resize((2560, int(im.height * 2560 / im.width)), _Image.LANCZOS)
                im.save(staging / f"{stem}.webp", format="WEBP", quality=70, method=6)
        (staging / "level.json").write_text(json.dumps(level, indent=2) + "\n")
        (staging / "artifact-manifest.json").write_text(json.dumps(_artifact_manifest(snapshot), indent=2) + "\n")

        from .export_gate import validate_level_dir

        validate_level_dir(destination_root, staging.name, sprite_quality=False)
        after = store.read()
        if after.pointer is None or after.pointer.content_revision != revision:
            raise CanonicalExportError("canonical content revision changed during export")
        if target.exists():
            os.replace(target, backup)
        os.replace(staging, target)
        if backup.exists():
            shutil.rmtree(backup)
    except Exception:
        if backup.exists() and not target.exists():
            os.replace(backup, target)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)
        if backup.exists():
            shutil.rmtree(backup)
    return {"levelId": snapshot["sessionId"], "contentRevision": revision, "path": target}
