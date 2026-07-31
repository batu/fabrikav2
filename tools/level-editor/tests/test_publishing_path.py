"""Server-side integration tests for the fork's publishing path.

Real functions against real (tmp) filesystem state — no HTTP stubs:
approve replay protection, bundle idempotency, refused-export atomicity,
and staging-orphan handling.
"""

import json
from pathlib import Path

import pytest
from PIL import Image

WIDTH, HEIGHT = 768, 1376


def _build_exportable_session(sess, session_id: str, *, dog_xy=(384, 700)) -> Path:
    """Fabricate a session complete enough for export_to_game/approve."""
    sdir = sess.LEVELS_DIR / session_id
    dog_dir = sdir / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)

    Image.new("RGB", (WIDTH, HEIGHT), (90, 140, 90)).save(sdir / "color.png")
    Image.new("L", (WIDTH, HEIGHT), 200).save(sdir / "bw.png")

    x, y = dog_xy
    (sdir / "hitboxes.json").write_text(json.dumps([{"x": x, "y": y, "r": 30}]))
    (sdir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": f"Level {session_id}",
        "width": WIDTH,
        "height": HEIGHT,
        "bwImage": f"levels/{session_id}/bw.png",
        "colorImage": f"levels/{session_id}/color.png",
        "dogs": [],
    }))

    sprite_img = Image.new("RGBA", (40, 40), (200, 60, 60, 255))
    sprite_img.save(dog_dir / "sprite_000.png")
    sprite_img.save(dog_dir / "variant_000.png")
    (dog_dir / "sprite_000.json").write_text(json.dumps({
        "image": "dogs/dog_00/sprite_000.png",
        "spriteBox": [x - 20, y - 20, x + 20, y + 20],
        "cleanupBox": [x - 25, y - 25, x + 25, y + 25],
        "width": 40,
        "height": 40,
        "anchorX": 0.5,
        "anchorY": 0.5,
    }))

    (sdir / "session.json").write_text(json.dumps({
        "mode": "portrait",
        "style": "bold_cardboard",
        "dogs": [{"index": 0, "activeVariant": 0}],
    }))
    return sdir


@pytest.fixture(autouse=True)
def _sprite_quality_gate_off(monkeypatch):
    # These tests exercise manifest atomicity/replay with sprite-less fixture
    # packages; sprite quality has its own coverage in test_export_gate.py.
    monkeypatch.setenv("FTD_SPRITE_QUALITY_GATE", "0")


@pytest.fixture(autouse=True)
def _clean_approval_ledger(isolated_session):
    isolated_session._CATALOG_APPROVAL_REQUESTS.clear()
    yield
    isolated_session._CATALOG_APPROVAL_REQUESTS.clear()


def _catalog_revision(sess) -> str | None:
    manifest = sess.load_catalog_manifest()
    return manifest.get("catalogRevision") if manifest else None


def test_approve_same_request_id_is_replay_protected(isolated_session):
    sess = isolated_session
    _build_exportable_session(sess, "publish_test_a1b2")

    first = sess.approve_level_for_catalog("publish_test_a1b2", request_id="req-11111111")
    revision_after_first = _catalog_revision(sess)
    package = sess.GAME_PUBLIC_LEVELS / "publish_test_a1b2" / "level.json"
    bytes_after_first = package.read_bytes()
    mtime_after_first = package.stat().st_mtime_ns

    second = sess.approve_level_for_catalog("publish_test_a1b2", request_id="req-11111111")

    assert second == first, "same requestId must return the remembered result"
    assert _catalog_revision(sess) == revision_after_first
    assert package.read_bytes() == bytes_after_first
    assert package.stat().st_mtime_ns == mtime_after_first, "package bytes must not be rewritten on replay"


def test_approve_different_request_ids_advance_twice(isolated_session):
    sess = isolated_session
    _build_exportable_session(sess, "publish_test_c3d4")

    sess.approve_level_for_catalog("publish_test_c3d4", request_id="req-22222222")
    first_revision = _catalog_revision(sess)
    sess.approve_level_for_catalog("publish_test_c3d4", request_id="req-33333333")
    second_revision = _catalog_revision(sess)

    assert first_revision != second_revision, "distinct requestIds document revision-per-approve semantics"
    levels = sess.load_catalog_manifest()["levels"]
    assert [entry["id"] for entry in levels] == ["publish_test_c3d4"], "re-approve replaces, never duplicates"


def test_bundle_upsert_is_idempotent(isolated_session):
    sess = isolated_session
    _build_exportable_session(sess, "publish_test_e5f6")
    sess.approve_level_for_catalog("publish_test_e5f6", request_id="req-44444444")

    sess.upsert_bundled_manifest_level("publish_test_e5f6")
    sess.upsert_bundled_manifest_level("publish_test_e5f6")

    manifest = sess.load_bundled_manifest()
    ids = [entry["id"] for entry in manifest["levels"]]
    assert ids == ["publish_test_e5f6"]


