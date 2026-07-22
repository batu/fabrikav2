from __future__ import annotations

from fastapi.testclient import TestClient

from conftest import seed_publishing_catalog
from ftd_editor.app import (
    AppComponents,
    EditorStores,
    FailClosedProviders,
    ManualWorker,
    create_app,
)
from ftd_editor.approvals import expected_acknowledgement
from ftd_editor.publishing.sequence import PublishingService


def publishing_app(editor_settings, jobs_env):
    seed_publishing_catalog(editor_settings.workspace.public)
    publishing = PublishingService(
        public_root=editor_settings.workspace.public,
        state_root=editor_settings.workspace.state / "publishing",
        approvals=jobs_env.approvals,
    )
    app = create_app(
        editor_settings,
        AppComponents(
            stores=EditorStores(
                sessions=jobs_env.sessions,
                jobs=jobs_env.service,
                publishing=publishing,
            ),
            worker=ManualWorker(),
            providers=FailClosedProviders(),
            redactor=jobs_env.redactor,
        ),
    )
    return app, publishing


def headers(app):
    return {
        "Host": "testserver",
        "Origin": "http://testserver",
        "X-FTD-Launch-Credential": app.state.launch_credential,
    }


def full_session() -> dict:
    return {
        "id": "level-01",
        "name": "Level 01",
        "width": 100,
        "height": 200,
        "colorImage": "color.webp",
        "dogs": [{"index": 0, "id": "dog_00", "x": 50, "y": 100, "r": 10}],
    }


def test_publishing_preview_grant_activation_and_snapshot_are_typed_actions(
    editor_settings, jobs_env
) -> None:
    app, publishing = publishing_app(editor_settings, jobs_env)
    with TestClient(app, raise_server_exceptions=False) as client:
        preview = client.post(
            "/api/publishing/previews",
            headers=headers(app),
            json={
                "sequenceVersion": "seq-1",
                "levelIds": ["starter", "later"],
                "catalogRevision": "catalog-1",
                "changelog": "Ship safely",
                "actor": "human:batu",
                "sourceRevision": "catalog-1",
            },
        )
        assert preview.status_code == 201, preview.text
        candidate = preview.json()
        grant = jobs_env.approvals.mint(
            actor="human:batu",
            action_kind="publish_sequence",
            request_binding=candidate["digest"],
            source_revision="catalog-1",
            acknowledgement=expected_acknowledgement(
                "publish_sequence", candidate["digest"]
            ),
        )
        activated = client.post(
            "/api/publishing/activate",
            headers=headers(app),
            json={
                "candidateId": candidate["candidateId"],
                "grantId": grant.grant_id,
                "remote": False,
            },
        )
        snapshot = client.get("/api/publishing", headers=headers(app))

    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == "succeeded"
    assert snapshot.json()["selected"]["sequenceVersion"] == "seq-1"
    operation = app.openapi()["paths"]["/api/publishing/activate"]["post"]
    assert operation["x-ftd-approval"] == "single-use-digest-bound"
    assert operation["x-ftd-side-effects"] == "public-sequence-selection"


def test_export_dry_run_is_revision_bound_side_effect_free_and_writes_nothing(
    editor_settings, jobs_env
) -> None:
    app, _ = publishing_app(editor_settings, jobs_env)
    before = tuple(editor_settings.workspace.public.rglob("*"))
    with TestClient(app, raise_server_exceptions=False) as client:
        created = client.post(
            "/api/sessions",
            headers=headers(app),
            json={"session": full_session()},
        ).json()
        dry_run = client.post(
            "/api/publishing/export-dry-run",
            headers=headers(app),
            json={"sessionId": "level-01", "revision": created["revision"]},
        )

    assert dry_run.status_code == 200, dry_run.text
    assert dry_run.json() == {
        "sessionId": "level-01",
        "revision": created["revision"],
        "valid": True,
        "levelId": "level-01",
        "dogCount": 1,
    }
    assert tuple(editor_settings.workspace.public.rglob("*")) == before


def test_forged_or_replayed_publish_grant_fails_before_selection(
    editor_settings, jobs_env
) -> None:
    app, publishing = publishing_app(editor_settings, jobs_env)
    candidate = publishing.prepare(
        sequence_version="seq-1",
        level_ids=("starter",),
        catalog_revision="catalog-1",
        changelog="Ship safely",
        actor="human:batu",
        source_revision="catalog-1",
    )
    with TestClient(app, raise_server_exceptions=False) as client:
        forged = client.post(
            "/api/publishing/activate",
            headers=headers(app),
            json={"candidateId": candidate.candidate_id, "grantId": "forged", "remote": False},
        )
        grant = jobs_env.approvals.mint(
            actor=candidate.actor,
            action_kind="publish_sequence",
            request_binding=candidate.digest,
            source_revision=candidate.source_revision,
            acknowledgement=expected_acknowledgement(
                "publish_sequence", candidate.digest
            ),
        )
        accepted = client.post(
            "/api/publishing/activate",
            headers=headers(app),
            json={
                "candidateId": candidate.candidate_id,
                "grantId": grant.grant_id,
                "remote": False,
            },
        )
        replayed = client.post(
            "/api/publishing/activate",
            headers=headers(app),
            json={
                "candidateId": candidate.candidate_id,
                "grantId": grant.grant_id,
                "remote": False,
            },
        )
    assert forged.status_code == 403
    assert accepted.status_code == 200
    assert replayed.status_code == 403
    assert len(publishing.snapshot().sagas) == 1
