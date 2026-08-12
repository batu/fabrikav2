"""P1.7 (tonight's slice): the artifact DAG derives pending obligations from
the canonical snapshot — schema, staleness, and blocking only; no paid
auto-run. Export/approval surfaces consume the same single derivation."""
from conftest import materialize_snapshot_assets


def _store(tmp_path, **kw):
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore
    from test_canonical_hitbox_cas import _snapshot

    root = tmp_path / "session"
    store = CanonicalRevisionStore(root)
    snapshot = _snapshot("dag_case")
    materialize_snapshot_assets(root, snapshot)
    store.commit(snapshot, expected_content_revision=None)
    return store


def test_fully_reviewed_snapshot_has_no_pending_obligations(tmp_path):
    from levelbuilder.api.artifact_dag import pending_obligations
    from levelbuilder.api.canonical_bird_contract import bless_snapshot

    store = _store(tmp_path)
    pointer = store.read().pointer
    snapshot = bless_snapshot(store.read().snapshot, review_kind="hitboxes", reviewer="human:t", reviewed_at="now")
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)
    snapshot = bless_snapshot(store.read().snapshot, review_kind="finalCutouts", reviewer="human:t", reviewed_at="now")
    store.commit(snapshot, expected_content_revision=pointer.content_revision)
    assert pending_obligations(store.read().snapshot) == []


def test_missing_sprite_and_missing_reviews_are_pending_obligations(tmp_path):
    from levelbuilder.api.artifact_dag import pending_obligations

    store = _store(tmp_path)
    snapshot = store.read().snapshot
    kinds = {o["obligation"] for o in pending_obligations(snapshot)}
    # No reviews blessed yet: both review obligations pending.
    assert {"review:hitboxes", "review:finalCutouts"} <= kinds

    spriteless = dict(snapshot)
    spriteless["birds"] = [dict(b) for b in snapshot["birds"]]
    spriteless["birds"][0] = {k: v for k, v in spriteless["birds"][0].items() if k != "sprite"}
    obligations = pending_obligations(spriteless)
    extract = [o for o in obligations if o["obligation"] == "extract"]
    assert extract and extract[0]["birdId"] == spriteless["birds"][0]["birdId"]


def test_review_invalidation_reopens_the_obligation(tmp_path):
    from levelbuilder.api.artifact_dag import pending_obligations
    from levelbuilder.api.canonical_bird_contract import bless_snapshot, invalidate_reviews

    store = _store(tmp_path)
    pointer = store.read().pointer
    snapshot = bless_snapshot(store.read().snapshot, review_kind="hitboxes", reviewer="human:t", reviewed_at="now")
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)
    invalidated = invalidate_reviews(store.read().snapshot, changed_artifacts={"hitboxes"})
    kinds = {o["obligation"] for o in pending_obligations(invalidated)}
    assert "review:hitboxes" in kinds
