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


def test_cutouts_extract_forwards_selected_stable_ids_model_and_crop_boxes(monkeypatch, capsys):
    captured = {}
    stub = _StubClient({
        "/api/sessions/s1": {
            "setting": "japan", "scene": "market", "entity": "bird",
            "view": "front", "style": "clean_old_cartoon",
            "bgWidth": 400, "bgHeight": 300,
            "dogs": [
                {"id": "bird-a", "index": 3, "activeVariant": 0},
                {"id": "bird-b", "index": 9, "activeVariant": 0},
            ],
            "hitboxes": [
                {"id": "bird-a", "x": 80, "y": 90, "r": 20},
                {"id": "bird-b", "x": 180, "y": 120, "r": 25},
            ],
        },
        "/api/sessions/s1/cutout-extraction-prompt": {"prompt": "Extract one bird only."},
        "/api/sessions/s1/dogs/retry-inpaint/jobs": {"jobId": "cutout-j1", "status": "queued"},
    })
    original_post = stub.post

    def recording_post(path, **kwargs):
        captured[path] = kwargs.get("json")
        return original_post(path, **kwargs)

    stub.post = recording_post
    code, out = _run(monkeypatch, capsys, stub, [
        "cutouts", "s1", "--operation", "extract",
        "--dog", "bird-a", "--dog", "bird-b",
        "--crop-box", "bird-b=100,40,260,210",
        "--model", "google/gemini-3.1-flash-lite-image",
    ])

    assert code == 0, out
    body = captured["/api/sessions/s1/dogs/retry-inpaint/jobs"]
    assert body == {
        "dogIndices": [3, 9],
        "prompt": "Extract one bird only.",
        "inpaintModel": "google/gemini-3.1-flash-lite-image",
        "padding": 2.75,
        "cropBoxes": {3: [25, 35, 135, 145], 9: [100, 40, 260, 210]},
        "cutoutOnly": True,
    }


def test_cutouts_rejects_unknown_stable_id_before_submitting(monkeypatch, capsys):
    stub = _StubClient({
        "/api/sessions/s1": {
            "dogs": [{"id": "bird-a", "index": 0}],
            "hitboxes": [{"id": "bird-a", "x": 50, "y": 50, "r": 10}],
        },
    })

    code, out = _run(monkeypatch, capsys, stub, ["cutouts", "s1", "--dog", "missing"])

    assert code == 2
    assert json.loads(out)["error"]["code"] == "dog_not_found"
    assert not any(path.endswith("retry-inpaint/jobs") for _, path in stub.calls)
