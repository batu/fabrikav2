from __future__ import annotations

import hashlib

import pytest
from PIL import Image

from levelbuilder.api.canonical_bird_contract import bless_snapshot
from test_canonical_hitbox_cas import _canonical_session


def _descriptor(path):
    payload = path.read_bytes()
    return {"path": path.name, "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}


def _reviewed_export_session(isolated_session, session_id):
    store, pointer = _canonical_session(isolated_session, session_id)
    root = isolated_session.session_dir(session_id)
    scene = root / "color.png"
    restore = root / "bg.png"
    sprite = root / "sprite.png"
    Image.new("RGB", (80, 60), (220, 20, 20)).save(scene)
    Image.new("RGB", (80, 60), (20, 180, 20)).save(restore)
    Image.new("RGBA", (12, 14), (10, 20, 200, 255)).save(sprite)
    snapshot = store.read().snapshot
    snapshot["assets"]["scene"] = _descriptor(scene)
    snapshot["assets"]["cleanBackground"] = _descriptor(restore)
    snapshot["restore"] = {
        "asset": _descriptor(restore),
        "sourceSceneSha256": snapshot["assets"]["scene"]["sha256"],
    }
    bird = snapshot["birds"][0]
    bird["activeGeneration"]["inputSceneSha256"] = snapshot["assets"]["scene"]["sha256"]
    bird["sprite"]["asset"] = _descriptor(sprite)
    bird["cleanup"]["sourceSpriteSha256"] = bird["sprite"]["asset"]["sha256"]
    updated = store.commit(snapshot, expected_content_revision=pointer.content_revision)
    snapshot = bless_snapshot(store.read().snapshot, review_kind="hitboxes", reviewer="human:test", reviewed_at="now")
    updated = store.commit(snapshot, expected_content_revision=updated.content_revision)
    snapshot = bless_snapshot(store.read().snapshot, review_kind="finalCutouts", reviewer="human:test", reviewed_at="now")
    updated = store.commit(snapshot, expected_content_revision=updated.content_revision)
    return store, updated


def test_canonical_export_is_source_read_only_and_preserves_stable_identity(isolated_session, tmp_path):
    from levelbuilder.api.canonical_export import export_canonical_revision

    store, pointer = _reviewed_export_session(isolated_session, "canonical_export")
    before = {path.relative_to(store.session_root): path.read_bytes() for path in store.session_root.rglob("*") if path.is_file()}

    result = export_canonical_revision(store, tmp_path, expected_content_revision=pointer.content_revision)

    after = {path.relative_to(store.session_root): path.read_bytes() for path in store.session_root.rglob("*") if path.is_file()}
    assert after == before
    level = __import__("json").loads((tmp_path / "canonical_export" / "level.json").read_text())
    assert result["contentRevision"] == pointer.content_revision
    assert level["dogs"][0]["id"] == "bird_one"
    assert level["dogs"][0]["compatibilitySlot"] == "dog_00"
    assert level["compatibilityAliases"] == {"dog_00": "bird_one"}

    first = {path.relative_to(tmp_path / "canonical_export"): path.read_bytes()
             for path in (tmp_path / "canonical_export").rglob("*") if path.is_file()}
    export_canonical_revision(store, tmp_path, expected_content_revision=pointer.content_revision)
    second = {path.relative_to(tmp_path / "canonical_export"): path.read_bytes()
              for path in (tmp_path / "canonical_export").rglob("*") if path.is_file()}
    assert second == first


def test_canonical_export_hash_mismatch_leaves_existing_package_unchanged(isolated_session, tmp_path):
    from levelbuilder.api.canonical_export import CanonicalExportError, export_canonical_revision

    store, pointer = _reviewed_export_session(isolated_session, "canonical_export_bad_hash")
    target = tmp_path / "canonical_export_bad_hash"
    target.mkdir()
    (target / "sentinel").write_text("old")
    (store.session_root / "sprite.png").write_bytes(b"tampered")

    with pytest.raises(CanonicalExportError, match="revision"):
        export_canonical_revision(store, tmp_path, expected_content_revision=pointer.content_revision)

    assert (target / "sentinel").read_text() == "old"
    assert sorted(path.name for path in target.iterdir()) == ["sentinel"]


def test_export_gate_rejects_tampered_canonical_package(isolated_session, tmp_path):
    from levelbuilder.api.canonical_export import export_canonical_revision
    from levelbuilder.api.export_gate import ExportGateError, validate_level_dir

    store, pointer = _reviewed_export_session(isolated_session, "canonical_export_tampered")
    export_canonical_revision(store, tmp_path, expected_content_revision=pointer.content_revision)
    (tmp_path / "canonical_export_tampered" / "bg_00.png").write_bytes(b"wrong restore")

    with pytest.raises(ExportGateError, match="restore asset hash mismatch"):
        validate_level_dir(tmp_path, "canonical_export_tampered", sprite_quality=False)


def test_concurrent_authoring_mutation_cannot_replace_existing_package(isolated_session, tmp_path, monkeypatch):
    from levelbuilder.api import export_gate
    from levelbuilder.api.canonical_export import CanonicalExportError, export_canonical_revision

    store, pointer = _reviewed_export_session(isolated_session, "canonical_export_race")
    target = tmp_path / "canonical_export_race"
    target.mkdir()
    (target / "sentinel").write_text("old")
    original_validate = export_gate.validate_level_dir

    def mutate_after_validate(*args, **kwargs):
        original_validate(*args, **kwargs)
        snapshot = store.read().snapshot
        snapshot["operational"]["race"] = True
        store.commit(snapshot, expected_content_revision=store.read().pointer.content_revision)
        snapshot = store.read().snapshot
        snapshot["birds"][0]["hitbox"]["x"] += 1
        snapshot["reviews"] = {}
        store.commit(snapshot, expected_content_revision=store.read().pointer.content_revision)

    monkeypatch.setattr(export_gate, "validate_level_dir", mutate_after_validate)

    with pytest.raises(CanonicalExportError, match="changed during export"):
        export_canonical_revision(store, tmp_path, expected_content_revision=pointer.content_revision)

    assert (target / "sentinel").read_text() == "old"


def test_public_export_entrypoint_routes_canonical_sessions_without_authoring_writes(isolated_session, tmp_path):
    store, pointer = _reviewed_export_session(isolated_session, "canonical_export_entrypoint")
    before = store.read().pointer

    result = isolated_session.export_to_game(
        "canonical_export_entrypoint",
        destination_root=tmp_path,
        update_preview_manifest=False,
        update_preview_variant=False,
        enforce_visibility=False,
    )

    assert result["variant"] == "canonical"
    assert result["contentRevision"] == pointer.content_revision
    assert store.read().pointer == before
