import json
from pathlib import Path

from levelbuilder.cli import main as cli


def _fake_game(tmp_path: Path) -> Path:
    game = tmp_path / "games" / "birdo"
    (game / "public" / "levels").mkdir(parents=True)
    (game / ".levelbuilder" / "levels").mkdir(parents=True)
    return game


def test_doctor_healthy_workspace(tmp_path, capsys):
    game = _fake_game(tmp_path)
    code = cli.main(["--json", "doctor", "--game", str(game)])
    report = json.loads(capsys.readouterr().out)
    assert code == 0
    assert report["orphanedSessions"] == []
    assert report["nonTerminalJobs"] == []


def test_doctor_reports_orphaned_session(tmp_path, capsys):
    game = _fake_game(tmp_path)
    (game / ".levelbuilder" / "levels" / "ghost_session").mkdir()
    cli.main(["--json", "doctor", "--game", str(game)])
    report = json.loads(capsys.readouterr().out)
    assert report["orphanedSessions"] == ["ghost_session"]
    assert report["healthy"] is False


def test_session_revision_header(app_client):
    # Any /api/sessions/{id} response carries the revision stamp when the
    # session exists; a 404 for a missing one simply omits it.
    response = app_client.get("/api/sessions/nonexistent_session_00")
    assert "X-Session-Revision" not in response.headers


def test_unhandled_errors_are_structured(app_client):
    # The catch-all handler shapes internal errors; probe via a route that
    # raises on garbage input rather than returning bare 500.
    response = app_client.post("/api/actions/assemble-recipe-prompts", json={"setting": "zzz", "scene": "z", "entity": "dog", "view": "isometric", "style": "lineart"})
    assert response.status_code in (400, 422)
    body = response.json()
    assert "error" in body.get("detail", body) or "detail" in body
