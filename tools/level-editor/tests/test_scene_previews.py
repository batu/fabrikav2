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


def test_sprites_preview_renders_canonical_snapshot_not_stale_export(app_client, isolated_session):
    """CR-t1 P0-1: a canonical session's sprites view uses the snapshot —
    a stale exported level.json must not define sprite positions."""
    import json as _json

    store = _real_scene_session(isolated_session, "preview_sprites_truth")
    sdir = isolated_session.session_dir("preview_sprites_truth")
    # Stale export claiming the sprite sits elsewhere.
    (sdir / "level.json").write_text(_json.dumps({
        "name": "preview_sprites_truth", "width": 128, "height": 96,
        "dogs": [{"id": "bird_one", "x": 5, "y": 5, "sprite": {
            "image": "levels/preview_sprites_truth/sprite.png",
            "x": 0, "y": 0, "width": 16, "height": 16,
            "cleanup": {"x": 0, "y": 0, "width": 16, "height": 16},
        }}],
    }))
    # Canonical truth: sprite placed at (100, 60).
    pointer = store.read().pointer
    snapshot = store.read().snapshot
    snapshot["birds"][0]["sprite"]["placement"] = {"x": 100, "y": 60, "width": 16, "height": 16}
    snapshot["birds"][0]["cleanup"] = {"x": 98, "y": 58, "width": 20, "height": 20,
                                       "sourceSpriteSha256": snapshot["birds"][0]["sprite"]["asset"]["sha256"]}
    store.commit(snapshot, expected_content_revision=pointer.content_revision)

    response = app_client.get("/api/sessions/preview_sprites_truth/scene-previews/sprites")
    assert response.status_code == 200
    from io import BytesIO

    from PIL import Image as PILImage
    with PILImage.open(BytesIO(response.content)) as img:
        rgb = img.convert("RGB")
        # The blue sprite must be at the canonical position, not the stale one.
        def blueness(px):
            r, g, b = px
            return b - max(r, g)
        canonical_px = rgb.getpixel((int(107 * rgb.width / 128), int(66 * rgb.height / 96)))
        stale_px = rgb.getpixel((8 * rgb.width // 128, 8 * rgb.height // 96))
        assert blueness(canonical_px) > 60, canonical_px
        assert blueness(stale_px) < 60, stale_px


def test_residue_view_reports_gate_and_serves_heatmap(app_client, isolated_session):
    """CL-11: the residue endpoint computes pickup-composite vs clean bg,
    reports the pixel count + gate verdict, and serves a heatmap image."""
    store = _real_scene_session(isolated_session, "residue_view")
    response = app_client.get("/api/sessions/residue_view/residue")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["residuePixels"], int)
    assert body["gate"] in ("pass", "fail")
    assert body["dependencyHash"].startswith("sha256:")

    heatmap = app_client.get("/api/sessions/residue_view/scene-previews/residue")
    assert heatmap.status_code == 200
    assert heatmap.headers["content-type"] == "image/webp"
