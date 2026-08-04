"""Deterministic diff detection for magenta finalization."""

import json

from PIL import Image, ImageDraw

from levelbuilder.api import inpaint as inp
from levelbuilder.api import session as S


def _mk_session(tmp_path, monkeypatch, blobs):
    sdir = tmp_path / "sess"
    sdir.mkdir()
    bg = Image.new("RGB", (600, 600), (230, 220, 200))
    bg.save(sdir / "bg_00.png")
    color = bg.copy()
    d = ImageDraw.Draw(color)
    for (x, y, r) in blobs:
        d.ellipse([x - r, y - r, x + r, y + r], fill=(60, 40, 30))
    color.save(sdir / "color.png")
    (sdir / "session.json").write_text(json.dumps({"id": "sess", "selected_bg": 0}))
    monkeypatch.setattr(S, "session_dir", lambda sid: sdir)
    monkeypatch.setattr(S, "load_session_raw", lambda sid: json.loads((sdir / "session.json").read_text()))
    monkeypatch.setattr(inp, "_resolve_selected_bg", lambda sid, raw: 0)
    return sdir


def test_detects_each_painted_blob(tmp_path, monkeypatch):
    _mk_session(tmp_path, monkeypatch, [(100, 100, 30), (400, 380, 40), (250, 500, 25)])
    dets = inp.detect_painted_subjects("sess", min_area=200)
    assert len(dets) == 3
    # Largest first
    assert dets[0]["width"] >= dets[1]["width"] >= dets[2]["width"]
    # Bounding boxes actually contain the blob centers
    centers = [(100, 100), (400, 380), (250, 500)]
    for cx, cy in centers:
        assert any(d["x"] <= cx <= d["x"] + d["width"] and d["y"] <= cy <= d["y"] + d["height"] for d in dets)


def test_ignores_speck_noise(tmp_path, monkeypatch):
    sdir = _mk_session(tmp_path, monkeypatch, [(100, 100, 30)])
    color = Image.open(sdir / "color.png")
    d = ImageDraw.Draw(color)
    d.point([(500, 20), (510, 25)], fill=(0, 0, 0))
    color.save(sdir / "color.png")
    dets = inp.detect_painted_subjects("sess", min_area=400)
    assert len(dets) == 1


def test_identical_images_yield_no_detections(tmp_path, monkeypatch):
    sdir = _mk_session(tmp_path, monkeypatch, [])
    dets = inp.detect_painted_subjects("sess")
    assert dets == []