def test_catalog_required_bytes_counts_each_declared_asset(isolated_session):
    sess = isolated_session
    session_id = "publish_test_bytes1"
    _build_exportable_session(sess, session_id)
    sess.export_to_game(session_id)

    public_dir = sess.GAME_PUBLIC_LEVELS / session_id
    (public_dir / "bg_00.png").write_bytes((public_dir / "color.png").read_bytes())

    from levelbuilder.api import public_levels

    entry = public_levels.public_level_catalog_entry(
        sess.GAME_PUBLIC_LEVELS,
        session_id,
        catalog_revision="catalog-test",
    )
    package = entry["package"]

    assert package["requiredBytes"] == sum(
        asset["size"] for asset in package["requiredAssets"]
    )


def test_refused_export_leaves_manifests_and_no_package(isolated_session):
    sess = isolated_session
    from levelbuilder.api.export_gate import ExportGateError

    # Establish real manifests first via a good level.
    _build_exportable_session(sess, "publish_test_good1")
    sess.approve_level_for_catalog("publish_test_good1", request_id="req-55555555")
    sess.upsert_bundled_manifest_level("publish_test_good1")

    catalog_path = sess.GAME_PUBLIC_LEVELS / "catalog-manifest.json"
    bundled_path = sess.GAME_PUBLIC_LEVELS / "bundled-manifest.json"
    catalog_before = catalog_path.read_bytes()
    bundled_before = bundled_path.read_bytes()

    # Out-of-bounds hitbox: passes the session-side checks, refused by the
    # schema/geometry gate. enforce_visibility=False so the gate (not the
    # advisory visibility geometry) is what refuses.
    _build_exportable_session(sess, "publish_test_bad02", dog_xy=(WIDTH + 500, 700))
    with pytest.raises(ExportGateError):
        sess.export_to_game("publish_test_bad02", enforce_visibility=False)

    assert not (sess.GAME_PUBLIC_LEVELS / "publish_test_bad02").exists(), "refused package must be removed"
    assert catalog_path.read_bytes() == catalog_before
    assert bundled_path.read_bytes() == bundled_before


def test_staging_orphans_are_not_levels(isolated_session):
    sess = isolated_session
    from levelbuilder.api.export_gate import validate_corpus

    _build_exportable_session(sess, "publish_test_g7h8")
    sess.approve_level_for_catalog("publish_test_g7h8", request_id="req-66666666")

    orphan = sess.GAME_PUBLIC_LEVELS / ".catalog-staging-publish_test_g7h8-deadbeef"
    orphan.mkdir()
    (orphan / "level.json").write_text("{definitely not json")

    summary = validate_corpus(sess.GAME_PUBLIC_LEVELS)
    assert summary["levels"] == 1, "orphan staging dirs must not count as levels"

    candidates = sess.list_catalog_candidates(include_tombstoned=True)
    assert [c["id"] for c in candidates if c["id"].startswith(".")] == []


def test_magenta_detection_sprites_make_whole_image_exportable(
    isolated_session, monkeypatch
):
    sess = isolated_session
    from levelbuilder.api import inpaint

    session_id = "publish_magenta_whole_image"
    sdir = _build_exportable_session(sess, session_id)
    (sdir / "session.json").write_text(json.dumps({
        "mode": "portrait",
        "style": "clean_old_cartoon",
        "inpaint_mode": "magenta",
        "dogs": [{"index": 0, "activeVariant": None}],
    }))
    for path in (sdir / "dogs").rglob("*"):
        if path.is_file():
            path.unlink()

    def fake_semantic_alpha(clean_crop, painted, hitbox, box, relaxed):
        alpha = Image.new("L", painted.size, 0)
        alpha.paste(255, (20, 20, painted.width - 20, painted.height - 20))
        return alpha

    monkeypatch.setattr(inpaint, "_semantic_sprite_alpha", fake_semantic_alpha)
    result = sess.materialize_detection_sprites(
        session_id,
        detections=[{
            "x": 364,
            "y": 680,
            "width": 40,
            "height": 40,
            "confidence": 0.99,
        }],
    )

    assert result["materialized"] == 1
    result = sess.export_to_game(session_id, enforce_visibility=False)

    assert result["levelId"] == session_id
    exported = json.loads(
        (sess.GAME_PUBLIC_LEVELS / session_id / "level.json").read_text()
    )
    assert exported["dogs"][0]["id"] == "dog_00"
    assert exported["dogs"][0]["sprite"]["cleanup"]
