"""Export chain composition (review finding 3) and template count override (8)."""

import json

from levelbuilder.cli import main as cli
from tests.test_cli_errors import _StubClient, _run


_SEQ_STATE = {
    "liveSequence": {"sequenceVersion": "v1", "catalogRevision": "cat-1", "levelIds": []},
    "draft": {"levelIds": [], "draftRevision": "draft-1"},
    "catalog": {"catalogRevision": "cat-2"},
}


def _export_script(catalog_uploaded: bool) -> dict:
    return {
        "/api/sessions": [{"id": "s1", "catalogUploaded": catalog_uploaded}],
        "/api/sessions/s1/approve-catalog": {"ok": True},
        "/api/sessions/s1/bundle": {"bundled": True},
        "/api/sequence-workflow": _SEQ_STATE,
        "/api/sequence-workflow/draft": {"draft": {"draftRevision": "draft-2"}},
        "/api/sequence-workflow/start": {"id": "job-1", "status": "queued"},
    }


def test_export_skips_approve_when_already_cataloged(monkeypatch, capsys):
    stub = _StubClient(_export_script(catalog_uploaded=True))
    code, _ = _run(monkeypatch, capsys, stub, ["export", "s1"])
    assert code == 0
    assert not any("approve-catalog" in path for _, path in stub.calls)


def test_export_approves_when_not_cataloged(monkeypatch, capsys):
    stub = _StubClient(_export_script(catalog_uploaded=False))
    code, _ = _run(monkeypatch, capsys, stub, ["export", "s1"])
    assert code == 0
    assert sum("approve-catalog" in path for _, path in stub.calls) == 1


def test_force_reapprove_overrides_the_skip(monkeypatch, capsys):
    stub = _StubClient(_export_script(catalog_uploaded=True))
    code, _ = _run(monkeypatch, capsys, stub, ["export", "s1", "--force-reapprove"])
    assert code == 0
    assert sum("approve-catalog" in path for _, path in stub.calls) == 1


def test_bundle_failure_stops_before_draft_write(monkeypatch, capsys):
    script = _export_script(catalog_uploaded=True)
    script["/api/sessions/s1/bundle"] = cli.CliError("http_404", "not installed", stage="POST")
    stub = _StubClient(script)
    code, out = _run(monkeypatch, capsys, stub, ["export", "s1"])
    assert code == 2
    assert json.loads(out)["error"]["code"] == "http_404"
    assert not any("sequence-workflow/draft" in path for _, path in stub.calls)


def test_export_order_is_approve_bundle_draft_start(monkeypatch, capsys):
    stub = _StubClient(_export_script(catalog_uploaded=False))
    _run(monkeypatch, capsys, stub, ["export", "s1"])
    ordered = [path for _, path in stub.calls if path.startswith(("/api/sessions/s1", "/api/sequence-workflow"))]
    assert ordered.index("/api/sessions/s1/approve-catalog") < ordered.index("/api/sessions/s1/bundle")
    assert ordered.index("/api/sessions/s1/bundle") < ordered.index("/api/sequence-workflow/draft")
    assert ordered.index("/api/sequence-workflow/draft") < ordered.index("/api/sequence-workflow/start")


def test_create_count_overrides_template(monkeypatch, capsys):
    captured = {}

    def create(_attempt):
        return {"sessionId": "new_session"}

    script = {
        "/api/config": {"templates": [{
            "id": "t1", "label": "T", "view": "isometric", "style": "lineart",
            "entity": "bird", "setting": "japan", "scene": "japan_morning_market",
            "model": "m", "nDogs": 15,
        }]},
        "/api/actions/assemble-recipe-prompts": {"scenePrompt": "s", "dogPrompt": "d"},
        "/api/sessions": create,
    }
    stub = _StubClient(script)
    original = stub.request

    def spy(method, path, **kwargs):
        if path == "/api/sessions" and method == "POST":
            captured.update(kwargs.get("json") or {})
        return original(method, path, **kwargs)

    stub.request = spy
    code, _ = _run(monkeypatch, capsys, stub, ["create", "--template", "t1", "--count", "7"])
    assert code == 0
    assert captured["nDogs"] == 7


