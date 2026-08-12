"""A2: one resolver answers every canonical asset read — containment, existence,
byte count, sha256. Deleted or swapped bytes are an integrity error, never a
stale success. CAS objects satisfy a read when the path projection is gone."""
import hashlib

import pytest

from conftest import materialize_snapshot_assets


def _committed_store(tmp_path):
    from levelbuilder.api.canonical_bird_contract import CanonicalRevisionStore
    from test_canonical_hitbox_cas import _snapshot

    root = tmp_path / "session"
    store = CanonicalRevisionStore(root)
    snapshot = _snapshot("resolver_case")
    materialize_snapshot_assets(root, snapshot)
    store.commit(snapshot, expected_content_revision=None)
    return store, store.read().snapshot


def test_resolver_returns_verified_bytes_for_valid_assets(tmp_path):
    from levelbuilder.api.canonical_assets import resolve_asset

    store, snapshot = _committed_store(tmp_path)
    resolved = resolve_asset(store, snapshot["assets"]["scene"])
    assert resolved.sha256 == snapshot["assets"]["scene"]["sha256"]
    assert hashlib.sha256(resolved.data).hexdigest() == resolved.sha256
    assert resolved.source in {"path", "cas"}


def test_resolver_serves_from_cas_when_path_projection_is_missing(tmp_path):
    from levelbuilder.api.canonical_assets import resolve_asset

    store, snapshot = _committed_store(tmp_path)
    (store.session_root / snapshot["assets"]["scene"]["path"]).unlink()
    resolved = resolve_asset(store, snapshot["assets"]["scene"])
    assert resolved.source == "cas"
    assert resolved.sha256 == snapshot["assets"]["scene"]["sha256"]


def test_resolver_rejects_swapped_bytes_and_escaping_paths(tmp_path):
    from levelbuilder.api.canonical_assets import AssetIntegrityError, resolve_asset

    store, snapshot = _committed_store(tmp_path)
    scene = dict(snapshot["assets"]["scene"])
    # Swap the path bytes AND remove the CAS object: nothing matches the digest.
    (store.session_root / scene["path"]).write_bytes(b"tampered")
    for obj in (store.root / "objects").iterdir():
        if obj.name.startswith(scene["sha256"]):
            obj.unlink()
    with pytest.raises(AssetIntegrityError, match="neither"):
        resolve_asset(store, scene)

    escaping = {"path": "../outside.png", "sha256": "a" * 64, "bytes": 3}
    with pytest.raises(AssetIntegrityError, match="escapes"):
        resolve_asset(store, escaping)


def test_resolver_swapped_path_bytes_fall_back_to_cas(tmp_path):
    from levelbuilder.api.canonical_assets import resolve_asset

    store, snapshot = _committed_store(tmp_path)
    scene = snapshot["assets"]["scene"]
    (store.session_root / scene["path"]).write_bytes(b"overwritten-by-legacy-writer")
    resolved = resolve_asset(store, scene)
    assert resolved.source == "cas"
    assert resolved.sha256 == scene["sha256"]


def test_lane_selection_is_fail_closed(tmp_path):
    """A3: VALID_CURRENT -> canonical; MIGRATION_REQUIRED -> legacy;
    orphaned/quarantined states refuse instead of guessing."""
    from levelbuilder.api.canonical_assets import LaneSelectionError, select_lane
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    assert select_lane(CanonicalReadState.VALID_CURRENT) == "canonical"
    assert select_lane(CanonicalReadState.MIGRATION_REQUIRED) == "legacy"
    for state in (CanonicalReadState.ORPHANED_STAGE, CanonicalReadState.QUARANTINED_INTEGRITY):
        with pytest.raises(LaneSelectionError, match=state.value):
            select_lane(state)
