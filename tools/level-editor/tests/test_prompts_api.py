"""D1 PROMPTS tab — the GET /prompts list endpoint (plan 2026-06-10-002)."""

from __future__ import annotations


def test_list_prompts_returns_all_kinds(isolated_session, tmp_path, monkeypatch) -> None:
    from levelbuilder.api import prompts as P

    monkeypatch.setattr(P, "_LIBRARY_PATH", tmp_path / "prompts_library.json")
    P.save_prompt("view:isometric", "iso v1")
    P.save_prompt("view:isometric", "iso v2")
    P.save_prompt("inpaint:default", "inpaint v1")

    lib = P.list_prompts()
    assert sorted(lib) == ["inpaint:default", "view:isometric"]
    assert lib["view:isometric"].default_version == 2
    assert [v.text for v in lib["view:isometric"].versions] == ["iso v1", "iso v2"]

    # wire shape through the route
    from fastapi.testclient import TestClient
    from levelbuilder.api.server import app

    client = TestClient(app)
    resp = client.get("/api/prompts")
    assert resp.status_code == 200
    body = resp.json()
    assert body["view:isometric"]["default_version"] == 2
