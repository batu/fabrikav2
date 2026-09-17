"""Sticker lane: the rules Batu set on 2026-09-16/17 and the plumbing into the canonical session.

Pure rules (classification, refit gate, chunk gate, cleanup rule, shipping) are tested on synthetic
arrays; the lane itself runs on an isolated canonical session with an injected judge and an injected
image-edit function (no provider, no subprocess: the conftest guards forbid both)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

from levelbuilder.api import sticker_lane as L


# ── synthetic scene: flat clean plate + one painted bird blob ─────────────────────────
CLEAN = (30, 120, 40)
BIRD = (200, 60, 40)
OUTLINE = (20, 10, 10)


def _bird_scene(size=(120, 90), center=(60, 45), radii=(12, 9)):
    clean = Image.new("RGB", size, CLEAN)
    painted = clean.copy()
    d = ImageDraw.Draw(painted)
    cx, cy = center
    rx, ry = radii
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=BIRD, outline=OUTLINE, width=2)
    d.ellipse((cx + 3, cy - 4, cx + 6, cy - 1), fill=(250, 250, 250))  # eye highlight
    d.line((cx - rx, cy, cx - rx - 10, cy - 8), fill=OUTLINE, width=2)   # tail: a bird is not a box
    d.line((cx - 3, cy + ry, cx - 4, cy + ry + 7), fill=OUTLINE, width=2)  # legs
    d.line((cx + 3, cy + ry, cx + 4, cy + ry + 7), fill=OUTLINE, width=2)
    mask = np.abs(np.asarray(painted, np.int16) - np.asarray(clean, np.int16)).sum(2) > 40
    ys, xs = np.where(mask)
    box = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
    rgba = np.dstack([np.asarray(painted), (mask * 255).astype(np.uint8)])
    x, y, w, h = box
    sprite = Image.fromarray(rgba[y:y + h, x:x + w], "RGBA")
    return clean, painted, sprite, box


def _fake_edit(image: Image.Image, prompt: str, *, model: str, quality: str | None) -> Image.Image:
    """A perfect sticker model: everything that is not the bird becomes flat magenta."""
    arr = np.asarray(image.convert("RGB")).copy()
    keep = np.abs(arr.astype(np.int16) - np.array(CLEAN, np.int16)).sum(2) > 40
    arr[~keep] = (255, 0, 255)
    return Image.fromarray(arr, "RGB")


class FakeVision:
    def __init__(self, tier=1, why="matches", gap=False):
        self.tier, self.why, self.gap = tier, why, gap
        self.calls: list[str] = []

    def ask(self, panel: Path, prompt: str, parse):
        self.calls.append(prompt[:20])
        assert panel.is_file()
        if parse is L.parse_gap_json:
            return {"gap": self.gap, "why": "fake", "backend": "fake", "seconds": 0.0}
        return {"tier": self.tier, "why": self.why, "backend": "fake", "seconds": 0.0}


# ── parsing ──────────────────────────────────────────────────────────────────────────
def test_parse_tier_json_accepts_chatty_output_and_rejects_bad_tiers():
    assert L.parse_tier_json('Sure. {"tier": 2, "why": "smaller"} done') == {"tier": 2, "why": "smaller"}
    with pytest.raises(ValueError):
        L.parse_tier_json('{"tier": 7, "why": "x"}')
    with pytest.raises(ValueError):
        L.parse_tier_json("no json here")


def test_parse_gap_json_requires_boolean():
    assert L.parse_gap_json('{"gap": true, "why": "legs"}')["gap"] is True
    with pytest.raises(ValueError):
        L.parse_gap_json('{"gap": "yes"}')


# ── Batu's classification rules ──────────────────────────────────────────────────────
@pytest.mark.parametrize("tier,refit,pop,why,expected", [
    (1, "applied", 10.0, "", "keep"),
    (2, "applied", 30.0, "", "keep"),
    (3, "applied", 20.0, "different hat", "keep"),          # T3 that fits well stays
    (3, "applied", 30.0, "different hat", "regenerate"),    # T3 that fits poorly regenerates
    (4, "applied", 5.0, "different pose", "regenerate"),    # pose change always regenerates
    (1, "refused: pop 60", 60.0, "", "regenerate"),         # refit-refused regardless of the judge
    (1, "refused: hitbox outside", 10.0, "", "regenerate"),
    (4, "applied", 5.0, "no bird in the painted scene", "missing"),
    (3, "refused: no fit", None, "painted reference is empty", "missing"),
    (None, "applied", 10.0, "error", "keep"),               # judge outage does not spend
])
def test_classify(tier, refit, pop, why, expected):
    assert L.classify(tier, refit, pop, why) == expected


# ── refit gate ───────────────────────────────────────────────────────────────────────
def test_refit_gate_applies_and_refuses_for_each_reason():
    hb = {"x": 60, "y": 45, "r": 8}
    current = (50, 36, 20, 18)
    fit = {"x": 2, "y": 3, "width": 22, "height": 20, "scale": 1.1, "ratio": 1.0, "pop": 12.0, "score": 0.9}
    status, fields = L.refit_gate(fit, hb, current, (48, 33))
    assert status == "applied"
    assert (fields["x"], fields["y"], fields["width"], fields["height"]) == (50, 36, 22, 20)
    assert 0 <= fields["anchorX"] <= 1 and 0 <= fields["anchorY"] <= 1
    assert fields["refit"]["dx"] == 0 and fields["refit"]["dy"] == 0
    assert L.refit_gate({**fit, "pop": 46.0}, hb, current, (48, 33))[0].startswith("refused: pop")
    assert L.refit_gate(fit, {"x": 200, "y": 200, "r": 8}, current, (48, 33))[0] == "refused: hitbox outside"
    assert L.refit_gate(fit, hb, (0, 0, 5, 5), (48, 33))[0] == "refused: no overlap"


# ── chunk gate, cleanup rule, shipping ───────────────────────────────────────────────
def test_chunk_sticker_is_a_filled_box_wider_than_2_2_r():
    r = 10.0
    filled = np.zeros((40, 40, 4), np.uint8)
    filled[..., 3] = 255
    assert L.is_chunk_sticker(filled, r)
    small = np.zeros((20, 20, 4), np.uint8)
    small[..., 3] = 255
    assert not L.is_chunk_sticker(small, r)  # a small filled box is a bird-sized sticker
    bird = np.zeros((40, 40, 4), np.uint8)
    yy, xx = np.ogrid[:40, :40]
    bird[..., 3] = (((xx - 20) ** 2 + (yy - 20) ** 2) <= 15 ** 2) * 255  # an ellipse fills ~78%
    assert not L.is_chunk_sticker(bird, r)


def test_cleanup_for_sprite_contains_the_disc_and_grows_the_box():
    hb = {"x": 60, "y": 45, "r": 8}
    x0, y0, x1, y1 = L.cleanup_for_sprite((52, 38, 16, 14), hb, 120, 90)
    assert x0 <= 52 and y0 <= 38 and x1 >= 68 and y1 >= 52
    assert x0 <= hb["x"] - 8 and x1 >= hb["x"] + 8 and y0 <= hb["y"] - 8 and y1 >= hb["y"] + 8
    assert (x1 - x0) >= 16 * 1.15 and (y1 - y0) >= 2 * 8
    edge = L.cleanup_for_sprite((0, 0, 10, 10), {"x": 3, "y": 3, "r": 8}, 120, 90)
    assert edge[0] == 0 and edge[1] == 0


def test_ship_sprite_caps_at_288_and_zeroes_transparent_rgb():
    _, _, sprite, _ = _bird_scene()
    out = L.ship_sprite(sprite, 600, 500)
    assert max(out.size) == 288 and out.size[0] == 288
    arr = np.asarray(out)
    assert (arr[arr[..., 3] == 0][:, :3] == 0).all()
    same = L.ship_sprite(sprite, sprite.width, sprite.height)
    assert same.size == sprite.size


# ── judge fall-through ───────────────────────────────────────────────────────────────
def test_vision_judge_falls_through_to_the_next_backend(tmp_path):
    panel = tmp_path / "p.png"
    Image.new("RGB", (10, 10)).save(panel)

    def broken(path, prompt):
        raise RuntimeError("quota")

    def fine(path, prompt):
        return '{"tier": 2, "why": "smaller"}'

    judge = L.VisionJudge((("a", broken), ("b", fine)))
    verdict = judge.ask(panel, L.TIER_PROMPT, L.parse_tier_json)
    assert verdict["tier"] == 2 and verdict["backend"] == "b"
    dead = L.VisionJudge((("a", broken),)).ask(panel, L.TIER_PROMPT, L.parse_tier_json)
    assert dead["backend"] is None and "quota" in dead["error"]
    with pytest.raises(ValueError):
        L.VisionJudge.from_spec("agy,unknown")


def test_panels_render():
    clean, painted, sprite, (x, y, w, h) = _bird_scene()
    panel = L.tier_panel(painted.crop((x - 10, y - 10, x + w + 10, y + h + 10)), sprite, (10, 10), tile=100)
    assert panel.size == (320, 110)
    rgba = np.zeros((30, 30, 4), np.uint8)
    rgba[..., 3] = 255
    gap = {"mask": np.zeros((30, 30), bool), "bbox": (10, 10, 14, 14), "size": 16}
    gap["mask"][10:15, 10:15] = True
    assert L.gap_panel(rgba, gap).width > 90 * 2


# ── regeneration on the synthetic scene ──────────────────────────────────────────────
def test_regenerate_sticker_lands_on_the_painted_bird():
    clean, painted, sprite, (x, y, w, h) = _bird_scene()
    hb = {"x": 60, "y": 45, "r": 8}
    boxes = L.regen_crop_boxes(hb, [], {"x": x, "y": y, "width": w, "height": h}, painted.size, max_crop_r=5.0)
    assert boxes[0][0] == "crop" and boxes[0][1][2] - boxes[0][1][0] == int(2 * 1.6 * 8)
    assert len(boxes) == 2 and boxes[1][0] == "crop2"  # the painted extent is bigger than the radius square
    result = L.regenerate_sticker(painted, clean, hb, crop_boxes=boxes, prompt="p", model="fake", quality="low", edit=_fake_edit)
    assert result["pick"] == "crop2" and result["chunk"] is False  # the tail needs the grown crop; coverage breaks the tie
    assert result["coverage"] > 0.9
    bx, by, bw, bh = result["box"]
    assert abs(bx - x) <= 2 and abs(by - y) <= 2 and abs(bw - w) <= 3 and abs(bh - h) <= 3
    assert result["pop"] < 15


def test_regen_crop_cap_limits_the_grown_square():
    hb = {"x": 60, "y": 45, "r": 8}
    boxes = L.regen_crop_boxes(hb, [], {"x": 0, "y": 0, "width": 400, "height": 400}, (500, 500), max_crop_r=4.0)
    x0, y0, x1, y1 = boxes[1][1]
    assert (x1 - x0) <= int(4.0 * 8) + 1
    # a cap no larger than the radius square collapses onto it: one crop, no second render
    assert len(L.regen_crop_boxes(hb, [], {"x": 0, "y": 0, "width": 400, "height": 400}, (500, 500), max_crop_r=3.2)) == 1


# ── the lane on an isolated canonical session ────────────────────────────────────────
def _lane_session(isolated_session, session_id: str):
    from conftest import restamp_snapshot_assets
    from test_canonical_hitbox_cas import _canonical_session

    store, pointer = _canonical_session(isolated_session, session_id)
    sdir = isolated_session.session_dir(session_id)
    clean, painted, sprite, (x, y, w, h) = _bird_scene()
    painted.save(sdir / "color.png")
    clean.save(sdir / "bg.png")
    clean.save(sdir / "bg_00.png")  # painted_extent_detections reads bg_{selected_bg}.png
    (sdir / "dogs" / "dog_00").mkdir(parents=True, exist_ok=True)
    sprite.save(sdir / "dogs" / "dog_00" / "sprite_000.png")
    (sdir / "session.json").write_text(json.dumps({"selected_bg": 0, "entity": "bird", "dogs": [{"index": 0, "id": "bird_one", "status": "done"}]}))
    (sdir / "hitboxes.json").write_text(json.dumps([{"id": "bird_one", "x": 60, "y": 45, "r": 8}]))
    snapshot = store.read().snapshot
    bird = snapshot["birds"][0]
    bird["hitbox"] = {"x": 60, "y": 45, "r": 8}
    bird["sprite"]["asset"]["path"] = "dogs/dog_00/sprite_000.png"
    bird["sprite"]["placement"] = {"x": x, "y": y, "width": w, "height": h}
    bird["sprite"]["anchorX"], bird["sprite"]["anchorY"] = round((60 - x) / w, 4), round((45 - y) / h, 4)
    bird["cleanup"] = {"x": x - 4, "y": y - 4, "width": w + 8, "height": h + 8, "sourceSpriteSha256": ""}
    restamp_snapshot_assets(sdir, snapshot)
    pointer = store.commit(snapshot, expected_content_revision=pointer.content_revision)
    return store, pointer, sdir, (x, y, w, h)


def test_lane_keeps_a_matching_sticker_and_annotates_the_sidecar(isolated_session, tmp_path):
    store, pointer, sdir, box = _lane_session(isolated_session, "lane_keep")
    vision = FakeVision(tier=1)
    summary = L.run_sticker_lane("lane_keep", L.LaneOptions(edit=_fake_edit, vision=vision, whitegap=False, artifact_dir=tmp_path / "art"))
    assert summary["classes"] == {"bird_one": "keep"}
    assert summary["refit"]["bird_one"] == "applied"
    assert summary["regenerated"] == {} and summary["stillRefused"] == [] and summary["errors"] == []
    # the sticker already sits on the paint: no commit, only the verdict next to the sprite
    assert summary["committed"] == {}
    assert store.read().pointer.content_revision == pointer.content_revision
    sidecar = json.loads((sdir / "dogs" / "dog_00" / "sprite_000.json").read_text())
    assert sidecar["stickerLane"]["tier"] == 1 and sidecar["stickerLane"]["class"] == "keep"
    assert json.loads((sdir / L.SUMMARY_FILE).read_text())["generationId"] == summary["generationId"]
    assert (tmp_path / "art" / "panels" / "dog_00_pass1.png").is_file()
    assert L.latest_summary("lane_keep")["classes"]["bird_one"] == "keep"


def test_lane_regenerates_a_tier4_sticker_through_canonical_promotion(isolated_session, tmp_path):
    store, pointer, sdir, (x, y, w, h) = _lane_session(isolated_session, "lane_regen")
    vision = FakeVision(tier=4, why="different pose")
    summary = L.run_sticker_lane("lane_regen", L.LaneOptions(edit=_fake_edit, vision=vision, whitegap=False, artifact_dir=tmp_path / "art"))
    assert summary["classes"] == {"bird_one": "regenerate"}
    assert "bird_one" in summary["regenerated"]
    # the regenerated sticker is judged again (T4 from the fake judge again -> still refused, not committed)
    assert summary["regenerated"]["bird_one"]["tier"] == 4
    assert summary["stillRefused"] == ["bird_one"] and summary["committed"] == {}
    assert store.read().pointer.content_revision == pointer.content_revision
    assert (tmp_path / "art" / "regen" / "dog_00" / "crop_cutout.png").is_file()

    # second run: the judge now accepts the regeneration -> committed canonically as a new sprite file
    vision = FakeVision(tier=1)
    calls = {"n": 0}

    def judge_second_pass_only(panel, prompt, parse):
        calls["n"] += 1
        # first call = pass 1 (make it regenerate), later calls = pass 2 (accept)
        return {"tier": 4 if calls["n"] == 1 else 1, "why": "x", "backend": "fake", "seconds": 0.0}

    vision.ask = judge_second_pass_only  # type: ignore[method-assign]
    summary = L.run_sticker_lane("lane_regen", L.LaneOptions(edit=_fake_edit, vision=vision, whitegap=False, artifact_dir=tmp_path / "art2"))
    assert summary["regenerated"]["bird_one"]["class"] == "keep"
    committed = summary["committed"]["bird_one"]
    assert committed["disposition"] == "committed"
    current = store.read()
    assert current.pointer.content_revision != pointer.content_revision
    bird = current.snapshot["birds"][0]
    assert bird["sprite"]["asset"]["path"] == "dogs/dog_00/sprite_001.png"
    assert (sdir / "dogs" / "dog_00" / "sprite_001.png").is_file()
    sidecar = json.loads((sdir / "dogs" / "dog_00" / "sprite_001.json").read_text())
    assert sidecar["technique"] == L.TECHNIQUE and sidecar["stickerLane"]["regen"]["pick"] in ("crop", "crop2")
    px, py, pw, ph = bird["sprite"]["placement"]["x"], bird["sprite"]["placement"]["y"], bird["sprite"]["placement"]["width"], bird["sprite"]["placement"]["height"]
    assert abs(px - x) <= 2 and abs(py - y) <= 2 and abs(pw - w) <= 3 and abs(ph - h) <= 3
    c = bird["cleanup"]
    assert c["x"] <= 60 - 8 and c["x"] + c["width"] >= 60 + 8  # the disc is inside the cleanup rect
    assert current.snapshot["reviews"] == {} or "finalCutouts" not in current.snapshot["reviews"]
    from levelbuilder.api.sprite_history import sprite_history
    assert len(sprite_history("lane_regen", "bird_one")) >= 2  # before/after retained for revert


def test_lane_dry_run_never_regenerates_or_commits(isolated_session, tmp_path):
    store, pointer, sdir, _ = _lane_session(isolated_session, "lane_dry")
    spent = {"n": 0}

    def counting_edit(*args, **kwargs):
        spent["n"] += 1
        return _fake_edit(*args, **kwargs)

    summary = L.run_sticker_lane("lane_dry", L.LaneOptions(edit=counting_edit, vision=FakeVision(tier=4, why="pose"), dry_run=True, artifact_dir=tmp_path))
    assert spent["n"] == 0 and summary["committed"] == {} and summary["stillRefused"] == ["bird_one"]
    assert store.read().pointer.content_revision == pointer.content_revision


def test_lane_reports_missing_birds_without_spending(isolated_session, tmp_path):
    _lane_session(isolated_session, "lane_missing")
    spent = {"n": 0}

    def counting_edit(*args, **kwargs):
        spent["n"] += 1
        return _fake_edit(*args, **kwargs)

    summary = L.run_sticker_lane("lane_missing", L.LaneOptions(edit=counting_edit, vision=FakeVision(tier=4, why="no bird in the painted scene"), artifact_dir=tmp_path))
    assert summary["missing"] == ["bird_one"] and spent["n"] == 0


def test_options_from_metadata_round_trip():
    opts = L.options_from_metadata({"birdIds": ["a"], "regenerate": False, "maxCropR": 3.2, "judge": "openrouter", "dryRun": True, "blessActor": "human:x"})
    assert opts.bird_ids == ["a"] and opts.regenerate is False and opts.max_crop_r == 3.2
    assert opts.judge == "openrouter" and opts.dry_run is True and opts.bless_actor == "human:x"
    assert L.options_from_metadata({}).model == L.DEFAULT_REGEN_MODEL


# ── route contract ───────────────────────────────────────────────────────────────────
def test_sticker_lane_route_refuses_bad_inputs(app_client, isolated_session):
    _lane_session(isolated_session, "lane_route")
    assert app_client.get("/api/sessions/lane_route/sticker-lane").status_code == 404
    bad_judge = app_client.post("/api/sessions/lane_route/sticker-lane/jobs", json={"judge": "nope"})
    assert bad_judge.status_code == 400 and bad_judge.json()["detail"]["code"] == "unknown_judge"
    bad_actor = app_client.post("/api/sessions/lane_route/sticker-lane/jobs", json={"blessActor": "gemini"})
    assert bad_actor.status_code == 422
    unknown_bird = app_client.post("/api/sessions/lane_route/sticker-lane/jobs", json={"birdIds": ["ghost"], "judge": "openrouter"})
    assert unknown_bird.status_code == 404
    isolated_session.create_session("lane_legacy", scene_prompt="s", dog_prompt="b", style="clean_old_cartoon", model="m", n_options=1, n_dogs=1)
    legacy = app_client.post("/api/sessions/lane_legacy/sticker-lane/jobs", json={"judge": "openrouter"})
    assert legacy.status_code == 409 and legacy.json()["detail"]["code"] == "canonical_integrity"


# ── scenery gate + breaker + Extract All cap (cotswolds live run, 2026-09-17) ────────────
def test_scenery_gate_trips_on_far_pixels_or_long_boxes_and_not_on_birds():
    hb = {"x": 100, "y": 100, "r": 20}
    bird = np.zeros((40, 40), np.uint8)
    yy, xx = np.ogrid[:40, :40]
    bird[((xx - 20) ** 2 + (yy - 20) ** 2) <= 15 ** 2] = 255
    assert L.is_scenery_sticker(bird, (80, 80, 40, 40), hb) is None
    strip = np.zeros((30, 300), np.uint8)
    strip[14:16, :] = 255  # a wall line through the hitbox
    hit = L.is_scenery_sticker(strip, (0, 85, 300, 30), hb)
    assert hit is not None and hit["farFraction"] > 0.5 and hit["longEdgeR"] == 15.0
    tall = np.zeros((100, 20), np.uint8)
    tall[:, :] = 255
    assert L.is_scenery_sticker(tall, (90, 60, 20, 100), hb)["longEdgeR"] == 5.0


def test_judge_breaker_skips_a_backend_after_repeated_failures(tmp_path):
    panel = tmp_path / "p.png"
    Image.new("RGB", (10, 10)).save(panel)
    calls = {"a": 0}

    def broken(path, prompt):
        calls["a"] += 1
        raise RuntimeError("429")

    def fine(path, prompt):
        return '{"tier": 1, "why": "ok"}'

    judge = L.VisionJudge((("a", broken), ("b", fine)))
    for _ in range(5):
        assert judge.ask(panel, L.TIER_PROMPT, L.parse_tier_json)["backend"] == "b"
    assert calls["a"] == L.JUDGE_BREAKER and "a" in judge.tripped


def test_tier_prompt_carries_the_subject_rule():
    assert "BACKGROUND and must NOT be part of the sprite" in L.TIER_PROMPT
    assert "includes scenery" in L.TIER_PROMPT


def test_lane_regenerates_a_scenery_sticker_even_when_the_judge_likes_it(isolated_session, tmp_path):
    store, pointer, sdir, (x, y, w, h) = _lane_session(isolated_session, "lane_scenery")
    # replace the sticker with a wide wall strip through the hitbox (what a blown-up crop yields)
    strip = np.zeros((10, 100, 4), np.uint8)
    strip[4:6, :, :3] = OUTLINE
    strip[4:6, :, 3] = 255
    Image.fromarray(strip, "RGBA").save(sdir / "dogs" / "dog_00" / "sprite_000.png")
    snapshot = store.read().snapshot
    snapshot["birds"][0]["sprite"]["placement"] = {"x": 10, "y": 40, "width": 100, "height": 10}
    from conftest import restamp_snapshot_assets
    restamp_snapshot_assets(sdir, snapshot)
    store.commit(snapshot, expected_content_revision=pointer.content_revision)
    summary = L.run_sticker_lane("lane_scenery", L.LaneOptions(edit=_fake_edit, vision=FakeVision(tier=2), whitegap=False, artifact_dir=tmp_path))
    assert summary["refit"]["bird_one"].startswith("refused: scenery")
    assert summary["classes"]["bird_one"] == "regenerate"
    assert "bird_one" in summary["regenerated"] and summary["regenerated"]["bird_one"]["class"] == "keep"
    assert summary["committed"]["bird_one"]["disposition"] == "committed"
