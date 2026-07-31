"""CLI contract against the real app (scripted, provider-free)."""

import json

import pytest

from levelbuilder.cli import main as cli


@pytest.fixture()
def run(app_client, monkeypatch, capsys):
    """Run a CLI verb against the in-process test app via httpx transport."""
    import httpx

    class AppClient(cli.Client):
        def __init__(self, base_url, token):
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            self._http = httpx.Client(
                transport=httpx.WSGITransport(app=None), base_url=base_url, headers=headers
            )
            self.base_url = base_url

    def _run(*argv: str) -> tuple[int, str]:
        monkeypatch.setattr(
            cli, "Client", lambda url, token: _TestClientAdapter(app_client)
        )
        code = cli.main(["--json", *argv])
        out = capsys.readouterr().out
        return code, out

    class _TestClientAdapter:
        def __init__(self, tc):
            self._tc = tc
            self.base_url = "test://app"

        def request(self, method, path, **kwargs):
            response = self._tc.request(method, path, **kwargs)
            if response.status_code >= 400:
                raise cli.CliError(f"http_{response.status_code}", response.text[:300], stage=f"{method} {path}")
            if response.headers.get("content-type", "").startswith("application/json"):
                return response.json()
            return response.content

        def get(self, path, **kw):
            return self.request("GET", path, **kw)

        def post(self, path, **kw):
            return self.request("POST", path, **kw)

    return _run


def test_sessions_empty_json(run):
    code, out = run("sessions")
    assert code == 0
    assert json.loads(out) == []


def test_config_verb(run):
    code, out = run("config")
    assert code == 0
    config = json.loads(out)
    assert "bold_cardboard" in config["styles"]


def test_unknown_template_fails_closed(run):
    code, out = run("create", "--template", "nope")
    assert code == 2
    error = json.loads(out)["error"]
    assert error["code"] == "unknown_template"


def test_validate_verb_offline(tmp_path, monkeypatch, capsys):
    # validate is server-free; point it at an empty fake game.
    game = tmp_path / "games" / "birdo"
    (game / "public" / "levels").mkdir(parents=True)
    (tmp_path / ".git").mkdir()
    code = cli.main(["--json", "validate", "--game", str(game)])
    out = capsys.readouterr().out
    assert code == 0
    assert json.loads(out)["ok"] is True


def test_create_from_template_appears_in_sessions(run):
    code, out = run("create", "--template", "ftb-cardboard-forest")
    assert code == 0, out
    created = json.loads(out)
    session_id = created["sessionId"]
    assert "bird" in session_id
    code, out = run("sessions")
    assert code == 0
    ids = [s["id"] for s in json.loads(out)]
    assert session_id in ids