def test_template_ndogs_used_when_count_omitted(monkeypatch, capsys):
    """The line-art template ships nDogs=15; omitting --count must not force 20."""
    captured = {}
    script = {
        "/api/config": {"templates": [{
            "id": "t1", "label": "T", "view": "isometric", "style": "lineart",
            "entity": "bird", "setting": "japan", "scene": "japan_morning_market",
            "model": "m", "nDogs": 15,
        }]},
        "/api/actions/assemble-recipe-prompts": {"scenePrompt": "s", "dogPrompt": "d"},
        "/api/sessions": {"sessionId": "new_session"},
    }
    stub = _StubClient(script)
    original = stub.request

    def spy(method, path, **kwargs):
        if path == "/api/sessions" and method == "POST":
            captured.update(kwargs.get("json") or {})
        return original(method, path, **kwargs)

    stub.request = spy
    code, _ = _run(monkeypatch, capsys, stub, ["create", "--template", "t1"])
    assert code == 0
    assert captured["nDogs"] == 15


def test_auto_hitboxes_defaults_to_session_count(monkeypatch, capsys):
    """Bare `auto-hitboxes <id>` must not send nDogs: null (server 422s)."""
    captured = {}
    stub = _StubClient({
        "/api/sessions/s1": {"nDogs": 18, "hitboxes": []},
        "/api/sessions/s1/auto-hitboxes": {"hitboxes": [{"x": 1, "y": 1, "r": 26}] * 18},
    })
    original = stub.request

    def spy(method, path, **kwargs):
        if path.endswith("/auto-hitboxes"):
            captured.update(kwargs.get("json") or {})
        return original(method, path, **kwargs)

    stub.request = spy
    code, _ = _run(monkeypatch, capsys, stub, ["auto-hitboxes", "s1"])
    assert code == 0
    assert captured["nDogs"] == 18


def test_auto_hitboxes_shrinks_radius_until_placement_fits(monkeypatch, capsys):
    """Placement fails closed when the radius is too big for the scene; the
    verb shrinks and retries instead of making a human guess."""
    radii = []

    def placement(_attempt):
        radius = radii[-1]
        if radius > 24:
            raise cli.CliError("http_502", '{"code": "smart_hitboxes_failed"}', stage="POST")
        return {"hitboxes": [{"x": 1, "y": 1, "r": radius}] * 20}

    stub = _StubClient({
        "/api/sessions/s1": {"nDogs": 20, "hitboxes": []},
        "/api/sessions/s1/auto-hitboxes": placement,
    })
    original = stub.request

    def spy(method, path, **kwargs):
        if path.endswith("/auto-hitboxes"):
            radii.append((kwargs.get("json") or {})["radius"])
        return original(method, path, **kwargs)

    stub.request = spy
    code, out = _run(monkeypatch, capsys, stub, ["auto-hitboxes", "s1", "--radius", "30"])
    assert code == 0
    assert radii == [30, 28, 26, 24]
    assert json.loads(out)["radiusUsed"] == 24


def test_auto_hitboxes_gives_up_below_min_radius(monkeypatch, capsys):
    def never_fits(_attempt):
        raise cli.CliError("http_502", '{"code": "smart_hitboxes_failed"}', stage="POST")

    stub = _StubClient({
        "/api/sessions/s1": {"nDogs": 20, "hitboxes": []},
        "/api/sessions/s1/auto-hitboxes": never_fits,
    })
    code, out = _run(monkeypatch, capsys, stub, ["auto-hitboxes", "s1", "--radius", "24", "--min-radius", "20"])
    assert code == 2
    assert json.loads(out)["error"]["code"] == "placement_did_not_fit"



def test_partial_placement_is_treated_as_did_not_fit(monkeypatch, capsys):
    """The random placer returns 200 with FEWER hitboxes than requested; that
    must trigger the shrink path, not report success."""
    seen = []

    def partial(_attempt):
        radius = seen[-1]
        count = 20 if radius <= 24 else 5
        return {"hitboxes": [{"x": 1, "y": 1, "r": radius}] * count}

    stub = _StubClient({
        "/api/sessions/s1": {"nDogs": 20, "hitboxes": []},
        "/api/sessions/s1/auto-hitboxes": partial,
    })
    original = stub.request

    def spy(method, path, **kwargs):
        if path.endswith("/auto-hitboxes"):
            seen.append((kwargs.get("json") or {})["radius"])
        return original(method, path, **kwargs)

    stub.request = spy
    code, out = _run(monkeypatch, capsys, stub, ["auto-hitboxes", "s1", "--radius", "30", "--strategy", "random"])
    assert code == 0
    assert json.loads(out)["radiusUsed"] == 24
    assert seen == [30, 28, 26, 24]


def test_shrink_step_zero_is_rejected(monkeypatch, capsys):
    stub = _StubClient({"/api/sessions/s1": {"nDogs": 20, "hitboxes": []}})
    code, out = _run(monkeypatch, capsys, stub, ["auto-hitboxes", "s1", "--shrink-step", "0"])
    assert code == 2
    assert json.loads(out)["error"]["code"] == "bad_shrink_step"
