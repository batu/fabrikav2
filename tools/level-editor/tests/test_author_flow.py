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
        "/api/jobs/j1": {"status": "succeeded", "id": "j1", "result": {"backgrounds": 1}},
        "/api/sessions/auth_1/select-bg": {"selectedBgIndex": 0},
        "/api/sessions/auth_1/auto-hitboxes": {"hitboxes": [{"x": 1, "y": 1, "r": 26}] * 20},
        "/api/sessions/auth_1/inpaint/jobs": {"jobId": "j1"},
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
    assert steps == ["create", "generate-bg", "select-bg", "auto-hitboxes",
                     "inpaint", "repair-sprites", "fix-hitboxes", "export"]


def test_stop_after_truncates_the_flow(monkeypatch, capsys):
    stub = _StubClient(_script())
    code, out = _run(monkeypatch, capsys, stub,
                     ["author", "--template", "t1", "--stop-after", "select-bg", "--force-disk"])
    assert code == 0
    steps = [entry["step"] for entry in json.loads(out)["trace"]]
    assert steps == ["create", "generate-bg", "select-bg"]
    assert not any("inpaint" in path for _, path in stub.calls)


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
