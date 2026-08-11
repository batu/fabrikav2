import json
import multiprocessing
from pathlib import Path

import pytest


def _asset(name: str, digest: str) -> dict:
    return {"path": name, "sha256": digest * 64, "bytes": 12}


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
    initial = store.commit(_snapshot(), expected_content_revision=None)
    assert store.read().state is CanonicalReadState.VALID_CURRENT

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
