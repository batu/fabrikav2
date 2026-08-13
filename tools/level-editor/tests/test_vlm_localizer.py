"""T1 (one-path lane plan, 2026-08-13): detections are truth.

The ONE post-paint localizer: VLM detections become the hitboxes. Existing
bird ids persist by nearest-assignment (continuity, nothing more); detections
with no partner become new birds; dots the model ignored are pruned. Radius
is the uniform catalog radius. No count opinion — however many birds the VLM
sees, that is the level."""
from types import SimpleNamespace


def _wire(monkeypatch, detections, existing, saved):
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    monkeypatch.setattr(I, "detect_birds_vlm", lambda sid, **kw: detections)
    monkeypatch.setattr(I, "_load_retry_hitboxes", lambda sid: existing)
    monkeypatch.setattr(S, "save_hitboxes", lambda sid, payload: saved.append(payload) or payload)
    monkeypatch.setattr(I, "uniform_hitbox_radius", lambda dim: 57)
    monkeypatch.setattr(I, "_scene_dimension", lambda sid: 2688, raising=False)


def test_detections_become_hitboxes_with_id_continuity(monkeypatch):
    from levelbuilder.api import inpaint as I

    saved = []
    _wire(
        monkeypatch,
        detections=[
            {"x": 90, "y": 90, "width": 20, "height": 20},     # near bird-a
            {"x": 1990, "y": 1990, "width": 20, "height": 20}, # new bird (no dot)
        ],
        existing=[
            {"id": "bird-a", "x": 100, "y": 100, "r": 57},
            {"id": "bird-b", "x": 500, "y": 500, "r": 57},     # model ignored it
        ],
        saved=saved,
    )
    result = I.localize_hitboxes_from_detections("sid")
    payload = saved[0]
    by_id = {h.get("id"): h for h in payload if h.get("id")}
    assert by_id["bird-a"]["x"] == 100 and by_id["bird-a"]["y"] == 100  # det center
    assert "bird-b" not in by_id                                        # pruned
    anonymous = [h for h in payload if not h.get("id")]
    assert len(anonymous) == 1 and anonymous[0]["x"] == 2000            # new bird
    assert all(h["r"] == 57 for h in payload)                           # uniform radius
    assert result["detected"] == 2 and result["carried"] == 1
    assert result["pruned"] == 1 and result["added"] == 1


def test_no_detections_is_a_loud_noop(monkeypatch):
    from levelbuilder.api import inpaint as I

    saved = []
    _wire(monkeypatch, detections=[], existing=[{"id": "a", "x": 1, "y": 2, "r": 57}], saved=saved)
    result = I.localize_hitboxes_from_detections("sid")
    assert saved == []                       # never wipe a level on a blind VLM
    assert result["detected"] == 0 and result.get("skipped") == "no_detections"


def test_stage_uses_the_vlm_localizer_and_stamps_vlm_snap(monkeypatch):
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    calls = []
    monkeypatch.setattr(I, "localize_hitboxes_from_detections",
                        lambda sid: calls.append("localize") or {"detected": 3})
    monkeypatch.setattr(S, "adopt_canonical_if_ready", lambda sid: calls.append("adopt") or None)
    monkeypatch.setattr(S, "stamp_hitbox_localization",
                        lambda sid, method: calls.append(f"stamp:{method}"))
    summary = I._discharge_paint_obligations("sid", {})
    assert calls == ["localize", "adopt", "stamp:vlm-snap"]
    assert summary["localization"] == {"detected": 3}


def test_localizer_resyncs_dogs_to_the_new_id_set(monkeypatch):
    """Live gate find (2026-08-13): the localizer rewrote the hitbox id set
    but dogs[] kept paint-time ids -> adoption quarantined on
    bird_id_set_mismatch. The localizer owns the resync: dogs[] must equal
    the new hitbox id set exactly — ghosts removed, new birds added."""
    from levelbuilder.api import inpaint as I
    from levelbuilder.api import session as S

    saved = []
    _wire(
        monkeypatch,
        detections=[{"x": 90, "y": 90, "width": 20, "height": 20}],
        existing=[
            {"id": "bird-a", "x": 100, "y": 100, "r": 57},
            {"id": "bird-ghost", "x": 2000, "y": 2000, "r": 57},
        ],
        saved=saved,
    )
    resynced = []
    monkeypatch.setattr(I, "_resync_dogs_to_hitboxes",
                        lambda sid, payload: resynced.append([h.get("id") for h in payload]))
    I.localize_hitboxes_from_detections("sid")
    assert resynced and resynced[0] == ["bird-a"]


def test_migration_plan_accepts_magenta_preextraction_birds(tmp_path):
    """Live gate find #2 (2026-08-13): after a magenta paint, dogs are done
    with NO variant (sprites come from cutouts later). The planner must
    migrate that shape as sprite-less birds — the contract allows them and
    the DAG carries their extract obligations — not quarantine the level."""
    import json
    from PIL import Image
    from levelbuilder.api.corpus_migration import plan_legacy_level

    d = tmp_path / "lvl"
    d.mkdir()
    Image.new("RGB", (64, 64), (10, 10, 10)).save(d / "color.png")
    Image.new("RGB", (64, 64), (20, 20, 20)).save(d / "bg_00.png")
    Image.new("RGB", (64, 64), (10, 10, 10)).save(d / "inpainted.png")
    (d / "hitboxes.json").write_text(json.dumps(
        [{"id": "2a0e1562-1040-583e-aed6-54542259ad0d", "x": 30, "y": 30, "r": 10}]))
    (d / "session.json").write_text(json.dumps({
        "id": "lvl", "selected_bg": 0, "inpaint_mode": "magenta",
        "dogs": [{"id": "2a0e1562-1040-583e-aed6-54542259ad0d", "index": 0, "status": "done", "activeVariant": None}],
    }))
    (d / "level.json").write_text(json.dumps({
        "id": "lvl", "width": 64, "height": 64,
        "colorImage": "color.png", "bwImage": "color.png",
        "dogs": [{"id": "dog_00", "x": 30, "y": 30, "r": 10}],
    }))
    plan = plan_legacy_level(d, None, archived=False)
    assert plan.action == "migrate", (plan.action, plan.issues)
