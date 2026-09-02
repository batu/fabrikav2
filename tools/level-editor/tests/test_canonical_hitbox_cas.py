from __future__ import annotations

import copy

import pytest

import concurrent.futures
import threading


def _asset(path: str, char: str) -> dict:
    return {"path": path, "sha256": char * 64, "bytes": 1}


def _snapshot(session_id: str) -> dict:
    scene = _asset("color.png", "a")
    clean = _asset("bg.png", "b")
    sprite = _asset("sprite.png", "c")
    return {
        "schemaVersion": 1,
        "sessionId": session_id,
        "assets": {"scene": scene, "cleanBackground": clean},
        "restore": {"asset": clean, "sourceSceneSha256": scene["sha256"]},
        "birds": [{
            "birdId": "bird_one",
            "compatibilitySlot": "dog_00",
            "presentationOrder": 0,
            "hitbox": {"x": 10, "y": 20, "r": 5},
            "activeGeneration": {"generationId": "g1", "inputSceneSha256": scene["sha256"]},
            "sprite": {
                "asset": sprite,
                "placement": {"x": 5, "y": 15, "width": 10, "height": 12},
                "anchorX": 0.5, "anchorY": 0.5, "flipX": False, "flipY": False,
            },
            "cleanup": {"x": 4, "y": 14, "width": 12, "height": 14, "sourceSpriteSha256": sprite["sha256"]},
        }],
        "reviews": {},
        "operational": {},
    }


def _canonical_session(isolated_session, session_id: str):
    isolated_session.create_session(
        session_id,
        scene_prompt="scene",
        dog_prompt="bird",
        style="clean_old_cartoon",
        model="test/model",
        n_options=1,
        n_dogs=1,
    )
    store = isolated_session.canonical_session_store(session_id)
    from conftest import materialize_snapshot_assets
    snapshot = _snapshot(session_id)
    materialize_snapshot_assets(store.session_root, snapshot)
    pointer = store.commit(snapshot, expected_content_revision=None)
    return store, pointer


