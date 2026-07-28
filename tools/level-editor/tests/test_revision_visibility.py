"""Two-actor collision visibility (KTD6): the revision stamp must actually
move when a session changes, so a second actor can notice."""

import json


def test_revision_header_present_and_advances(app_client, tmp_path) -> None:
    from levelbuilder.api import session as sess

    session_id = "revision_probe_ab12"
    sdir = sess.LEVELS_DIR / session_id
    sdir.mkdir(parents=True, exist_ok=True)
    (sdir / "session.json").write_text(json.dumps({"dogs": []}))
    (sdir / "hitboxes.json").write_text(json.dumps([{"x": 10, "y": 10, "r": 20}]))

    first = app_client.get(f"/api/sessions/{session_id}")
    initial = first.headers.get("X-Session-Revision")
    assert initial is not None

    # Any write to session.json must move the stamp (mtime_ns granularity).
    (sdir / "session.json").write_text(json.dumps({"dogs": [], "touched": True}))
    second = app_client.get(f"/api/sessions/{session_id}")
    assert second.headers["X-Session-Revision"] != initial
    assert int(second.headers["X-Session-Revision"]) > int(initial)


def test_revision_absent_for_unknown_session(app_client) -> None:
    response = app_client.get("/api/sessions/definitely_not_here_9z")
    assert "X-Session-Revision" not in response.headers


def test_cli_warns_when_revision_does_not_move(monkeypatch, capsys) -> None:
    """A mutation that leaves the revision unchanged means another actor's
    write won — the CLI must say so rather than reporting clean success."""
    import httpx

    from levelbuilder.cli import main as cli

    class _FrozenRevisionTransport(httpx.BaseTransport):
        def handle_request(self, request):
            return httpx.Response(
                200,
                json={"ok": True},
                headers={"X-Session-Revision": "111", "content-type": "application/json"},
            )

    client = cli.Client("http://stub", None)
    client._http = httpx.Client(transport=_FrozenRevisionTransport(), base_url="http://stub")
    client.get("/api/sessions/s1")
    client.post("/api/sessions/s1/hitboxes", json={})
    assert "revision unchanged" in capsys.readouterr().err
