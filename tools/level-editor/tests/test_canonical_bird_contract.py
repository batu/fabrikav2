import hashlib
import json
import multiprocessing
from pathlib import Path

import pytest


def _asset(name: str, digest: str) -> dict:
    return {"path": name, "sha256": digest * 64, "bytes": 12}


def materialize_snapshot_assets(root: Path, snapshot: dict) -> None:
    """FF-1: commits verify referenced bytes on disk — write each descriptor's file
    with real content and stamp the descriptor with the true digest."""
    seen: dict[str, bytes] = {}
    def _fix(descriptor: dict) -> None:
        path = root / descriptor["path"]
        if descriptor["path"] not in seen:
            path.parent.mkdir(parents=True, exist_ok=True)
            data = f"asset:{descriptor['path']}".encode()
            path.write_bytes(data)
            seen[descriptor["path"]] = data
        data = seen[descriptor["path"]]
        descriptor["sha256"] = hashlib.sha256(data).hexdigest()
        descriptor["bytes"] = len(data)
    _fix(snapshot["assets"]["scene"])
    _fix(snapshot["assets"]["cleanBackground"])
    _fix(snapshot["restore"]["asset"])
    snapshot["restore"]["sourceSceneSha256"] = snapshot["assets"]["scene"]["sha256"]
    for bird in snapshot["birds"]:
        _fix(bird["sprite"]["asset"])
        bird["activeGeneration"]["inputSceneSha256"] = snapshot["assets"]["scene"]["sha256"]
        bird["cleanup"]["sourceSpriteSha256"] = bird["sprite"]["asset"]["sha256"]


def _snapshot(*, presentation_order: int = 0, flip_x: bool = False) -> dict:
    scene = _asset("color.png", "a")
    clean = _asset("bg_00.png", "b")
    sprite = _asset("dogs/dog_00/sprite_000.png", "c")
    return {
        "schemaVersion": 1,
        "sessionId": "example",
        "assets": {"scene": scene, "cleanBackground": clean},
        "restore": {"asset": clean, "sourceSceneSha256": scene["sha256"]},
        "birds": [{
            "birdId": "bird_018f4f34-cc65-7c21-b59d-9b44c8c02a33",
            "compatibilitySlot": "dog_00",
            "presentationOrder": presentation_order,
            "hitbox": {"x": 10, "y": 20, "r": 5},
            "activeGeneration": {
                "generationId": "generation_1",
                "inputSceneSha256": scene["sha256"],
            },
            "sprite": {
                "asset": sprite,
                "placement": {"x": 5, "y": 15, "width": 10, "height": 12},
                "anchorX": 0.5,
                "anchorY": 0.5,
                "flipX": flip_x,
                "flipY": False,
            },
            "cleanup": {
                "x": 4, "y": 14, "width": 12, "height": 14,
                "sourceSpriteSha256": sprite["sha256"],
            },
        }],
        "reviews": {},
        "operational": {"archived": False},
    }


def _race_commit(root: str, expected: str | None, queue) -> None:
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore

    snapshot = _snapshot()
    materialize_snapshot_assets(Path(root), snapshot)
    snapshot["operational"]["worker"] = multiprocessing.current_process().name
    snapshot["birds"][0]["hitbox"]["x"] += int(multiprocessing.current_process().name.rsplit("-", 1)[-1])
    try:
        pointer = CanonicalRevisionStore(Path(root)).commit(snapshot, expected_content_revision=expected)
        queue.put(("ok", pointer.content_revision))
    except Exception as exc:  # pragma: no cover - asserted in parent
        queue.put((type(exc).__name__, str(exc)))


def test_contract_rejects_duplicate_bird_ids_and_slots():
    from levelbuilder.api.canonical_bird_contract import ContractValidationError, validate_snapshot

    payload = _snapshot()
    payload["birds"].append(dict(payload["birds"][0]))
    with pytest.raises(ContractValidationError, match="duplicate birdId"):
        validate_snapshot(payload)

    payload = _snapshot()
    payload["birds"][0]["birdId"] = "dog_00"
    with pytest.raises(ContractValidationError, match="birdId is invalid"):
        validate_snapshot(payload)

    payload["birds"][0]["birdId"] = "mutable-index"
    with pytest.raises(ContractValidationError, match="birdId is invalid"):
        validate_snapshot(payload)

    payload["birds"][0]["birdId"] = "018f4f34-cc65-7c21-b59d-9b44c8c02a33"
    validate_snapshot(payload)


