"""CLI error envelopes and wait semantics (review findings 2, 4, 5, 7, 8)."""

import json

import httpx
import pytest

from levelbuilder.cli import main as cli


class _StubClient:
    """Minimal Client stand-in: scripted per-path responses or exceptions."""

    def __init__(self, script):
        self.script = script
        self.calls = []
        self.base_url = "test://stub"
        self.last_session_revision = None

    def request(self, method, path, **kwargs):
        self.calls.append((method, path))
        # Method-aware lookup: "GET /api/sessions" (listing) and
        # "POST /api/sessions" (create) are different endpoints.
        outcome = self.script.get(f"{method} {path}", self.script.get(path, self.script.get("*")))
        if isinstance(outcome, Exception):
            raise outcome
        if callable(outcome):
            return outcome(len([c for c in self.calls if c[1] == path]))
        return outcome

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, **kw):
        return self.request("POST", path, **kw)


def _run(monkeypatch, capsys, stub, argv):
    monkeypatch.setattr(cli, "Client", lambda url, token: stub)
    code = cli.main(["--json", *argv])
    return code, capsys.readouterr().out


def test_transport_error_gets_structured_envelope(monkeypatch, capsys):
    stub = _StubClient({"*": httpx.ReadError("connection reset")})
    code, out = _run(monkeypatch, capsys, stub, ["sessions"])
    assert code == 2
    error = json.loads(out)["error"]
    assert error["code"] == "transport_error"
    assert "reset" in error["message"]


def test_wait_fails_fast_on_4xx(monkeypatch, capsys):
    stub = _StubClient({
        "/api/sessions/s1/background-generation/jobs": {"jobId": "j1"},
        "/api/jobs/j1": cli.CliError("http_404", "no such job", stage="GET"),
    })
    code, out = _run(monkeypatch, capsys, stub, ["generate-bg", "s1", "--wait", "--force-disk"])
    assert code == 2
    assert json.loads(out)["error"]["code"] == "http_404"
    # One poll attempt, not thirty retries.
    assert len([c for c in stub.calls if c[1] == "/api/jobs/j1"]) == 1


def test_missing_job_id_is_named_error(monkeypatch, capsys):
    stub = _StubClient({"/api/sessions/s1/background-generation/jobs": {}})
    code, out = _run(monkeypatch, capsys, stub, ["generate-bg", "s1", "--wait", "--force-disk"])
    assert code == 2
    assert json.loads(out)["error"]["code"] == "job_id_missing"
    assert not any("/api/jobs/None" in c[1] for c in stub.calls)


def test_wait_survives_transient_transport_blip(monkeypatch, capsys):
    def jobs(attempt):
        if attempt == 1:
            raise httpx.ReadError("blip")
        return {"status": "succeeded", "id": "j1"}

    stub = _StubClient({
        "/api/sessions/s1/background-generation/jobs": {"jobId": "j1"},
        "/api/jobs/j1": jobs,
    })
    monkeypatch.setattr(cli.time, "sleep", lambda _: None)
    code, out = _run(monkeypatch, capsys, stub, ["generate-bg", "s1", "--wait", "--force-disk"])
    assert code == 0
    assert json.loads(out)["status"] == "succeeded"


def test_set_active_requires_variant(monkeypatch, capsys):
    stub = _StubClient({"*": {}})
    code, out = _run(monkeypatch, capsys, stub, ["dogs", "s1", "--set-active", "dog-uuid"])
    assert code == 2
    assert json.loads(out)["error"]["code"] == "variant_required"
    assert stub.calls == []
