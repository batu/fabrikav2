from __future__ import annotations

from fastapi import FastAPI


def test_same_origin_bootstrap_delivers_launch_credential(client, launch_credential: str) -> None:
    response = client.get("/bootstrap")

    assert response.status_code == 200
    assert response.json() == {"launchCredential": launch_credential}
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_hostile_host_cannot_read_bootstrap(client) -> None:
    response = client.get("/bootstrap", headers={"Host": "testserver.attacker.test"})
    assert response.status_code == 400
    assert "launchCredential" not in response.text


def test_hostile_origin_cannot_read_bootstrap(client) -> None:
    response = client.get("/bootstrap", headers={"Origin": "https://attacker.test"})
    assert response.status_code == 403
    assert "launchCredential" not in response.text


def test_missing_or_invalid_credential_cannot_read_api(client) -> None:
    assert client.get("/api/status").status_code == 401
    assert (
        client.get(
            "/api/status", headers={"X-FTD-Launch-Credential": "not-the-credential"}
        ).status_code
        == 401
    )


def test_valid_credential_reads_api(client, authorized_headers: dict[str, str]) -> None:
    response = client.get("/api/status", headers=authorized_headers)
    assert response.status_code == 200
    assert response.json()["providerMode"] == "fail-closed"
    assert response.json()["workerMode"] == "manual"


def test_hostile_preflight_fails_closed(client) -> None:
    response = client.options(
        "/api/status",
        headers={
            "Origin": "https://attacker.test",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-FTD-Launch-Credential",
        },
    )
    assert response.status_code == 403
    assert "access-control-allow-origin" not in response.headers


def test_same_origin_preflight_is_narrow(client) -> None:
    response = client.options(
        "/api/status",
        headers={
            "Origin": "http://testserver",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-FTD-Launch-Credential",
        },
    )
    assert response.status_code == 204
    assert response.headers["access-control-allow-origin"] == "http://testserver"
    assert response.headers["access-control-allow-methods"] == "GET"
    assert response.headers["access-control-allow-headers"] == "X-FTD-Launch-Credential"


def test_mutation_requires_exact_origin_before_handler_runs(
    app: FastAPI,
    client,
    authorized_headers: dict[str, str],
) -> None:
    calls: list[str] = []

    @app.post("/api/_fixture/mutate")
    def mutate() -> dict[str, bool]:
        calls.append("called")
        return {"ok": True}

    hostile = client.post(
        "/api/_fixture/mutate",
        headers={**authorized_headers, "Origin": "https://attacker.test"},
    )
    missing = client.post("/api/_fixture/mutate", headers=authorized_headers)
    accepted = client.post(
        "/api/_fixture/mutate",
        headers={**authorized_headers, "Origin": "http://testserver"},
    )

    assert hostile.status_code == 403
    assert missing.status_code == 403
    assert accepted.status_code == 200
    assert calls == ["called"]


def test_assets_and_downloads_are_credential_protected_even_when_unmatched(client) -> None:
    assert client.get("/assets/missing.js").status_code == 401
    assert client.get("/downloads/missing.png").status_code == 401


def test_credential_in_query_string_is_never_accepted(client, launch_credential: str) -> None:
    response = client.get(f"/api/status?credential={launch_credential}")
    assert response.status_code == 401
