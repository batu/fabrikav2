"""CL-10: scene views are revision-addressed webp previews rendered once and
served statically — toggling is an img swap, never a per-click composite."""
import json

from PIL import Image

from conftest import restamp_snapshot_assets
from test_canonical_hitbox_cas import _canonical_session


def _real_scene_session(isolated_session, session_id):
    store, pointer = _canonical_session(isolated_session, session_id)
    sdir = isolated_session.session_dir(session_id)
    Image.new("RGB", (128, 96), (200, 30, 30)).save(sdir / "color.png")
    Image.new("RGB", (128, 96), (30, 160, 30)).save(sdir / "bg.png")
    Image.new("RGBA", (16, 16), (10, 10, 220, 255)).save(sdir / "sprite.png")
    snapshot = store.read().snapshot
    restamp_snapshot_assets(sdir, snapshot)
    store.commit(snapshot, expected_content_revision=pointer.content_revision)
    return store


def test_preview_renders_once_then_serves_cached_bytes(app_client, isolated_session):
    store = _real_scene_session(isolated_session, "preview_cache")
    revision = store.read().pointer.content_revision

    first = app_client.get("/api/sessions/preview_cache/scene-previews/pickup")
    assert first.status_code == 200
    assert first.headers["content-type"] == "image/webp"
    assert revision.removeprefix("sha256:")[:16] in first.headers["x-preview-revision"]

    sdir = isolated_session.session_dir("preview_cache")
    files = list((sdir / ".previews").rglob("*.webp"))
    assert len(files) == 1
    mtime = files[0].stat().st_mtime_ns
    second = app_client.get("/api/sessions/preview_cache/scene-previews/pickup")
    assert second.status_code == 200
    assert files[0].stat().st_mtime_ns == mtime  # served, not re-rendered
    assert "immutable" in second.headers.get("cache-control", "")


def test_preview_rerenders_on_new_revision_and_rejects_unknown_views(app_client, isolated_session):
    store = _real_scene_session(isolated_session, "preview_revs")
    app_client.get("/api/sessions/preview_revs/scene-previews/pickup")
    pointer = store.read().pointer
    snapshot = store.read().snapshot
    snapshot["birds"][0]["hitbox"]["x"] += 5
    store.commit(snapshot, expected_content_revision=pointer.content_revision)
    response = app_client.get("/api/sessions/preview_revs/scene-previews/pickup")
    assert response.status_code == 200
    sdir = isolated_session.session_dir("preview_revs")
    assert len({p.parent.name for p in (sdir / ".previews").rglob("*.webp")}) == 2

    assert app_client.get("/api/sessions/preview_revs/scene-previews/nonsense").status_code == 422
