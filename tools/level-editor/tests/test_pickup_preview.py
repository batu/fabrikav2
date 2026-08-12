import json
from io import BytesIO

from PIL import Image

from test_canonical_hitbox_cas import _canonical_session


def test_pickup_preview_translates_cleanup_with_current_hitbox(app_client, isolated_session):
    session_id = "pickup_preview_moved_hitbox"
    sdir = isolated_session.session_dir(session_id)
    sdir.mkdir(parents=True)

    Image.new("RGB", (80, 60), (220, 20, 20)).save(sdir / "color.png")
    Image.new("RGB", (80, 60), (20, 180, 20)).save(sdir / "bg_00.png")
    (sdir / "session.json").write_text(json.dumps({"selected_bg": 0}))
    (sdir / "level.json").write_text(json.dumps({
        "width": 80,
        "height": 60,
        "dogs": [{
            "id": "bird-1",
            "x": 20,
            "y": 20,
            "sprite": {
                "cleanup": {"x": 15, "y": 15, "width": 10, "height": 10},
            },
        }],
    }))
    (sdir / "hitboxes.json").write_text(json.dumps([
        {"id": "bird-1", "x": 40, "y": 20, "r": 8},
    ]))

    response = app_client.get(f"/api/sessions/{session_id}/pickup-preview")

    assert response.status_code == 200
    preview = Image.open(BytesIO(response.content)).convert("RGB")
    # The cleanup follows the hitbox 20 px right instead of remaining at the
    # stale level.json position. JPEG encoding allows a small color tolerance.
    assert preview.getpixel((40, 20))[1] > preview.getpixel((40, 20))[0]
    assert preview.getpixel((20, 20))[0] > preview.getpixel((20, 20))[1]


def test_canonical_pickup_preview_uses_revision_geometry_without_level_projection(app_client, isolated_session):
    session_id = "pickup_preview_canonical"
    store, pointer = _canonical_session(isolated_session, session_id)
    sdir = isolated_session.session_dir(session_id)
    Image.new("RGB", (80, 60), (220, 20, 20)).save(sdir / "color.png")
    Image.new("RGB", (80, 60), (20, 180, 20)).save(sdir / "bg.png")
    snapshot = store.read().snapshot
    snapshot["birds"][0]["hitbox"] = {"x": 40, "y": 30, "r": 5}
    snapshot["birds"][0]["cleanup"] = {
        "x": 35, "y": 25, "width": 10, "height": 10,
        "sourceSpriteSha256": snapshot["birds"][0]["sprite"]["asset"]["sha256"],
    }
    from conftest import restamp_snapshot_assets
    restamp_snapshot_assets(sdir, snapshot)
    store.commit(snapshot, expected_content_revision=pointer.content_revision)
    (sdir / "level.json").unlink(missing_ok=True)

    response = app_client.get(f"/api/sessions/{session_id}/pickup-preview")

    assert response.status_code == 200
    preview = Image.open(BytesIO(response.content)).convert("RGB")
    assert preview.getpixel((40, 30))[1] > preview.getpixel((40, 30))[0]
    assert preview.getpixel((29, 30))[0] > preview.getpixel((29, 30))[1]


def test_canonical_pickup_preview_rejects_mismatched_restore_dimensions(app_client, isolated_session):
    session_id = "pickup_preview_bad_restore"
    _canonical_session(isolated_session, session_id)
    sdir = isolated_session.session_dir(session_id)
    Image.new("RGB", (80, 60), (220, 20, 20)).save(sdir / "color.png")
    Image.new("RGB", (40, 30), (20, 180, 20)).save(sdir / "bg.png")

    response = app_client.get(f"/api/sessions/{session_id}/pickup-preview")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "restore_dimensions_mismatch"
