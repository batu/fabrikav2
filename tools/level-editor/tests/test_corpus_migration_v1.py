import hashlib
import json
from pathlib import Path

from PIL import Image


BIRD_ID = "bird_018f4f34-cc65-7c21-b59d-9b44c8c02a33"


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def _legacy_level(
    tmp_path: Path,
    *,
    cleanup_box=(8, 8, 32, 32),
    restore_color="gray",
) -> tuple[Path, Path]:
    session = tmp_path / "source" / "example"
    public = tmp_path / "public" / "example"
    dog_dir = session / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    public.mkdir(parents=True)
    Image.new("RGB", (64, 64), "white").save(session / "color.png")
    Image.new("RGB", (64, 64), "gray").save(session / "bg_00.png")
    Image.new("RGB", (64, 64), restore_color).save(public / "bg_00.webp")
    _write_json(public / "level.json", {"id": "example", "dogs": []})
    Image.new("RGBA", (16, 16), (255, 0, 0, 255)).save(dog_dir / "sprite_000.png")
    _write_json(session / "session.json", {
        "selected_bg": 0,
        "dogs": [{"id": BIRD_ID, "index": 0, "activeVariant": 0}],
    })
    _write_json(session / "hitboxes.json", [{"id": BIRD_ID, "x": 20, "y": 20, "r": 8}])
    _write_json(dog_dir / "sprite_000.json", {
        "spriteBox": [12, 12, 28, 28],
        "cleanupBox": list(cleanup_box),
        "anchorX": 0.5,
        "anchorY": 0.5,
    })
    _write_json(session / "hitbox-review.json", {"approved": True, "reviewedAt": "legacy"})
    _write_json(session / "golden-review.json", {"approved": True, "reviewedAt": "legacy-final"})
    return session, public


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_preview_and_apply_are_byte_safe_idempotent_and_require_reverification(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState, CanonicalRevisionStore
    from levelbuilder.api.corpus_migration import apply_level_plan, checksum_tree, plan_legacy_level

    session, public = _legacy_level(tmp_path)
    source_images = {path: _digest(path) for path in session.rglob("*.png")}
    before_preview = checksum_tree(session)

    plan = plan_legacy_level(session, public, archived=False)

    assert plan.action == "migrate"
    assert checksum_tree(session) == before_preview
    assert plan.snapshot["reviews"] == {}
    assert plan.snapshot["operational"]["migration"]["state"] == "verification_required"
    assert plan.snapshot["operational"]["reviewHistory"][0]["verificationRequired"] is True

    journal_root = tmp_path / "journals"
    first = apply_level_plan(plan, session, journal_root)
    journal_bytes = (journal_root / "example.json").read_bytes()
    second = apply_level_plan(plan, session, journal_root)
    assert second == first
    assert (journal_root / "example.json").read_bytes() == journal_bytes
    assert all(_digest(path) == digest for path, digest in source_images.items())
    read = CanonicalRevisionStore(session).read()
    assert read.state is CanonicalReadState.VALID_CURRENT
    assert read.snapshot["birds"][0]["birdId"] == BIRD_ID

    replay = plan_legacy_level(session, public, archived=False)
    assert replay.action == "unchanged"


def test_ambiguous_level_is_quarantined_and_cannot_fall_back(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState, CanonicalRevisionStore
    from levelbuilder.api.corpus_migration import apply_level_plan, plan_legacy_level

    session, public = _legacy_level(tmp_path, cleanup_box=(40, 40, 50, 50))
    plan = plan_legacy_level(session, public, archived=False)
    assert plan.action == "quarantine"
    assert f"{BIRD_ID}:cleanup_misses_hitbox" in plan.issues

    apply_level_plan(plan, session, tmp_path / "journals")
    read = CanonicalRevisionStore(session).read()
    assert read.state is CanonicalReadState.QUARANTINED_INTEGRITY
    assert "cleanup_misses_hitbox" in read.detail
    replay = plan_legacy_level(session, public, archived=False)
    assert replay.action == "quarantine"
    assert replay.issues == plan.issues


def test_cleanup_identity_repair_requires_and_applies_complete_bijection(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState, CanonicalRevisionStore
    from levelbuilder.api.corpus_migration import (
        apply_level_plan,
        plan_legacy_level,
        repair_cleanup_identity_bindings,
    )

    session, public = _legacy_level(tmp_path)
    second_id = "bird_018f4f34-cc65-7c21-b59d-9b44c8c02a34"
    dog_dir = session / "dogs" / "dog_01"
    dog_dir.mkdir()
    Image.new("RGBA", (16, 16), (0, 255, 0, 255)).save(dog_dir / "sprite_000.png")
    _write_json(dog_dir / "sprite_000.json", {
        "spriteBox": [36, 36, 52, 52], "cleanupBox": [8, 8, 32, 32],
        "anchorX": 0.5, "anchorY": 0.5,
    })
    raw = json.loads((session / "session.json").read_text())
    raw["dogs"] = [
        {"id": BIRD_ID, "index": 0, "activeVariant": 0},
        {"id": second_id, "index": 1, "activeVariant": 0},
    ]
    _write_json(session / "session.json", raw)
    _write_json(session / "hitboxes.json", [
        {"id": BIRD_ID, "x": 20, "y": 20, "r": 8},
        {"id": second_id, "x": 44, "y": 44, "r": 8},
    ])
    # Swap which reviewed bird each sprite folder's cleanup geometry owns.
    first_sidecar = json.loads((session / "dogs" / "dog_00" / "sprite_000.json").read_text())
    first_sidecar["cleanupBox"] = [36, 36, 52, 52]
    _write_json(session / "dogs" / "dog_00" / "sprite_000.json", first_sidecar)
    plan = plan_legacy_level(session, public, archived=False)
    assert plan.action == "quarantine"
    apply_level_plan(plan, session, tmp_path / "quarantine-journal")
    protected = {
        path.relative_to(session): _digest(path)
        for path in session.rglob("*")
        if path.is_file() and path.name not in {"session.json", "level.json"} and ".canonical" not in path.parts
    }

    result = repair_cleanup_identity_bindings(
        session,
        public,
        tmp_path / "repair-journal",
        preserve_review_kinds=frozenset({"hitboxes", "finalCutouts"}),
    )

    assert [item["birdId"] for item in result["bindings"]] == [second_id, BIRD_ID]
    repaired = json.loads((session / "session.json").read_text())
    assert [dog["id"] for dog in repaired["dogs"]] == [second_id, BIRD_ID]
    assert all(_digest(session / path) == digest for path, digest in protected.items())
    read = CanonicalRevisionStore(session).read()
    assert read.state is CanonicalReadState.VALID_CURRENT
    assert set(read.snapshot["reviews"]) == {"hitboxes", "finalCutouts"}
    assert read.snapshot["reviews"]["hitboxes"]["reviewedAt"] == "legacy"
    assert read.snapshot["reviews"]["finalCutouts"]["reviewedAt"] == "legacy-final"
    assert result["reviewRequired"] is False
    assert not (session / ".canonical" / "quarantine.json").exists()
    assert list((session / ".canonical" / "quarantine-history").glob("*.json"))


def test_cleanup_identity_repair_refuses_ambiguous_geometry_without_writes(tmp_path):
    from levelbuilder.api.corpus_migration import (
        CleanupIdentityRepairError,
        apply_level_plan,
        checksum_tree,
        plan_legacy_level,
        repair_cleanup_identity_bindings,
    )

    session, public = _legacy_level(tmp_path, cleanup_box=(40, 40, 50, 50))
    plan = plan_legacy_level(session, public, archived=False)
    # Force the same repair-eligible issue class while keeping ambiguous geometry.
    plan = type(plan)(plan.level_id, "quarantine", (f"{BIRD_ID}:cleanup_misses_hitbox",))
    apply_level_plan(plan, session, tmp_path / "quarantine-journal")
    before = checksum_tree(session)

    try:
        repair_cleanup_identity_bindings(session, public, tmp_path / "repair-journal")
    except CleanupIdentityRepairError as error:
        assert "contains 0 hitbox centers" in str(error)
    else:
        raise AssertionError("ambiguous cleanup repair should fail")
    assert checksum_tree(session) == before


def test_restore_scene_mismatch_is_quarantined_before_migration(tmp_path):
    from levelbuilder.api.corpus_migration import checksum_tree, plan_legacy_level

    session, public = _legacy_level(tmp_path, restore_color="black")
    before = checksum_tree(session)
    plan = plan_legacy_level(session, public, archived=False)
    assert plan.action == "quarantine"
    assert any(issue.startswith("restore_scene_mismatch:") for issue in plan.issues)
    assert checksum_tree(session) == before


def test_archived_and_public_only_levels_are_not_mutated(tmp_path):
    from levelbuilder.api.corpus_migration import checksum_tree, plan_legacy_level

    session, public = _legacy_level(tmp_path)
    session_before = checksum_tree(session)
    public_before = checksum_tree(public)
    assert plan_legacy_level(session, public, archived=True).action == "skip_archived"
    assert plan_legacy_level(None, public, archived=False).action == "frozen_public"
    assert checksum_tree(session) == session_before
    assert checksum_tree(public) == public_before


def test_api_apply_requires_exact_preview_manifest(app_client, monkeypatch, tmp_path):
    from levelbuilder.api import routes

    session, public = _legacy_level(tmp_path)
    monkeypatch.setattr(routes.S, "LEVELS_DIR", session.parent)
    monkeypatch.setattr(routes.S, "GAME_PUBLIC_LEVELS", public.parent)
    monkeypatch.setattr(routes.S, "WORKSPACE_ROOT", tmp_path / "workspace")
    monkeypatch.setattr(routes.S, "archived_session_ids", lambda: set())

    preview = app_client.get("/api/artifact-integrity-migration")
    assert preview.status_code == 200
    manifest = preview.json()
    assert manifest["levels"][0]["action"] == "migrate"

    stale = app_client.post("/api/artifact-integrity-migration/apply", json={
        "levelIds": ["example"], "expectedManifestSha256": "sha256:stale",
    })
    assert stale.status_code == 409
    assert not (session / ".canonical" / "current.json").exists()

    applied = app_client.post("/api/artifact-integrity-migration/apply", json={
        "levelIds": ["example"], "expectedManifestSha256": manifest["manifestSha256"],
    })
    assert applied.status_code == 200
    assert (session / ".canonical" / "current.json").is_file()
    card = next(item for item in app_client.get("/api/sessions").json() if item["id"] == "example")
    assert card["hitboxesBlessed"] is False
    assert card["cutoutsFinalBlessed"] is False