def test_content_and_operational_hash_domains_are_separate():
    from levelbuilder.api.canonical_bird_contract import snapshot_revisions

    baseline = snapshot_revisions(_snapshot())
    reordered = snapshot_revisions(_snapshot(presentation_order=9))
    flipped = snapshot_revisions(_snapshot(flip_x=True))
    reslotted = _snapshot()
    reslotted["birds"][0]["compatibilitySlot"] = "dog_07"
    reslotted = snapshot_revisions(reslotted)

    assert reordered.content_revision == baseline.content_revision
    assert reordered.operational_revision != baseline.operational_revision
    assert flipped.content_revision != baseline.content_revision
    assert reslotted.content_revision != baseline.content_revision


def test_provenance_and_review_assertions_are_validated():
    from levelbuilder.api.canonical_bird_contract import ContractValidationError, snapshot_revisions, validate_snapshot

    payload = _snapshot()
    payload["birds"][0]["cleanup"]["sourceSpriteSha256"] = "d" * 64
    with pytest.raises(ContractValidationError, match="cleanup provenance"):
        validate_snapshot(payload)

    payload = _snapshot()
    revision = snapshot_revisions(payload).content_revision
    payload["reviews"]["hitboxes"] = {
        "contentRevision": revision,
        "reviewer": "human:batu",
        "reviewedAt": "2026-08-11T00:00:00Z",
    }
    validate_snapshot(payload)
    payload["reviews"]["hitboxes"]["contentRevision"] = "sha256:" + "0" * 64
    with pytest.raises(ContractValidationError, match="review contentRevision"):
        validate_snapshot(payload)


