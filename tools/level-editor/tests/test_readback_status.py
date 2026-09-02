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
            "humanActor": "human:editor",
            "reviewSource": "editor-ui",
        },
    )
    assert response.status_code in (409, 422)
    assert store.read().snapshot["reviews"].get("finalCutouts") is None


def test_geometry_endpoint_clear_and_scale(app_client, isolated_session):
    """CL-1/CL-2: bulk geometry operations ride the service through one
    endpoint — one CAS commit, read-back response, R6 impact in the reply."""
    store, pointer = _canonical_session(isolated_session, "geo_endpoint")
    scale = app_client.post(
        "/api/sessions/geo_endpoint/geometry",
        json={"operation": "scale", "factor": 2.0,
              "expectedContentRevision": pointer.content_revision,
              "humanActor": "human:batu"},
    )
    assert scale.status_code == 200, scale.text
    body = scale.json()
    assert body["hitboxes"][0]["r"] == 10
    assert body["contentRevision"] != pointer.content_revision

    clear = app_client.post(
        "/api/sessions/geo_endpoint/geometry",
        json={"operation": "clear",
              "expectedContentRevision": body["contentRevision"],
              "humanActor": "human:batu"},
    )
    assert clear.status_code == 200, clear.text
    assert clear.json()["hitboxes"] == []
    assert store.read().snapshot["birds"] == []

    stale = app_client.post(
        "/api/sessions/geo_endpoint/geometry",
        json={"operation": "clear",
              "expectedContentRevision": pointer.content_revision,
              "humanActor": "human:batu"},
    )
    assert stale.status_code == 409


def test_gallery_listing_reads_canonical_once_per_session(isolated_session, monkeypatch):
    """Merge-review perf finding: one canonical read per session per listing —
    review status, readiness, and state all derive from the same read."""
    from levelbuilder.api import session as S

    _canonical_session(isolated_session, "listing_perf")
    calls = {"n": 0}
    original = S.read_canonical_session

    def counting(session_id):
        calls["n"] += 1
        return original(session_id)

    monkeypatch.setattr(S, "read_canonical_session", counting)
    listing = S.list_sessions()
    assert any(item["id"] == "listing_perf" for item in listing)
    per_session = calls["n"] / max(1, len(listing))
    assert per_session <= 1, f"{calls['n']} canonical reads for {len(listing)} sessions"


def test_rerun_stale_queues_exactly_the_extract_obligations(app_client, isolated_session, monkeypatch):
    """CL-17: one button discharges pending DAG obligations — batch selection
    is DAG staleness, and the queued set is exactly the obligated birds."""
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import routes as R
    from levelbuilder.api.geometry_service import mutate_geometry

    store, pointer = _canonical_session(isolated_session, "rerun_stale")
    added = mutate_geometry(
        "rerun_stale", "add", hitboxes=[{"x": 40, "y": 40, "r": 10}],
        expected_content_revision=pointer.content_revision, actor="human:batu",
    )
    draft_id = next(b["birdId"] for b in store.read().snapshot["birds"] if b["birdId"] != "bird_one")

    captured = {}

    def fake_start(session_id, req):
        captured["birdIds"] = list(req.birdIds)
        captured["cutoutOnly"] = req.cutoutOnly
        class Job:  # minimal shape for the response builder
            id = "job_fake"
        return Job()

    monkeypatch.setattr(R, "_start_rerun_stale_job", fake_start)
    response = app_client.post(
        "/api/sessions/rerun_stale/rerun-stale",
        json={"expectedContentRevision": added.content_revision, "humanActor": "human:batu"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["queuedBirdIds"] == [draft_id]
    assert captured["birdIds"] == [draft_id]

    # Nothing stale: explicit no-op, no job started.
    captured.clear()
    fresh = app_client.post(
        "/api/sessions/rerun_stale/rerun-stale",
        json={"expectedContentRevision": added.content_revision, "humanActor": "human:batu",
              "obligations": ["extract"], "dryRun": True},
    )
    assert fresh.status_code == 200
    assert fresh.json()["queuedBirdIds"] == [draft_id]  # dryRun reports, doesn't start
    assert "birdIds" not in captured
