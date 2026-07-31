import json

from levelbuilder.cli import main as cli
from tests.test_cli_errors import _StubClient, _run


def test_create_forwards_scale_to_recipe_and_session(monkeypatch, capsys):
    captured = {}

    def record_create(_attempt):
        return {"sessionId": "matrix_01"}

    stub = _StubClient({
        "/api/actions/assemble-recipe-prompts": {
            "scenePrompt": "scene",
            "dogPrompt": "bird",
        },
        "POST /api/sessions": record_create,
    })
    original_post = stub.post

    def recording_post(path, **kwargs):
        captured[path] = kwargs.get("json")
        return original_post(path, **kwargs)

    stub.post = recording_post
    code, _ = _run(monkeypatch, capsys, stub, [
        "create",
        "--setting", "japan",
        "--scene", "japan_morning_market",
        "--style", "clean_old_cartoon",
        "--view", "front",
        "--entity", "bird",
        "--model", "openai/gpt-image-2",
        "--scale", "wide_dense",
        "--count", "15",
    ])

    assert code == 0
    assert captured["/api/actions/assemble-recipe-prompts"]["scale"] == "wide_dense"
    assert captured["/api/sessions"]["scale"] == "wide_dense"


def test_create_forwards_square_aspect_ratio_to_session(monkeypatch, capsys):
    captured = {}
    stub = _StubClient({
        "/api/actions/assemble-recipe-prompts": {
            "scenePrompt": "scene",
            "dogPrompt": "bird",
        },
        "POST /api/sessions": {"sessionId": "square_01"},
    })
    original_post = stub.post

    def recording_post(path, **kwargs):
        captured[path] = kwargs.get("json")
        return original_post(path, **kwargs)

    stub.post = recording_post
    code, _ = _run(monkeypatch, capsys, stub, [
        "create",
        "--setting", "japan",
        "--scene", "japan_morning_market",
        "--style", "clean_old_cartoon",
        "--view", "front",
        "--entity", "bird",
        "--model", "google/gemini-3.1-flash-image-preview",
        "--scale", "standard",
        "--count", "15",
        "--one-shot",
        "--aspect-ratio", "1:1",
    ])

    assert code == 0
    assert captured["/api/sessions"]["aspectRatio"] == "1:1"


def test_inpaint_forwards_magenta_mode_and_model(monkeypatch, capsys):
    captured = {}
    stub = _StubClient({
        "/api/sessions/s1": {
            "setting": "japan",
            "scene": "japan_morning_market",
            "entity": "bird",
            "view": "front",
            "style": "clean_old_cartoon",
            "scale": "standard",
            "hitboxes": [{"x": 10, "y": 20, "r": 4}],
        },
        "/api/actions/assemble-recipe-prompts": {"dogPrompt": "bird"},
        "/api/sessions/s1/inpaint/jobs": {"jobId": "j1", "status": "queued"},
    })
    original_post = stub.post

    def recording_post(path, **kwargs):
        captured[path] = kwargs.get("json")
        return original_post(path, **kwargs)

    stub.post = recording_post
    code, out = _run(monkeypatch, capsys, stub, [
        "inpaint", "s1",
        "--mode", "magenta",
        "--model", "google/gemini-3-pro-image-preview",
        "--hard-percent", "0",
        "--force-disk",
    ])

    assert code == 0, json.loads(out)
    body = captured["/api/sessions/s1/inpaint/jobs"]
    assert body["inpaintMode"] == "magenta"
    assert body["inpaintModel"] == "google/gemini-3-pro-image-preview"
    assert body["hardDogPercent"] == 0
