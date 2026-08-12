"""A1/P1.1: hydrate_session serves canonical truth for VALID_CURRENT sessions.
A stale hitboxes.json or session.json dogs[] must not shadow the snapshot —
the phantom-save class, pinned at the API-payload level."""
import json

from conftest import materialize_snapshot_assets


def _canonical_with_stale_sidecars(isolated_session, session_id):
    from test_canonical_hitbox_cas import _canonical_session

    store, pointer = _canonical_session(isolated_session, session_id)
    sdir = isolated_session.session_dir(session_id)
    # Stale legacy surfaces that disagree with canonical truth.
    (sdir / "hitboxes.json").write_text(json.dumps(
        [{"id": "bird_one", "x": 1, "y": 2, "r": 3}]
    ))
    snapshot = store.read().snapshot
    snapshot["birds"][0]["hitbox"] = {"x": 555, "y": 444, "r": 33}
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)
    return store, pointer


def test_hydrate_overlays_canonical_hitboxes_over_stale_sidecar(isolated_session):
    from levelbuilder.api import session as S

    _canonical_with_stale_sidecars(isolated_session, "overlay_hitboxes")
    data = S.hydrate_session("overlay_hitboxes")
    assert data["hitboxes"] == [{"x": 555, "y": 444, "r": 33, "id": "bird_one"}]
    assert data["canonicalState"] == "valid_current"
    assert data["contentRevision"].startswith("sha256:")


def test_hydrate_overlays_bird_identity_onto_dogs(isolated_session):
    from levelbuilder.api import session as S

    _canonical_with_stale_sidecars(isolated_session, "overlay_identity")
    data = S.hydrate_session("overlay_identity")
    by_slot = {d["index"]: d for d in data["dogs"]}
    assert by_slot[0]["id"] == "bird_one"


def test_hydrate_marks_quarantined_sessions_instead_of_guessing(isolated_session):
    from levelbuilder.api import session as S

    from test_canonical_hitbox_cas import _canonical_session
    store, _ = _canonical_session(isolated_session, "overlay_quarantined")
    store.pointer_path.write_text("not json")
    data = S.hydrate_session("overlay_quarantined")
    assert data["canonicalState"] == "quarantined_integrity"
    # Legacy fields still present for triage, but the state is unmissable.
