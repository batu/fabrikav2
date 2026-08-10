import hashlib
import json


def _write_level(root, session_id, payload):
    directory = root / session_id
    directory.mkdir(parents=True)
    data = json.dumps(payload, indent=1).encode()
    (directory / "level.json").write_bytes(data)
    return directory, hashlib.sha256(data).hexdigest()


def test_session_dir_prefers_duplicate_matching_final_blessing(tmp_path, monkeypatch):
    from levelbuilder.api import session

    active_root = tmp_path / "active"
    public_root = tmp_path / "public"
    session_id = "reviewed_level"
    active, _ = _write_level(active_root, session_id, {
        "id": session_id,
        "name": "stale sprite copy",
        "dogs": [{"id": "dog_00", "x": 9, "y": 8, "sprite": {"image": "old.png"}}],
    })
    public, public_hash = _write_level(public_root, session_id, {
        "id": session_id,
        "name": "reviewed sprite copy",
        "dogs": [{"id": "dog_00", "x": 9, "y": 8, "sprite": {"image": "reviewed.png"}}],
    })
    (public / "golden-review.json").write_text(json.dumps({
        "approved": True,
        "levelSha256": public_hash,
    }))
    monkeypatch.setattr(session, "LEVELS_DIR", active_root)
    monkeypatch.setattr(session, "GAME_PUBLIC_LEVELS", public_root)

    assert session.session_dir(session_id) == public


def test_clone_rewrites_asset_ownership_and_drops_final_blessing(tmp_path, monkeypatch):
    from levelbuilder.api import session

    active_root = tmp_path / "active"
    public_root = tmp_path / "public"
    source_id = "source_level"
    clone_id = "comparison_clone"
    source, _ = _write_level(active_root, source_id, {
        "id": source_id,
        "dogs": [{
            "id": "dog_00",
            "sprite": {"image": f"levels/{source_id}/dogs/dog_00/sprite_000.png"},
        }],
    })
    (source / "session.json").write_text(json.dumps({
        "id": source_id,
        "preview": f"levels/{source_id}/color.png",
    }))
    (source / "golden-review.json").write_text(json.dumps({"approved": True}))
    (source / "hitbox-review.json").write_text(json.dumps({"approved": True}))
    monkeypatch.setattr(session, "LEVELS_DIR", active_root)
    monkeypatch.setattr(session, "GAME_PUBLIC_LEVELS", public_root)

    session.clone_session(source_id, clone_id)

    clone = active_root / clone_id
    level = json.loads((clone / "level.json").read_text())
    saved_session = json.loads((clone / "session.json").read_text())
    assert level["id"] == clone_id
    assert level["dogs"][0]["sprite"]["image"].startswith(f"levels/{clone_id}/")
    assert saved_session["preview"].startswith(f"levels/{clone_id}/")
    assert not (clone / "golden-review.json").exists()
    assert (clone / "hitbox-review.json").exists()
