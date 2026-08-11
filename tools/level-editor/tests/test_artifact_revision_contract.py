from __future__ import annotations

import json
import multiprocessing
from pathlib import Path

import pytest
from pydantic import ValidationError

from levelbuilder.api.artifact_revision import (
    ArtifactRevisionConflict,
    ArtifactRevisionStore,
    ContentManifest,
)


def _asset(name: str, digest: str) -> dict:
    return {"path": name, "sha256": digest * 64, "size": 10}


def _bird(bird_id: str = "bird-a", *, slot: str = "dog_00", cleanup_x: int = 8) -> dict:
    return {
        "birdId": bird_id,
        "compatibilitySlot": slot,
        "hitbox": {"x": 20, "y": 30, "r": 12},
        "sprite": {
            "image": _asset(f"dogs/{slot}/sprite_000.png", "b"),
            "spriteBox": [10, 20, 40, 60],
            "cleanupBox": [cleanup_x, 18, 42, 62],
            "anchorX": 0.5,
            "anchorY": 0.5,
            "flipX": False,
            "flipY": False,
        },
    }


def _manifest(*, session_id: str = "scene-a", birds: list[dict] | None = None, presentation_order: list[str] | None = None) -> ContentManifest:
    bird_values = birds or [_bird()]
    return ContentManifest.model_validate({
        "schemaVersion": 1,
        "sessionId": session_id,
        "scene": _asset("color.png", "a"),
        "restore": {
            "image": _asset("bg_00.png", "c"),
            "sourceSceneSha256": "a" * 64,
            "sourceHitboxesSha256": "d" * 64,
        },
        "birds": bird_values,
        "presentationOrder": presentation_order or [bird["birdId"] for bird in bird_values],
    })


def _race_commit(root: str, expected: str, queue: multiprocessing.Queue) -> None:
    store = ArtifactRevisionStore(Path(root))
    try:
        committed = store.commit(_manifest(session_id=Path(root).name, birds=[_bird(cleanup_x=9)]), expected_revision=expected)
        queue.put(("ok", committed.content_revision))
    except ArtifactRevisionConflict as error:
        queue.put(("conflict", error.actual_revision))


def test_manifest_rejects_duplicate_bird_ids_and_slots() -> None:
    with pytest.raises(ValidationError):
        _manifest(birds=[_bird(), _bird()])
    with pytest.raises(ValidationError):
        _manifest(birds=[_bird("bird-a"), _bird("bird-b")])


def test_content_revision_ignores_gallery_presentation_order_but_binds_cleanup() -> None:
    first = _manifest(birds=[_bird("bird-a", slot="dog_00"), _bird("bird-b", slot="dog_01")], presentation_order=["bird-a", "bird-b"])
    reordered_gallery = _manifest(birds=[_bird("bird-a", slot="dog_00"), _bird("bird-b", slot="dog_01")], presentation_order=["bird-b", "bird-a"])
    changed_cleanup = _manifest(birds=[_bird("bird-a", cleanup_x=7, slot="dog_00"), _bird("bird-b", slot="dog_01")])

    assert first.content_revision == reordered_gallery.content_revision
    assert first.content_revision != changed_cleanup.content_revision


def test_content_revision_matches_typescript_fixture() -> None:
    assert _manifest().content_revision == "1b4e99883a32371eaddcbe4ba7defadcb856b990ff515b7e4043ccb26e58d2e0"


def test_revision_store_has_explicit_legacy_and_integrity_states(tmp_path: Path) -> None:
    store = ArtifactRevisionStore(tmp_path)
    assert store.read().status == "migration_required"

    store.pointer_path.parent.mkdir(parents=True)
    store.pointer_path.write_text("not-json")
    assert store.read().status == "quarantined_integrity"

    store.pointer_path.write_text(json.dumps({"contentRevision": "f" * 64}))
    assert store.read().status == "quarantined_integrity"


def test_commit_is_compare_and_set_and_ignores_orphaned_stage(tmp_path: Path) -> None:
    store = ArtifactRevisionStore(tmp_path)
    staged = store.revisions_dir / ".stage-orphan"
    staged.mkdir(parents=True)
    (staged / "manifest.json").write_text("{}")
    assert store.read().status == "migration_required"

    first = store.commit(_manifest(session_id=tmp_path.name), expected_revision=None)
    assert store.read().content_revision == first.content_revision
    with pytest.raises(ArtifactRevisionConflict):
        store.commit(_manifest(session_id=tmp_path.name, birds=[_bird(cleanup_x=9)]), expected_revision=None)


def test_two_processes_cannot_commit_the_same_expected_revision(tmp_path: Path) -> None:
    store = ArtifactRevisionStore(tmp_path)
    first = store.commit(_manifest(session_id=tmp_path.name), expected_revision=None)
    queue: multiprocessing.Queue = multiprocessing.Queue()
    processes = [
        multiprocessing.Process(target=_race_commit, args=(str(tmp_path), first.content_revision, queue))
        for _ in range(2)
    ]
    for process in processes:
        process.start()
    for process in processes:
        process.join(timeout=10)
        assert process.exitcode == 0

    outcomes = sorted(queue.get(timeout=2)[0] for _ in processes)
    assert outcomes == ["conflict", "ok"]
