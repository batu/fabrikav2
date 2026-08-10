import json
from io import BytesIO

from PIL import Image


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
