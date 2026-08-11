from __future__ import annotations

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
    pointer = store.commit(_snapshot(session_id), expected_content_revision=None)
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
        json={"approved": True, "expectedContentRevision": "sha256:" + "f" * 64},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["actualContentRevision"] == pointer.content_revision
    assert store.read().snapshot["reviews"] == {}


def test_canonical_hitbox_blessing_binds_current_revision(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "canonical_bless")
    response = app_client.put(
        "/api/sessions/canonical_bless/hitbox-review",
        json={"approved": True, "expectedContentRevision": pointer.content_revision},
    )
    assert response.status_code == 200
    review = store.read().snapshot["reviews"]["hitboxes"]
    assert review["contentRevision"] == pointer.content_revision
    assert review["reviewer"] == "human:editor"


def test_legacy_hitbox_save_still_accepts_missing_revision(app_client, isolated_session):
    root = isolated_session.LEVELS_DIR / "legacy_save"
    root.mkdir()
    response = app_client.post(
        "/api/sessions/legacy_save/hitboxes",
        json={"hitboxes": [{"x": 10, "y": 20, "r": 5}]},
    )
    assert response.status_code == 204


def test_session_read_exposes_canonical_revision(app_client, isolated_session):
    _store, pointer = _canonical_session(isolated_session, "canonical_read")

    response = app_client.get("/api/sessions/canonical_read")

    assert response.status_code == 200
    assert response.json()["canonicalState"] == "valid_current"
    assert response.json()["contentRevision"] == pointer.content_revision


def test_concurrent_save_and_bless_cannot_approve_old_geometry(isolated_session, monkeypatch):
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore, RevisionConflictError

    store, pointer = _canonical_session(isolated_session, "canonical_save_bless_race")
    barrier = threading.Barrier(2)
    original_commit = CanonicalRevisionStore.commit

    def synchronized_commit(self, snapshot, *, expected_content_revision):
        if expected_content_revision is not None:
            barrier.wait(timeout=3)
        return original_commit(self, snapshot, expected_content_revision=expected_content_revision)

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
    assert current["birds"][0]["hitbox"]["x"] == 99
    assert "hitboxes" not in current["reviews"]
    assert outcomes
