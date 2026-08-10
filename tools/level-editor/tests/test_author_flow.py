"""The one-command authoring flow: order, resumability, and dry-run."""

import json

from levelbuilder.cli import main as cli
from tests.test_cli_errors import _StubClient, _run

_TEMPLATE = {
    "id": "t1", "label": "T", "view": "isometric_close_20", "style": "bold_cardboard",
    "entity": "bird", "setting": "japan", "scene": "japan_morning_market",
    "model": "m", "nDogs": 20,
}


def _script() -> dict:
    return {
        "/api/config": {"templates": [_TEMPLATE]},
        "/api/actions/assemble-recipe-prompts": {"scenePrompt": "s", "dogPrompt": "d"},
        "POST /api/sessions": {"sessionId": "auth_1"},
        "GET /api/sessions": [{"id": "auth_1", "catalogUploaded": False}],
        "/api/sessions/auth_1": {"nDogs": 20, "hitboxes": [{"x": 1, "y": 1, "r": 26}] * 20,
                                 "setting": "japan", "scene": "japan_morning_market",
                                 "entity": "bird", "view": "isometric_close_20", "style": "bold_cardboard"},
        "/api/sessions/auth_1/background-generation/jobs": {"jobId": "j1"},
        "/api/sessions/auth_1/upscale-bg/jobs": {"jobId": "j1"},
        "/api/jobs/j1": {"status": "succeeded", "id": "j1", "result": {"backgrounds": 1}},
        "/api/sessions/auth_1/select-bg": {"selectedBgIndex": 0},
        "/api/sessions/auth_1/auto-hitboxes": {"hitboxes": [{"x": 1, "y": 1, "r": 26}] * 20},
        "/api/sessions/auth_1/inpaint/jobs": {"jobId": "j1"},
        "/api/sessions/auth_1/hitbox-review": {"approved": True, "current": True},
        "/api/sessions/auth_1/sprite-gaps": {"missing": []},
        "/api/sessions/auth_1/fix-hitboxes": {"moved": []},
        "/api/sessions/auth_1/approve-catalog": {"ok": True},
        "/api/sessions/auth_1/bundle": {"bundled": True},
        "/api/sequence-workflow": {"liveSequence": {"sequenceVersion": "v1", "catalogRevision": "c1", "levelIds": []},
                                   "draft": {"levelIds": [], "draftRevision": "d1"},
                                   "catalog": {"catalogRevision": "c2"}},
        "/api/sequence-workflow/draft": {"draft": {"draftRevision": "d2"}},
        "/api/sequence-workflow/start": {"id": "j1", "status": "queued"},
    }


def test_dry_run_lists_the_plan_without_calling_anything(monkeypatch, capsys):
    stub = _StubClient(_script())
    code, out = _run(monkeypatch, capsys, stub, ["author", "--template", "t1", "--dry-run"])
    assert code == 0
    assert json.loads(out)["plan"] == list(cli.AUTHOR_STEPS)
    assert stub.calls == []


def test_full_flow_runs_every_step_in_order(monkeypatch, capsys):
    stub = _StubClient(_script())
    code, out = _run(monkeypatch, capsys, stub, ["author", "--template", "t1", "--force-disk"])
    assert code == 0, out
    steps = [entry["step"] for entry in json.loads(out)["trace"]]
    assert steps == ["create", "generate-bg", "select-bg", "upscale", "auto-hitboxes",
                     "inpaint", "hitbox-review-checkpoint", "repair-sprites", "fix-hitboxes", "export"]


def test_stop_after_truncates_the_flow(monkeypatch, capsys):
    stub = _StubClient(_script())
    code, out = _run(monkeypatch, capsys, stub,
                     ["author", "--template", "t1", "--stop-after", "select-bg", "--force-disk"])
    assert code == 0
    steps = [entry["step"] for entry in json.loads(out)["trace"]]
    assert steps == ["create", "generate-bg", "select-bg"]
    assert not any("inpaint" in path for _, path in stub.calls)


def test_author_stops_for_human_hitbox_review_before_cutout_repairs(monkeypatch, capsys):
    script = _script()
    script["/api/sessions/auth_1/hitbox-review"] = {"approved": False, "current": False}
    stub = _StubClient(script)

    code, out = _run(monkeypatch, capsys, stub, ["author", "--template", "t1", "--force-disk"])

    assert code == 2
    payload = json.loads(out)
    assert payload["error"]["code"] == "human_review_required"
    assert payload["error"]["stage"] == "hitbox-review-checkpoint"
    assert "--start-from hitbox-review-checkpoint" in payload["error"]["message"]
    assert not any("sprite-gaps" in path for _, path in stub.calls)


def test_existing_session_is_reused_not_recreated(monkeypatch, capsys):
    stub = _StubClient(_script())
    code, out = _run(monkeypatch, capsys, stub,
                     ["author", "--session-id", "auth_1", "--stop-after", "create", "--force-disk"])
    assert code == 0
    assert json.loads(out)["trace"][0]["detail"] == {"reused": "auth_1"}
    assert not any(method == "POST" and path == "/api/sessions" for method, path in stub.calls)