def test_stale_canonical_hitbox_save_returns_409_without_writing(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_stale_save")
    response = app_client.post(
        "/api/sessions/canonical_stale_save/hitboxes",
        json={
            "expectedContentRevision": "sha256:" + "0" * 64,
            "hitboxes": [{"id": "bird_one", "x": 90, "y": 20, "r": 5}],
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "content_revision_conflict",
        "expectedContentRevision": "sha256:" + "0" * 64,
        "actualContentRevision": pointer.content_revision,
        "changedArtifactClasses": ["hitboxes"],
        # P1.8: a rejection carries server truth for client reconciliation.
        "serverHitboxes": [{"x": 10, "y": 20, "r": 5, "id": "bird_one"}],
    }
    assert store.read().snapshot["birds"][0]["hitbox"]["x"] == 10


def test_canonical_hitbox_save_commits_and_invalidates_reviews(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_save")
    snapshot = store.read().snapshot
    snapshot["reviews"] = {
        "hitboxes": {"contentRevision": pointer.content_revision, "reviewer": "human:batu", "reviewedAt": "now"},
        "finalCutouts": {"contentRevision": pointer.content_revision, "reviewer": "human:batu", "reviewedAt": "now"},
    }
    store.commit(snapshot, expected_content_revision=pointer.content_revision)

    response = app_client.post(
        "/api/sessions/canonical_save/hitboxes",
        json={
            "expectedContentRevision": pointer.content_revision,
            "hitboxes": [{"id": "bird_one", "x": 90, "y": 20, "r": 5}],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["contentRevision"] != pointer.content_revision
    current = store.read().snapshot
    assert current["birds"][0]["hitbox"]["x"] == 90
    assert current["reviews"] == {}
    assert {entry["kind"] for entry in current["operational"]["reviewHistory"]} == {
        "hitboxes", "finalCutouts",
    }


def test_stale_canonical_hitbox_blessing_returns_409(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_stale_bless")
    response = app_client.put(
        "/api/sessions/canonical_stale_bless/hitbox-review",
        json={"approved": True, "expectedContentRevision": "sha256:" + "f" * 64, "humanActor": "human:test"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["actualContentRevision"] == pointer.content_revision
    assert store.read().snapshot["reviews"] == {}


def test_canonical_hitbox_blessing_binds_current_revision(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_bless")
    response = app_client.put(
        "/api/sessions/canonical_bless/hitbox-review",
        json={"approved": True, "expectedContentRevision": pointer.content_revision, "humanActor": "human:test"},
    )
    assert response.status_code == 200
    review = store.read().snapshot["reviews"]["hitboxes"]
    assert review["contentRevision"] == pointer.content_revision
    assert review["reviewer"] == "human:test"


def test_canonical_blessing_requires_attributable_human(app_client, isolated_session):
    _store, pointer = _canonical_session(isolated_session, "canonical_bless_actor")

    response = app_client.put(
        "/api/sessions/canonical_bless_actor/hitbox-review",
        json={"approved": True, "expectedContentRevision": pointer.content_revision},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "human_attribution_required"


def test_legacy_hitbox_save_still_accepts_missing_revision(app_client, isolated_session):
    root = isolated_session.LEVELS_DIR / "legacy_save"
    root.mkdir()
    response = app_client.post(
        "/api/sessions/legacy_save/hitboxes",
        json={"hitboxes": [{"x": 10, "y": 20, "r": 5}]},
    )
    assert response.status_code == 200
    assert response.json()["hitboxes"]  # P1.8: read-back, never a bare 204


def test_session_read_exposes_canonical_revision(app_client, isolated_session):
    _store, pointer = _canonical_session(isolated_session, "canonical_read")

    response = app_client.get("/api/sessions/canonical_read")

    assert response.status_code == 200
    assert response.json()["canonicalState"] == "valid_current"
    assert response.json()["contentRevision"] == pointer.content_revision


def test_canonical_sprite_geometry_is_by_bird_id_and_stales_final_only(isolated_session):
    from levelbuilder.api.canonical_bird_contract import bless_snapshot

    store, pointer = _canonical_session(isolated_session, "canonical_sprite_geometry")
    snapshot = bless_snapshot(
        bless_snapshot(
            store.read().snapshot,
            review_kind="hitboxes",
            reviewer="human:batu",
            reviewed_at="now",
        ),
        review_kind="finalCutouts",
        reviewer="human:batu",
        reviewed_at="now",
    )
    store.commit(snapshot, expected_content_revision=pointer.content_revision)

    result = isolated_session.save_canonical_sprite_geometry_if_present(
        "canonical_sprite_geometry",
        "bird_one",
        sprite_box=[20, 30, 60, 80],
        cleanup_box=[15, 25, 65, 85],
        flip_x=True,
        flip_y=False,
        expected_content_revision=pointer.content_revision,
    )

    assert result is not None
    current = store.read().snapshot
    assert current["birds"][0]["sprite"]["placement"] == {"x": 20, "y": 30, "width": 40, "height": 50}
    assert current["birds"][0]["cleanup"]["x"] == 15
    assert current["birds"][0]["sprite"]["flipX"] is True
    assert set(current["reviews"]) == {"hitboxes"}


def test_canonical_final_bless_requires_current_hitbox_assertion(isolated_session):
    from levelbuilder.api.canonical_bird_contract import ContractValidationError

    store, pointer = _canonical_session(isolated_session, "canonical_final_bless")
    # Operator ruling 2026-08-14: a DIRECT human final bless force-blesses
    # hitboxes instead of gating — only delegated/automated actors refuse.
    with pytest.raises(ContractValidationError, match="hitbox review"):
        isolated_session.set_canonical_final_review_if_present(
            "canonical_final_bless",
            True,
            expected_content_revision=pointer.content_revision,
            reviewer="human:batu-delegated:overnight",
        )

    hitbox_pointer = isolated_session.set_canonical_hitbox_review_if_present(
        "canonical_final_bless",
        True,
        expected_content_revision=pointer.content_revision,
    )
    final_pointer = isolated_session.set_canonical_final_review_if_present(
        "canonical_final_bless",
        True,
        expected_content_revision=hitbox_pointer.content_revision,
    )
    assert final_pointer is not None
    assert set(store.read().snapshot["reviews"]) == {"hitboxes", "finalCutouts"}


def test_canonical_final_bless_accepts_unchanged_hitbox_scope_after_sprite_edit(isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_final_after_sprite_edit")
    hitbox_pointer = isolated_session.set_canonical_hitbox_review_if_present(
        "canonical_final_after_sprite_edit",
        True,
        expected_content_revision=pointer.content_revision,
    )
    sprite_pointer = isolated_session.save_canonical_sprite_geometry_if_present(
        "canonical_final_after_sprite_edit",
        "bird_one",
        sprite_box=[20, 30, 60, 80],
        cleanup_box=[15, 25, 65, 85],
        flip_x=False,
        flip_y=False,
        expected_content_revision=hitbox_pointer.content_revision,
    )

    final_pointer = isolated_session.set_canonical_final_review_if_present(
        "canonical_final_after_sprite_edit",
        True,
        expected_content_revision=sprite_pointer.content_revision,
    )

    assert final_pointer is not None
    assert set(store.read().snapshot["reviews"]) == {"hitboxes", "finalCutouts"}


def test_stale_canonical_sprite_placement_returns_409(app_client, isolated_session, monkeypatch):
    _store, pointer = _canonical_session(isolated_session, "canonical_sprite_stale")
    monkeypatch.setattr(
        isolated_session,
        "sprite_animation_candidate_by_id",
        lambda _session_id, _candidate_id: {"birdId": "bird_one", "dogIndex": 0},
    )

    response = app_client.put(
        "/api/sessions/canonical_sprite_stale/sprite-candidates/bird_one%3Asprite_000/placement",
        json={
            "spriteBox": [20, 30, 60, 80],
            "cleanupBox": [15, 25, 65, 85],
            "expectedContentRevision": "sha256:" + "0" * 64,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["actualContentRevision"] == pointer.content_revision
    candidates = app_client.get("/api/sessions/canonical_sprite_stale/sprite-candidates")
    assert candidates.status_code == 200
    assert candidates.json()["contentRevision"] == pointer.content_revision
    assert candidates.json()["operationalRevision"] == pointer.operational_revision


def test_stale_sprite_placement_rebases_when_only_another_bird_changed(isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_sprite_other_bird")
    snapshot = store.read().snapshot
    second = copy.deepcopy(snapshot["birds"][0])
    second.update({"birdId": "bird_two", "compatibilitySlot": "dog_01", "presentationOrder": 1})
    snapshot["birds"].append(second)
    store.commit(snapshot, expected_content_revision=pointer.content_revision)

    result = isolated_session.save_canonical_sprite_geometry_if_present(
        "canonical_sprite_other_bird",
        "bird_one",
        sprite_box=[20, 30, 60, 80],
        cleanup_box=[15, 25, 65, 85],
        flip_x=True,
        flip_y=False,
        expected_content_revision=pointer.content_revision,
    )

    assert result is not None
    current = store.read().snapshot
    assert len(current["birds"]) == 2
    assert current["birds"][0]["sprite"]["flipX"] is True


def test_stale_sprite_placement_rejects_when_same_bird_changed(isolated_session):
    _store, pointer = _canonical_session(isolated_session, "canonical_sprite_same_bird")
    isolated_session.save_canonical_sprite_geometry_if_present(
        "canonical_sprite_same_bird",
        "bird_one",
        sprite_box=[20, 30, 60, 80],
        cleanup_box=[15, 25, 65, 85],
        flip_x=False,
        flip_y=False,
        expected_content_revision=pointer.content_revision,
    )

    from levelbuilder.api.canonical_bird_contract import RevisionConflictError

    with pytest.raises(RevisionConflictError):
        isolated_session.save_canonical_sprite_geometry_if_present(
            "canonical_sprite_same_bird",
            "bird_one",
            sprite_box=[25, 35, 65, 85],
            cleanup_box=[20, 30, 70, 90],
            flip_x=True,
            flip_y=False,
            expected_content_revision=pointer.content_revision,
        )


def test_canonical_final_bless_route_uses_revision_cas(app_client, isolated_session):
    _store, pointer = _canonical_session(isolated_session, "canonical_final_route")
    hitbox_pointer = isolated_session.set_canonical_hitbox_review_if_present(
        "canonical_final_route",
        True,
        expected_content_revision=pointer.content_revision,
    )

    response = app_client.put(
        "/api/sessions/canonical_final_route/final-cutout-review",
        json={
            "approved": True,
            "expectedContentRevision": hitbox_pointer.content_revision,
            "humanActor": "human:editor",
            "reviewSource": "editor-ui",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["finalCutoutReview"]["current"] is True


def test_canonical_final_bless_rejects_agent_or_delegated_attribution(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_final_human_only")
    hitbox_pointer = isolated_session.set_canonical_hitbox_review_if_present(
        "canonical_final_human_only",
        True,
        expected_content_revision=pointer.content_revision,
    )

    for actor, review_source in (
        ("human:editor", None),
        ("human:batu-delegated:ladder", "editor-ui"),
        ("human:Codex eyes-on 2026-08-16", "editor-ui"),
    ):
        response = app_client.put(
            "/api/sessions/canonical_final_human_only/final-cutout-review",
            json={
                "approved": True,
                "expectedContentRevision": hitbox_pointer.content_revision,
                "humanActor": actor,
                **({"reviewSource": review_source} if review_source else {}),
            },
        )
        assert response.status_code == 403, response.text
        assert response.json()["detail"]["code"] == "manual_cutout_review_required"
        assert store.read().snapshot["reviews"].get("finalCutouts") is None


def test_canonical_delete_is_by_bird_id_and_revision_checked(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_delete")

    stale = app_client.delete(
        "/api/sessions/canonical_delete/dogs/by-id/bird_one",
        params={"expectedContentRevision": "sha256:" + "0" * 64},
    )
    assert stale.status_code == 409
    assert len(store.read().snapshot["birds"]) == 1

    deleted = app_client.delete(
        "/api/sessions/canonical_delete/dogs/by-id/bird_one",
        params={"expectedContentRevision": pointer.content_revision},
    )
    assert deleted.status_code == 200, deleted.text
    assert store.read().snapshot["birds"] == []
    assert store.read().snapshot["operational"]["deletedBirdIds"] == ["bird_one"]


def test_candidate_confirmation_is_operational_and_does_not_stale_blessing(isolated_session):
    from levelbuilder.api.canonical_bird_contract import bless_snapshot

    store, pointer = _canonical_session(isolated_session, "canonical_candidate_review")
    snapshot = bless_snapshot(
        store.read().snapshot,
        review_kind="hitboxes",
        reviewer="human:batu",
        reviewed_at="now",
    )
    reviewed = store.commit(snapshot, expected_content_revision=pointer.content_revision)

    result = isolated_session.set_canonical_candidate_confirmation_if_present(
        "canonical_candidate_review",
        "bird_one",
        True,
        expected_content_revision=reviewed.content_revision,
    )

    assert result.content_revision == reviewed.content_revision
    assert result.operational_revision != reviewed.operational_revision
    current = store.read().snapshot
    assert "hitboxes" in current["reviews"]
    assert current["operational"]["candidateReviews"]["bird_one"]["confirmed"] is True


def test_concurrent_save_and_bless_cannot_approve_old_geometry(isolated_session, monkeypatch):
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore, RevisionConflictError

    store, pointer = _canonical_session(isolated_session, "canonical_save_bless_race")
    barrier = threading.Barrier(2)
    original_commit = CanonicalRevisionStore.commit

    def synchronized_commit(
        self,
        snapshot,
        *,
        expected_content_revision,
        expected_operational_revision=None,
    ):
        if expected_content_revision is not None:
            barrier.wait(timeout=3)
        return original_commit(
            self,
            snapshot,
            expected_content_revision=expected_content_revision,
            expected_operational_revision=expected_operational_revision,
        )

    monkeypatch.setattr(CanonicalRevisionStore, "commit", synchronized_commit)

    def save():
        return isolated_session.save_canonical_hitboxes_if_present(
            "canonical_save_bless_race",
            [{"id": "bird_one", "x": 99, "y": 20, "r": 5}],
            expected_content_revision=pointer.content_revision,
        )

    def bless():
        return isolated_session.set_canonical_hitbox_review_if_present(
            "canonical_save_bless_race",
            True,
            expected_content_revision=pointer.content_revision,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(save), pool.submit(bless)]
        outcomes = []
        for future in futures:
            try:
                outcomes.append(future.result(timeout=5))
            except RevisionConflictError:
                outcomes.append("conflict")

    current = store.read().snapshot
    assert outcomes.count("conflict") == 1
    if current["birds"][0]["hitbox"]["x"] == 99:
        assert "hitboxes" not in current["reviews"]
    else:
        assert current["birds"][0]["hitbox"]["x"] == 10
        assert current["reviews"]["hitboxes"]["contentRevision"] == pointer.content_revision


def test_canvas_add_and_delete_gestures_work_via_hitbox_save(app_client, isolated_session):
    """CR-t1 P0-4 end-to-end: POST /hitboxes with a client-minted id adds the
    bird; posting without an id deletes it. No 'identity set' rejection."""
    import uuid as _uuid

    store, pointer = _canonical_session(isolated_session, "canvas_gestures")
    minted = str(_uuid.uuid4())
    add = app_client.post(
        "/api/sessions/canvas_gestures/hitboxes",
        json={"expectedContentRevision": pointer.content_revision,
              "hitboxes": [{"id": "bird_one", "x": 10, "y": 20, "r": 5},
                           {"id": minted, "x": 90, "y": 90, "r": 15}]},
    )
    assert add.status_code == 200, add.text
    assert {h["id"] for h in add.json()["hitboxes"]} == {"bird_one", minted}

    remove = app_client.post(
        "/api/sessions/canvas_gestures/hitboxes",
        json={"expectedContentRevision": add.json()["contentRevision"],
              "hitboxes": [{"id": "bird_one", "x": 10, "y": 20, "r": 5}]},
    )
    assert remove.status_code == 200, remove.text
    assert [h["id"] for h in remove.json()["hitboxes"]] == ["bird_one"]
    assert [b["birdId"] for b in store.read().snapshot["birds"]] == ["bird_one"]
