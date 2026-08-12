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


def test_exact_legacy_hitbox_approval_is_restored_without_human_rework(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore
    from levelbuilder.api.corpus_migration import (
        apply_level_plan,
        plan_legacy_level,
        restore_verified_legacy_hitbox_review,
    )

    session, public = _legacy_level(tmp_path)
    hitboxes = json.loads((session / "hitboxes.json").read_text())
    digest = hashlib.sha256(
        json.dumps(hitboxes, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    _write_json(session / "hitbox-review.json", {
        "approved": True,
        "reviewedAt": "2026-08-10T15:40:26+00:00",
        "source": "editor",
        "hitboxesSha256": digest,
        "hitboxCount": 1,
    })
    apply_level_plan(plan_legacy_level(session, public, archived=False), session, tmp_path / "journals")

    result = restore_verified_legacy_hitbox_review(session)

    assert result["restored"] is True
    read = CanonicalRevisionStore(session).read()
    assert read.snapshot["reviews"]["hitboxes"]["reviewedAt"] == "2026-08-10T15:40:26+00:00"
    assert read.snapshot["reviews"]["hitboxes"]["reviewer"] == "human:legacy-verified"


def test_changed_hitboxes_cannot_restore_legacy_approval(tmp_path):
    from levelbuilder.api.corpus_migration import (
        apply_level_plan,
        plan_legacy_level,
        restore_verified_legacy_hitbox_review,
    )

    session, public = _legacy_level(tmp_path)
    review = json.loads((session / "hitbox-review.json").read_text())
    review["hitboxesSha256"] = "0" * 64
    review["hitboxCount"] = 1
    _write_json(session / "hitbox-review.json", review)
    apply_level_plan(plan_legacy_level(session, public, archived=False), session, tmp_path / "journals")

    result = restore_verified_legacy_hitbox_review(session)

    assert result == {"levelId": "example", "restored": False, "reason": "hitbox_hash_mismatch"}


def test_exact_legacy_final_cutout_approval_is_restored(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore
    from levelbuilder.api.corpus_migration import (
        apply_level_plan,
        plan_legacy_level,
        restore_verified_legacy_final_cutout_review,
        restore_verified_legacy_hitbox_review,
    )

    session, public = _legacy_level(tmp_path)
    level = {
        "id": "example",
        "dogs": [{
            "id": "dog_00", "x": 20, "y": 20, "r": 8,
            "sprite": {
                "image": "levels/example/dogs/dog_00/sprite_000.png",
                "x": 12, "y": 12, "width": 16, "height": 16,
                "cleanup": {"x": 8, "y": 8, "width": 24, "height": 24},
                "anchorX": 0.5, "anchorY": 0.5, "flipX": False, "flipY": False,
            },
        }],
    }
    _write_json(session / "level.json", level)
    scene_digest = _digest(session / "color.png")
    sprite_digest = _digest(session / "dogs" / "dog_00" / "sprite_000.png")
    _write_json(session / "golden-review.json", {
        "approved": True,
        "reviewedAt": "2026-08-10T08:20:00+00:00",
        "levelSha256": _digest(session / "level.json"),
        "sceneSha256": scene_digest,
        "birds": [{
            "dogId": "dog_00",
            "sprite": "dogs/dog_00/sprite_000.png",
            "spriteSha256": sprite_digest,
            "spriteBox": [12, 12, 28, 28],
            "flipX": False,
            "flipY": False,
        }],
    })
    hitboxes = json.loads((session / "hitboxes.json").read_text())
    hitbox_review = json.loads((session / "hitbox-review.json").read_text())
    hitbox_review.update({
        "hitboxesSha256": hashlib.sha256(
            json.dumps(hitboxes, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "hitboxCount": 1,
    })
    _write_json(session / "hitbox-review.json", hitbox_review)
    apply_level_plan(plan_legacy_level(session, public, archived=False), session, tmp_path / "journals")
    restore_verified_legacy_hitbox_review(session)

    result = restore_verified_legacy_final_cutout_review(session)

    assert result["restored"] is True
    read = CanonicalRevisionStore(session).read()
    assert read.snapshot["reviews"]["finalCutouts"]["reviewer"] == "human:legacy-verified"


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


def test_cleanup_identity_repair_accepts_exact_bird_id_set_quarantine(tmp_path):
    from levelbuilder.api.corpus_migration import (
        apply_level_plan,
        plan_legacy_level,
        propose_cleanup_identity_repair,
    )

    session, public = _legacy_level(tmp_path)
    plan = plan_legacy_level(session, public, archived=False)
    plan = type(plan)(plan.level_id, "quarantine", ("bird_id_set_mismatch",))
    apply_level_plan(plan, session, tmp_path / "quarantine-journal")

    result = propose_cleanup_identity_repair(session)

    assert result["method"] == "cleanup-containment"
    assert result["bindings"][0]["birdId"] == BIRD_ID


def test_cleanup_identity_repair_refuses_ambiguous_geometry_without_writes(tmp_path):
    from levelbuilder.api.corpus_migration import (
        CleanupIdentityRepairError,
        apply_level_plan,
        checksum_tree,
        plan_legacy_level,
        repair_cleanup_identity_bindings,
    )

    session, public = _legacy_level(tmp_path, cleanup_box=(40, 40, 50, 50))
    sidecar_path = session / "dogs" / "dog_00" / "sprite_000.json"
    sidecar = json.loads(sidecar_path.read_text())
    sidecar["spriteBox"] = [40, 40, 50, 50]
    _write_json(sidecar_path, sidecar)
    plan = plan_legacy_level(session, public, archived=False)
    # Force the same repair-eligible issue class while keeping ambiguous geometry.
    plan = type(plan)(plan.level_id, "quarantine", (f"{BIRD_ID}:cleanup_misses_hitbox",))
    apply_level_plan(plan, session, tmp_path / "quarantine-journal")
    before = checksum_tree(session)

    try:
        repair_cleanup_identity_bindings(session, public, tmp_path / "repair-journal")
    except CleanupIdentityRepairError as error:
        assert "low-confidence global assignment" in str(error)
    else:
        raise AssertionError("ambiguous cleanup repair should fail")
    assert checksum_tree(session) == before


def test_cleanup_identity_repair_uses_high_confidence_global_sprite_assignment(tmp_path):
    from levelbuilder.api.corpus_migration import (
        apply_level_plan,
        plan_legacy_level,
        repair_cleanup_identity_bindings,
    )

    session, public = _legacy_level(tmp_path, cleanup_box=(0, 0, 64, 64))
    second_id = "bird_018f4f34-cc65-7c21-b59d-9b44c8c02a34"
    dog_dir = session / "dogs" / "dog_01"
    dog_dir.mkdir()
    Image.new("RGBA", (16, 16), (0, 255, 0, 255)).save(dog_dir / "sprite_000.png")
    _write_json(dog_dir / "sprite_000.json", {
        "spriteBox": [38, 38, 50, 50], "cleanupBox": [0, 0, 64, 64],
        "anchorX": 0.5, "anchorY": 0.5,
    })
    raw = json.loads((session / "session.json").read_text())
    raw["dogs"].append({"id": second_id, "index": 1, "activeVariant": 0})
    _write_json(session / "session.json", raw)
    _write_json(session / "hitboxes.json", [
        {"id": BIRD_ID, "x": 20, "y": 20, "r": 8},
        {"id": second_id, "x": 44, "y": 44, "r": 8},
    ])
    plan = plan_legacy_level(session, public, archived=False)
    plan = type(plan)(plan.level_id, "quarantine", (
        f"{BIRD_ID}:cleanup_misses_hitbox",
        f"{second_id}:cleanup_misses_hitbox",
    ))
    apply_level_plan(plan, session, tmp_path / "quarantine-journal")

    result = repair_cleanup_identity_bindings(session, public, tmp_path / "repair-journal")

    assert result["method"] == "sprite-center-hungarian"
    repaired = json.loads((session / "session.json").read_text())
    assert [dog["id"] for dog in repaired["dogs"]] == [BIRD_ID, second_id]
    for index, hitbox in enumerate(json.loads((session / "hitboxes.json").read_text())):
        sidecar = json.loads((session / "dogs" / f"dog_{index:02d}" / "sprite_000.json").read_text())
        x0, y0, x1, y1 = sidecar["cleanupBox"]
        assert x0 <= hitbox["x"] <= x1 and y0 <= hitbox["y"] <= y1
        assert sidecar["cleanupBox"] == [0, 0, 64, 64]


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
