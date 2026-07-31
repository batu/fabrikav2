"""RED: queue any subset of the three inpaint approaches and compare results.

Design: each selected mode runs in a CLONE of the session (shared background +
hitboxes, isolated dogs/color output), so approaches never clobber each other
and the comparison is three complete images. Magenta gains a durable job kind
in the process (it was SSE-request-owned since the fork).
"""

import json

import pytest


def _seed_session(sess, session_id: str) -> None:
    from PIL import Image

    sdir = sess.LEVELS_DIR / session_id
    sdir.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 96), "green").save(sdir / "bg_00.png")
    (sdir / "hitboxes.json").write_text(json.dumps(
        [{"x": 32, "y": 48, "r": 10, "id": "hb-0"}]))
    (sdir / "session.json").write_text(json.dumps({
        "model": "test/model", "inpaint_model": "test/model", "style": "lineart",
        "setting": "japan", "scene": "japan_morning_market", "entity": "bird",
        "view": "isometric", "dog_prompt": "add exactly one bird",
        "selected_bg": 0, "n_dogs": 1,
        "dogs": [],
    }))


def test_clone_copies_inputs_but_not_outputs(isolated_session):
    from levelbuilder.api.session import clone_session_for_comparison

    sess = isolated_session
    _seed_session(sess, "cmp_seed_01")
    (sess.LEVELS_DIR / "cmp_seed_01" / "dogs" / "dog_00").mkdir(parents=True)
    (sess.LEVELS_DIR / "cmp_seed_01" / "color.png").write_bytes(b"old output")

    clone_id = clone_session_for_comparison("cmp_seed_01", "magenta")
    clone_dir = sess.LEVELS_DIR / clone_id
    assert clone_id != "cmp_seed_01" and "magenta" in clone_id
    assert (clone_dir / "bg_00.png").is_file()
    assert (clone_dir / "hitboxes.json").is_file()
    assert not (clone_dir / "dogs").exists(), "dog outputs must not be cloned"
    assert not (clone_dir / "color.png").exists(), "composited output must not be cloned"
    raw = json.loads((clone_dir / "session.json").read_text())
    assert raw["comparison_of"] == "cmp_seed_01"
    assert raw["comparison_mode"] == "magenta"
    assert raw.get("dogs") == []  # the clone paints its own


def test_reclone_same_mode_replaces_previous(isolated_session):
    from levelbuilder.api.session import clone_session_for_comparison

    sess = isolated_session
    _seed_session(sess, "cmp_seed_02")
    first = clone_session_for_comparison("cmp_seed_02", "crop")
    (sess.LEVELS_DIR / first / "stale.marker").write_bytes(b"")
    second = clone_session_for_comparison("cmp_seed_02", "crop")
    assert second == first
    assert not (sess.LEVELS_DIR / first / "stale.marker").exists()


def test_compare_endpoint_starts_a_job_per_mode(app_client):
    from levelbuilder.api import session as sess

    _seed_session(sess, "cmp_api_01")
    response = app_client.post(
        "/api/sessions/cmp_api_01/compare-inpaint",
        json={"modes": ["crop", "crop_reference", "magenta"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert {entry["mode"] for entry in body["comparisons"]} == {"crop", "crop_reference", "magenta"}
    for entry in body["comparisons"]:
        assert entry["sessionId"].startswith("cmp_api_01")
        assert entry["jobId"]


def test_compare_endpoint_rejects_unknown_mode(app_client):
    from levelbuilder.api import session as sess

    _seed_session(sess, "cmp_api_02")
    response = app_client.post(
        "/api/sessions/cmp_api_02/compare-inpaint", json={"modes": ["crop", "van_gogh"]})
    assert response.status_code == 422


def test_compare_endpoint_requires_background(app_client):
    from levelbuilder.api import session as sess

    session_id = "cmp_api_03"
    sdir = sess.LEVELS_DIR / session_id
    sdir.mkdir(parents=True, exist_ok=True)
    (sdir / "session.json").write_text(json.dumps({"dogs": []}))
    response = app_client.post(
        f"/api/sessions/{session_id}/compare-inpaint", json={"modes": ["crop"]})
    assert response.status_code == 409


def test_run_magenta_inpaint_writes_full_output(isolated_session, monkeypatch):
    from PIL import Image

    from levelbuilder.api import inpaint as inp

    sess = isolated_session
    _seed_session(sess, "cmp_mag_01")
    monkeypatch.setattr(
        inp, "_with_retries_and_timeout",
        lambda fn, *a, **k: Image.new("RGB", (64, 96), "purple"),
    )
    result = inp.run_magenta_inpaint(
        "cmp_mag_01",
        hitbox_list=[{"x": 32, "y": 48, "r": 10, "id": "hb-0"}],
        dog_prompt="add exactly one bird",
        model="test/model",
    )
    sdir = sess.LEVELS_DIR / "cmp_mag_01"
    for name in ("color.png", "inpainted.png", "magenta_overlay.png", "bw.png", "eval.png", "level.json"):
        assert (sdir / name).is_file(), f"missing {name}"
    assert result["colorFile"] == "color.png"
    raw = json.loads((sdir / "session.json").read_text())
    assert raw["inpaint_mode"] == "magenta"
    assert all(d.get("status") == "done" for d in raw["dogs"])
    # and it must leave a generation sidecar like every other paid call
    assert (sdir / "inpainted.gen.json").is_file()


def test_cli_compare_waits_on_every_mode(monkeypatch, capsys):
    from tests.test_cli_errors import _StubClient, _run

    stub = _StubClient({
        "/api/sessions/s1/compare-inpaint": {"sessionId": "s1", "comparisons": [
            {"mode": "crop", "sessionId": "s1__cmp_crop", "jobId": "j1"},
            {"mode": "magenta", "sessionId": "s1__cmp_magenta", "jobId": "j2"},
        ]},
        "/api/jobs/j1": {"status": "succeeded", "id": "j1"},
        "/api/jobs/j2": {"status": "failed_terminal", "id": "j2", "errorMessage": "provider said no"},
    })
    code, out = _run(monkeypatch, capsys, stub,
                     ["compare", "s1", "--modes", "crop,magenta", "--wait", "--force-disk"])
    assert code == 0
    body = json.loads(out)
    by_mode = {c["mode"]: c for c in body["comparisons"]}
    assert by_mode["crop"]["status"] == "succeeded"
    assert by_mode["magenta"]["error"] == "provider said no"
