"""P1.8: every geometry mutation answers with read-back truth — the persisted
state refetched from the store, never request-completion optimism. A 409
carries current server truth so a client can reconcile without keeping
minted/unpersisted IDs rendered as reality."""
import json

from conftest import materialize_snapshot_assets  # noqa: F401  (fixture chain)
from test_canonical_hitbox_cas import _canonical_session


def test_canonical_save_returns_persisted_hitboxes_and_obligations(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "readback_save")
    response = app_client.post(
        "/api/sessions/readback_save/hitboxes",
        json={
            "expectedContentRevision": pointer.content_revision,
            "hitboxes": [{"id": "bird_one", "x": 77, "y": 66, "r": 12}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["hitboxes"] == [{"x": 77, "y": 66, "r": 12, "id": "bird_one"}]
    assert body["contentRevision"] != pointer.content_revision
    assert isinstance(body["pendingObligations"], list)
    # Read-back means the store agrees, not just the response.
    assert store.read().snapshot["birds"][0]["hitbox"] == {"x": 77, "y": 66, "r": 12}


def test_conflict_response_carries_server_truth(app_client, isolated_session):
    store, pointer = _canonical_session(isolated_session, "readback_conflict")
    response = app_client.post(
        "/api/sessions/readback_conflict/hitboxes",
        json={
            "expectedContentRevision": "sha256:" + "0" * 64,
            "hitboxes": [{"id": "bird_one", "x": 1, "y": 1, "r": 1}],
        },
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["actualContentRevision"] == pointer.content_revision
    assert detail["serverHitboxes"] == [
        {"x": b["hitbox"]["x"], "y": b["hitbox"]["y"], "r": b["hitbox"]["r"], "id": b["birdId"]}
        for b in store.read().snapshot["birds"]
    ]


def test_readiness_and_blessing_track_canonical_obligations(app_client, isolated_session):
    """CR-1 finding 5 / P1.2: a sprite-less canonical bird blocks final-cutout
    readiness AND the blessing endpoint refuses — no false final approval."""
    from levelbuilder.api import session as S
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "readiness_guard")
    added = mutate_geometry(
        "readiness_guard", "add", hitboxes=[{"x": 5, "y": 5, "r": 5}],
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    readiness = S.get_final_cutout_review_readiness("readiness_guard")
    assert readiness["ready"] is False
    assert readiness.get("missingFinalCutouts", 0) >= 1

    response = app_client.put(
        "/api/sessions/readiness_guard/final-cutout-review",
        json={
            "approved": True,
            "expectedContentRevision": added.content_revision,
            "humanActor": "human:batu",
        },
    )
    assert response.status_code in (409, 422)
    assert store.read().snapshot["reviews"].get("finalCutouts") is None
