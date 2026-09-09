"""Extract All crops a square around the hitbox; the VLM detection extent
only ENLARGES that square for birds painted bigger than the radius square
(2026-09-08). A crop cut tight to the extent degraded the sticker recreate
(pop median 40 vs 19 on the same session)."""
import hashlib
import json
import pathlib
import tempfile
from types import SimpleNamespace


def test_small_detection_keeps_the_radius_square():
    from levelbuilder.api.inpaint import extract_box_for_hitbox

    hb = {"x": 200, "y": 200, "r": 50}
    dets = [{"x": 170, "y": 175, "width": 60, "height": 50}]  # 60 * 1.3 = 78 < 160
    box = extract_box_for_hitbox(hb, dets, 1.6)
    assert box["source"] == "radius"
    assert (box["x"], box["y"], box["width"], box["height"]) == (120, 120, 160, 160)


def test_big_detection_grows_the_square_around_the_hitbox():
    from levelbuilder.api.inpaint import extract_box_for_hitbox

    hb = {"x": 200, "y": 200, "r": 50}
    dets = [{"x": 100, "y": 120, "width": 200, "height": 160}]  # 200 * 1.3 = 260 > 160
    box = extract_box_for_hitbox(hb, dets, 1.6)
    assert box["source"] == "vlm"
    assert box["width"] == box["height"] == 260
    assert box["x"] == 70 and box["y"] == 70                    # still centered on the hitbox


def test_far_detection_is_ignored():
    from levelbuilder.api.inpaint import extract_box_for_hitbox

    hb = {"x": 200, "y": 200, "r": 50}
    dets = [{"x": 500, "y": 500, "width": 400, "height": 400}]
    box = extract_box_for_hitbox(hb, dets, 1.6)
    assert box["source"] == "radius" and box["width"] == 160


def test_bulk_extract_uses_persisted_vlm_boxes(monkeypatch):
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    tmp = pathlib.Path(tempfile.mkdtemp())
    hb = [{"id": "b1", "x": 100, "y": 100, "r": 50}, {"id": "b2", "x": 900, "y": 900, "r": 50}]
    (tmp / "hitboxes.json").write_text(json.dumps(hb))
    (tmp / I.VLM_DETECTIONS_FILE).write_text(json.dumps(
        [{"x": 0, "y": 20, "width": 200, "height": 160}]))  # big bird at b1
    monkeypatch.setattr(S, "session_dir", lambda sid: tmp)
    seen = {}
    monkeypatch.setattr(S, "materialize_detection_sprites",
        lambda sid, *, detections, minimum_confidence, force: seen.update(
            {"detections": detections}) or {"materialized": 2})
    meta_patches = []

    class _Store:
        def update_metadata(self, job_id, patch):
            meta_patches.append(patch)

    sha = hashlib.sha256((tmp / "hitboxes.json").read_bytes()).hexdigest()
    job = SimpleNamespace(id="j1", session_id="s1",
                          metadata={"force": False, "padFactor": 1.6, "hitboxesSha": sha})
    I._run_bulk_extract_job(job, store=_Store())
    d1, d2 = seen["detections"]
    assert d1["source"] == "vlm" and d1["width"] == 260
    assert d2["source"] == "radius" and d2["width"] == 160
    assert any(p.get("boxSources") == {"vlm": 1, "radius": 1} for p in meta_patches)


def test_localizer_persists_detection_extents(monkeypatch):
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    tmp = pathlib.Path(tempfile.mkdtemp())
    dets = [{"x": 90, "y": 90, "width": 20, "height": 20, "confidence": 1.0}]
    monkeypatch.setattr(I, "detect_birds_vlm", lambda sid, **kw: dets)
    monkeypatch.setattr(I, "_load_retry_hitboxes", lambda sid: [])
    monkeypatch.setattr(S, "save_hitboxes", lambda sid, payload: payload)
    monkeypatch.setattr(S, "session_dir", lambda sid: tmp)
    monkeypatch.setattr(I, "uniform_hitbox_radius", lambda dim: 57)
    monkeypatch.setattr(I, "_scene_dimension", lambda sid: 2688, raising=False)
    monkeypatch.setattr(I, "_resync_dogs_to_hitboxes", lambda sid, payload: None)
    I.localize_hitboxes_from_detections("sid")
    stored = json.loads((tmp / I.VLM_DETECTIONS_FILE).read_text())
    assert stored == [{"x": 90, "y": 90, "width": 20, "height": 20}]
