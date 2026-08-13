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


def test_derived_crops_come_from_owned_paint(app_client, isolated_session):
    """CL-12: extraction/regen crops derive from the owned-paint footprint,
    read-only; manual override is flagged only when the diff gate fails."""
    store = _real_scene_session(isolated_session, "derived_crops")
    # A realistic pair: scene == clean bg except one painted blob near the bird.
    sdir = isolated_session.session_dir("derived_crops")
    base = Image.new("RGB", (128, 96), (30, 160, 30))
    base.save(sdir / "bg.png")
    painted = base.copy()
    for dx in range(24):
        for dy in range(24):
            painted.putpixel((8 + dx, 12 + dy), (220, 40, 40))
    painted.save(sdir / "color.png")
    from conftest import restamp_snapshot_assets
    pointer = store.read().pointer
    snapshot = store.read().snapshot
    snapshot["birds"][0]["hitbox"] = {"x": 20, "y": 24, "r": 8}
    restamp_snapshot_assets(sdir, snapshot)
    store.commit(snapshot, expected_content_revision=pointer.content_revision)
    response = app_client.get("/api/sessions/derived_crops/derived-crops")
    assert response.status_code == 200
    body = response.json()
    assert body["needsReview"] is False
    assert body["dependencyHash"].startswith("sha256:")
    crops = body["crops"]
    assert set(crops) == {"bird_one"}
    crop = crops["bird_one"]
    for key in ("x", "y", "width", "height"):
        assert isinstance(crop[key], int)
    assert crop["width"] > 0 and crop["height"] > 0


def test_sprite_history_and_revert_endpoints(app_client, isolated_session):
    import hashlib as _hashlib

    from test_canonical_hitbox_cas import _canonical_session

    store, pointer = _canonical_session(isolated_session, "revert_api")
    sdir = isolated_session.session_dir("revert_api")
    original_sha = store.read().snapshot["birds"][0]["sprite"]["asset"]["sha256"]
    new_bytes = b"replacement-sprite"
    (sdir / "sprite.png").write_bytes(new_bytes)
    snapshot = store.read().snapshot
    snapshot["birds"][0]["sprite"]["asset"] = {
        "path": "sprite.png", "sha256": _hashlib.sha256(new_bytes).hexdigest(), "bytes": len(new_bytes),
    }
    snapshot["birds"][0]["cleanup"]["sourceSpriteSha256"] = snapshot["birds"][0]["sprite"]["asset"]["sha256"]
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)

    history = app_client.get("/api/sessions/revert_api/birds/bird_one/sprite-history")
    assert history.status_code == 200
    entries = history.json()["history"]
    assert len(entries) >= 2
    previous = next(e for e in entries if e["sha256"] == original_sha)

    revert = app_client.post(
        "/api/sessions/revert_api/birds/bird_one/revert-sprite",
        json={"toContentRevision": previous["contentRevision"],
              "expectedContentRevision": pointer.content_revision,
              "humanActor": "human:batu"},
    )
    assert revert.status_code == 200, revert.text
    assert store.read().snapshot["birds"][0]["sprite"]["asset"]["sha256"] == original_sha


def test_evidence_contact_sheet_generates_per_revision(app_client, isolated_session):
    """P2e.5/R8: every scene state can emit its evidence contact sheet —
    painted scene, all-picked-up, sprites — revision-addressed, image-load
    asserted (a sheet that doesn't decode is broken evidence)."""
    from io import BytesIO

    from PIL import Image as PILImage

    _real_scene_session(isolated_session, "evidence_sheet")
    response = app_client.get("/api/sessions/evidence_sheet/evidence/contact-sheet")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    with PILImage.open(BytesIO(response.content)) as img:
        assert img.width > 0 and img.height > 0
    assert response.headers["x-preview-revision"]