def test_pointer_states_never_fall_back_to_public_projection(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState, CanonicalRevisionStore

    authoring = tmp_path / "authoring"
    public = tmp_path / "public"
    public.mkdir()
    (public / "canonical-current.json").write_text(json.dumps({"revisionFile": "projection.json"}))
    store = CanonicalRevisionStore(authoring)
    assert store.read().state is CanonicalReadState.MIGRATION_REQUIRED

    store.staging_dir.mkdir(parents=True)
    (store.staging_dir / "complete.json").write_text("{}")
    assert store.read().state is CanonicalReadState.ORPHANED_STAGE

    store.pointer_path.write_text("not json")
    assert store.read().state is CanonicalReadState.QUARANTINED_INTEGRITY
    store.pointer_path.write_text(json.dumps({"revisionFile": "missing.json"}))
    assert store.read().state is CanonicalReadState.QUARANTINED_INTEGRITY


def test_commit_is_fsynced_cas_and_cross_process_locked(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState, CanonicalRevisionStore

    store = CanonicalRevisionStore(tmp_path / "session")
    first = _snapshot()
    materialize_snapshot_assets(tmp_path / "session", first)
    initial = store.commit(first, expected_content_revision=None)
    assert store.read().state is CanonicalReadState.VALID_CURRENT
    objects = list((tmp_path / "session" / ".canonical" / "objects").iterdir())
    assert len(objects) == 3  # scene, clean bg (=restore), sprite — deduplicated CAS

    queue = multiprocessing.get_context("spawn").Queue()
    workers = [
        multiprocessing.get_context("spawn").Process(
            target=_race_commit, args=(str(tmp_path / "session"), initial.content_revision, queue)
        )
        for _ in range(2)
    ]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(10)
        assert worker.exitcode == 0
    results = [queue.get(timeout=2), queue.get(timeout=2)]
    assert sorted(result[0] for result in results) == ["RevisionConflictError", "ok"]


def test_contract_fixture_round_trips_as_canonical_json(tmp_path):
    from levelbuilder.api.canonical_bird_contract import canonical_json, snapshot_revisions, validate_snapshot

    payload = _snapshot()
    encoded = canonical_json(validate_snapshot(payload))
    assert canonical_json(validate_snapshot(json.loads(encoded))) == encoded
    assert snapshot_revisions(payload).content_revision == "sha256:ea523da1375bd6fbcfb7edcf4ca6673a6ebaa1dc219f4067ea9ee0d660fb8c23"


def test_review_invalidation_follows_artifact_dependencies():
    from levelbuilder.api.canonical_bird_contract import (
        bless_snapshot,
        invalidate_reviews,
    )

    blessed = bless_snapshot(
        bless_snapshot(
            _snapshot(),
            review_kind="hitboxes",
            reviewer="human:batu",
            reviewed_at="2026-08-11T01:00:00Z",
        ),
        review_kind="finalCutouts",
        reviewer="human:batu",
        reviewed_at="2026-08-11T01:01:00Z",
    )

    sprite_changed = invalidate_reviews(blessed, changed_artifacts={"spritePlacement"})
    assert set(sprite_changed["reviews"]) == {"hitboxes"}
    assert sprite_changed["operational"]["reviewHistory"][-1]["kind"] == "finalCutouts"

    hitbox_changed = invalidate_reviews(blessed, changed_artifacts={"hitboxes"})
    assert hitbox_changed["reviews"] == {}
    assert {entry["kind"] for entry in hitbox_changed["operational"]["reviewHistory"]} == {
        "hitboxes", "finalCutouts",
    }

    operational_only = invalidate_reviews(blessed, changed_artifacts={"archive"})
    assert operational_only["reviews"] == blessed["reviews"]


def test_blessing_requires_attributable_human_and_exact_current_revision():
    from levelbuilder.api.canonical_bird_contract import (
        ContractValidationError,
        bless_snapshot,
        snapshot_revisions,
    )

    with pytest.raises(ContractValidationError, match="attributable human"):
        bless_snapshot(
            _snapshot(),
            review_kind="hitboxes",
            reviewer="automation:repair",
            reviewed_at="2026-08-11T01:00:00Z",
        )

    blessed = bless_snapshot(
        _snapshot(),
        review_kind="hitboxes",
        reviewer="human:batu",
        reviewed_at="2026-08-11T01:00:00Z",
    )
    assert blessed["reviews"]["hitboxes"]["contentRevision"] == snapshot_revisions(blessed).content_revision


def test_commit_accepts_digest_addressed_staged_bytes_and_rejects_absent_assets(tmp_path):
    """FF-1: declared bytes may live in digest-addressed staging (promote's
    crash-safe scene lane) — the CAS ingests them at commit. Bytes existing
    nowhere fail the commit."""
    import hashlib as _hashlib

    from levelbuilder.api.canonical_bird_contract import (
        CanonicalRevisionStore,
        ContractValidationError,
    )

    root = tmp_path / "session"
    store = CanonicalRevisionStore(root)
    snapshot = _snapshot()
    materialize_snapshot_assets(root, snapshot)
    pointer = store.commit(snapshot, expected_content_revision=None)

    # Replace the scene: bytes staged digest-addressed, path file still old.
    staged = root / ".canonical" / "staging"
    staged.mkdir(parents=True, exist_ok=True)
    new_scene = b"composed-scene-bytes"
    digest = _hashlib.sha256(new_scene).hexdigest()
    (staged / f"scene-{digest}.png").write_bytes(new_scene)
    nxt = store.read().snapshot
    nxt["assets"]["scene"] = {"path": "color.png", "sha256": digest, "bytes": len(new_scene)}
    nxt["restore"]["sourceSceneSha256"] = digest
    for bird in nxt["birds"]:
        bird["activeGeneration"]["inputSceneSha256"] = digest
    pointer = store.commit(nxt, expected_content_revision=pointer.content_revision)
    assert (root / ".canonical" / "objects" / f"{digest}.png").exists()

    # Declared bytes existing nowhere: refused.
    ghost = store.read().snapshot
    ghost["assets"]["scene"] = {"path": "color.png", "sha256": "f" * 64, "bytes": 3}
    ghost["restore"]["sourceSceneSha256"] = "f" * 64
    for bird in ghost["birds"]:
        bird["activeGeneration"]["inputSceneSha256"] = "f" * 64
    with pytest.raises(ContractValidationError):
        store.commit(ghost, expected_content_revision=pointer.content_revision)


def test_read_fails_closed_on_malformed_pointers_and_tampered_revisions(tmp_path):
    """CR-item1 P0s: non-object pointer, wrong pointer schema, and tampered
    revision bytes all read as QUARANTINED_INTEGRITY, never crash."""
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState, CanonicalRevisionStore

    store = CanonicalRevisionStore(tmp_path / "session")
    snapshot = _snapshot()
    materialize_snapshot_assets(tmp_path / "session", snapshot)
    pointer = store.commit(snapshot, expected_content_revision=None)

    store.pointer_path.write_text("[]")
    assert store.read().state is CanonicalReadState.QUARANTINED_INTEGRITY
    store.pointer_path.write_text("null")
    assert store.read().state is CanonicalReadState.QUARANTINED_INTEGRITY
    store.pointer_path.write_text(json.dumps({
        "schemaVersion": 9, "revisionFile": pointer.revision_file,
        "contentRevision": pointer.content_revision,
        "operationalRevision": pointer.operational_revision,
    }))
    result = store.read()
    assert result.state is CanonicalReadState.QUARANTINED_INTEGRITY
    assert "schemaVersion" in (result.detail or "")

    # Restore pointer, tamper the revision file bytes.
    store._atomic_pointer_write(pointer)
    revision_path = store.revisions_dir / pointer.revision_file
    revision_path.write_text(revision_path.read_text() + " ")
    result = store.read()
    assert result.state is CanonicalReadState.QUARANTINED_INTEGRITY
    assert "match its name" in (result.detail or "")


def test_commit_verifies_preexisting_cas_objects_and_painted_assets(tmp_path):
    """CR-item1 P0/P1: a corrupt digest-named CAS object is repaired at commit;
    activeGeneration.paintedAsset descriptors are verified like every other asset."""
    import hashlib as _hashlib

    from levelbuilder.api.canonical_bird_contract import (
        CanonicalRevisionStore,
        ContractValidationError,
    )

    root = tmp_path / "session"
    store = CanonicalRevisionStore(root)
    snapshot = _snapshot()
    materialize_snapshot_assets(root, snapshot)

    # Pre-seed a corrupt object under the scene's digest: commit must repair it.
    scene_sha = snapshot["assets"]["scene"]["sha256"]
    objects = root / ".canonical" / "objects"
    objects.mkdir(parents=True)
    (objects / f"{scene_sha}.png").write_bytes(b"corrupt")
    pointer = store.commit(snapshot, expected_content_revision=None)
    repaired = (objects / f"{scene_sha}.png").read_bytes()
    assert _hashlib.sha256(repaired).hexdigest() == scene_sha

    # paintedAsset with bytes that exist nowhere refuses to commit.
    nxt = store.read().snapshot
    nxt["birds"][0]["activeGeneration"]["paintedAsset"] = {
        "path": "dogs/dog_00/painted_000.png", "sha256": "e" * 64, "bytes": 9,
    }
    with pytest.raises(ContractValidationError, match="paintedAsset"):
        store.commit(nxt, expected_content_revision=pointer.content_revision)


def test_stale_commit_refuses_before_hashing_assets(tmp_path, monkeypatch):
    """Merge-review perf finding: a known-stale commit must 409 on the cheap
    revision check without reading/hashing megabytes of asset bytes."""
    from levelbuilder.api import canonical_bird_contract as C

    store = C.CanonicalRevisionStore(tmp_path / "session")
    snapshot = _snapshot()
    materialize_snapshot_assets(tmp_path / "session", snapshot)
    store.commit(snapshot, expected_content_revision=None)

    calls = {"n": 0}
    original = C.CanonicalRevisionStore.verify_and_store_assets

    def counting(self, snap):
        calls["n"] += 1
        return original(self, snap)

    monkeypatch.setattr(C.CanonicalRevisionStore, "verify_and_store_assets", counting)
    stale = _snapshot()
    materialize_snapshot_assets(tmp_path / "session", stale)
    stale["birds"][0]["hitbox"]["x"] = 999
    with pytest.raises(C.RevisionConflictError):
        store.commit(stale, expected_content_revision="sha256:" + "0" * 64)
    assert calls["n"] == 0  # refused before any asset bytes were touched
