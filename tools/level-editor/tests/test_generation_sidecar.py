"""RED: every generation writes a `<image>.gen.json` sidecar with the full
prompt and the parameters that produced it, and the API can list them.

Batu's ask: "Every generation should have its prompt saved as a config obj
next to it for reference and other useful information."
"""

import json
from pathlib import Path

import pytest


def test_sidecar_written_next_to_image(tmp_path: Path):
    from levelbuilder.api.inpaint import write_generation_sidecar

    image = tmp_path / "bg_00.png"
    image.write_bytes(b"png")
    write_generation_sidecar(image, kind="background", prompt="a very long scene prompt",
                             model="google/gemini-3.1-flash-image-preview",
                             params={"aspectRatio": "9:16", "imageSize": "1K"})
    sidecar = tmp_path / "bg_00.gen.json"
    assert sidecar.is_file()
    data = json.loads(sidecar.read_text())
    assert data["kind"] == "background"
    assert data["prompt"] == "a very long scene prompt"
    assert data["model"].startswith("google/")
    assert data["params"]["aspectRatio"] == "9:16"
    assert "createdAt" in data


def test_sidecar_tolerates_unserializable_extras(tmp_path: Path):
    """Provider metadata sometimes carries objects; the sidecar must degrade
    to strings rather than crash the paid generation that just succeeded."""
    from levelbuilder.api.inpaint import write_generation_sidecar

    image = tmp_path / "variant_000.png"
    image.write_bytes(b"png")
    write_generation_sidecar(image, kind="crop_inpaint", prompt="p", model="m",
                             params={"weird": object()})
    data = json.loads((tmp_path / "variant_000.gen.json").read_text())
    assert "weird" in data["params"]


def test_generations_endpoint_lists_sidecars(app_client):
    from levelbuilder.api import session as sess

    session_id = "sidecar_probe_01"
    sdir = sess.LEVELS_DIR / session_id
    (sdir / "dogs" / "dog_00").mkdir(parents=True, exist_ok=True)
    (sdir / "session.json").write_text("{}")
    (sdir / "bg_00.gen.json").write_text(json.dumps(
        {"kind": "background", "prompt": "scene prompt", "model": "m", "params": {}, "createdAt": "t"}))
    (sdir / "dogs" / "dog_00" / "variant_000.gen.json").write_text(json.dumps(
        {"kind": "crop_inpaint", "prompt": "bird prompt", "model": "m", "params": {}, "createdAt": "t"}))

    response = app_client.get(f"/api/sessions/{session_id}/generations")
    assert response.status_code == 200
    body = response.json()
    files = {entry["file"]: entry for entry in body["generations"]}
    assert "bg_00.gen.json" in files
    assert "dogs/dog_00/variant_000.gen.json" in files
    assert files["bg_00.gen.json"]["prompt"] == "scene prompt"


def test_generations_endpoint_skips_corrupt_sidecars(app_client):
    from levelbuilder.api import session as sess

    session_id = "sidecar_probe_02"
    sdir = sess.LEVELS_DIR / session_id
    sdir.mkdir(parents=True, exist_ok=True)
    (sdir / "session.json").write_text("{}")
    (sdir / "bg_00.gen.json").write_text("{broken")
    response = app_client.get(f"/api/sessions/{session_id}/generations")
    assert response.status_code == 200
    assert response.json()["generations"] == []


def test_review_verb_downloads_generations(monkeypatch, capsys, tmp_path):
    from tests.test_cli_errors import _StubClient, _run

    import levelbuilder.cli.main as cli

    stub = _StubClient({
        "/api/sessions/s1": {"dogs": []},
        "/api/sessions/s1/generations": {"sessionId": "s1", "generations": [
            {"file": "bg_00.gen.json", "kind": "background", "prompt": "p"}]},
        # image fetches 404 in this stub; review tolerates that
        "*": cli.CliError("http_404", "nope", stage="GET"),
    })
    out_dir = tmp_path / "review"
    code, out = _run(monkeypatch, capsys, stub, ["review", "s1", "--out", str(out_dir)])
    assert code == 0
    import json as _json
    listing = _json.loads(out)
    assert "generations.json" in listing["files"]
    saved = _json.loads((out_dir / "generations.json").read_text())
    assert saved["generations"][0]["prompt"] == "p"