def test_rc_activation_refusal_is_not_a_failure(monkeypatch, capsys):
    script = _script()
    script["/api/sequence-workflow/start"] = cli.CliError(
        "bundle_projection_invalid", "Remote Config publisher is not configured.", stage="start")
    stub = _StubClient(script)
    code, out = _run(monkeypatch, capsys, stub, ["author", "--template", "t1", "--force-disk"])
    assert code == 0, out
    assert json.loads(out)["trace"][-1]["detail"]["remoteActivation"] == "refused by design"


def test_unknown_template_fails_before_spending(monkeypatch, capsys):
    stub = _StubClient(_script())
    code, out = _run(monkeypatch, capsys, stub, ["author", "--template", "nope", "--force-disk"])
    assert code == 2
    assert json.loads(out)["error"]["code"] == "unknown_template"
    assert not any("background-generation" in path for _, path in stub.calls)


def test_rerun_with_session_id_does_not_redo_paid_work(monkeypatch, capsys):
    """The natural recovery after a partial run is rerunning the same command
    with --session-id; before this guard it re-generated the background and
    re-inpainted every bird (the expensive failure mode)."""
    script = _script()
    script["GET /api/sessions/auth_1"] = {
        "nDogs": 20,
        "hitboxes": [{"x": 1, "y": 1, "r": 26}] * 20,
        "selectedBgIndex": 0,
        "backgrounds": ["bg_00.png"],
        "dogs": [{"index": i, "activeVariant": 0} for i in range(20)],
        "setting": "japan", "scene": "japan_morning_market", "entity": "bird",
        "view": "isometric_close_20", "style": "bold_cardboard",
    }
    stub = _StubClient(script)
    code, out = _run(monkeypatch, capsys, stub, ["author", "--session-id", "auth_1", "--force-disk"])
    assert code == 0, out
    paths = [path for _, path in stub.calls]
    assert not any("background-generation" in p for p in paths), "re-generated a paid background"
    assert not any("inpaint/jobs" in p for p in paths), "re-inpainted painted dogs"
    steps = {entry["step"]: entry["detail"] for entry in json.loads(out)["trace"]}
    assert "skipped" in steps["generate-bg"]
    assert "skipped" in steps["inpaint"]


def test_redo_forces_regeneration(monkeypatch, capsys):
    script = _script()
    script["GET /api/sessions/auth_1"] = {
        "nDogs": 20, "hitboxes": [{"x": 1, "y": 1, "r": 26}] * 20,
        "selectedBgIndex": 0, "backgrounds": ["bg_00.png"],
        "dogs": [{"index": i, "activeVariant": 0} for i in range(20)],
        "setting": "japan", "scene": "japan_morning_market", "entity": "bird",
        "view": "isometric_close_20", "style": "bold_cardboard",
    }
    stub = _StubClient(script)
    code, _ = _run(monkeypatch, capsys, stub,
                   ["author", "--session-id", "auth_1", "--redo", "--force-disk"])
    assert code == 0
    assert any("background-generation" in path for _, path in stub.calls)


def test_failure_reports_session_id_and_resume_hint(monkeypatch, capsys):
    script = _script()
    script["/api/sessions/auth_1/inpaint/jobs"] = cli.CliError("http_500", "provider exploded", stage="POST")
    stub = _StubClient(script)
    code, out = _run(monkeypatch, capsys, stub, ["author", "--template", "t1", "--force-disk"])
    assert code == 2
    payload = json.loads(out)
    assert payload["sessionId"] == "auth_1", "lost the session the run already paid for"
    assert "resume" in payload
    assert [entry["step"] for entry in payload["trace"]][:2] == ["create", "generate-bg"]


def test_repair_budget_is_capped(monkeypatch, capsys):
    """Worst case must stay bounded: gaps x passes without a cap was ~40 paid
    regenerations on a pathological level."""
    script = _script()
    script["/api/sessions/auth_1/sprite-gaps"] = {
        "missing": [{"index": i, "dogId": f"uuid-{i}"} for i in range(20)]
    }
    for index in range(20):
        script[f"/api/sessions/auth_1/dogs/by-id/uuid-{index}/regen"] = {"variantIndex": 1}
    stub = _StubClient(script)
    code, _ = _run(monkeypatch, capsys, stub,
                   ["author", "--template", "t1", "--max-repairs", "3",
                    "--repair-passes", "5", "--force-disk"])
    assert code == 0
    assert sum("/regen" in path for _, path in stub.calls) == 3


def test_rerun_does_not_replace_hitboxes_under_painted_art(monkeypatch, capsys):
    """Re-placing hitboxes on a painted session moves every tap target off its
    bird; the export gate then refuses the whole level."""
    script = _script()
    script["GET /api/sessions/auth_1"] = {
        "nDogs": 20, "hitboxes": [{"x": 1, "y": 1, "r": 26}] * 20,
        "selectedBgIndex": 0, "backgrounds": ["bg_00.png"],
        "dogs": [{"index": i, "activeVariant": 0} for i in range(20)],
        "setting": "japan", "scene": "japan_morning_market", "entity": "bird",
        "view": "isometric_close_20", "style": "bold_cardboard",
    }
    stub = _StubClient(script)
    code, out = _run(monkeypatch, capsys, stub,
                     ["author", "--session-id", "auth_1", "--stop-after", "auto-hitboxes", "--force-disk"])
    assert code == 0
    assert not any("auto-hitboxes" in path for _, path in stub.calls)
