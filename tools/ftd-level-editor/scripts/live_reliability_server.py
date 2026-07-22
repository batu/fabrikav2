#!/usr/bin/env python3
"""Disposable real-process server used only by the U9 cutover rehearsal."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import uvicorn

from ftd_editor.app import AppComponents, EditorStores, FailClosedProviders, create_app
from ftd_editor.approvals import ApprovalStore
from ftd_editor.artifacts import ArtifactStore
from ftd_editor.jobs.actions import FTD_ACTION_KINDS, JobService
from ftd_editor.jobs.store import JobStore
from ftd_editor.jobs.worker import DurableJobWorker
from ftd_editor.publishing.sequence import PublishingService
from ftd_editor.security import CompositionSecrets, SecretRedactor
from ftd_editor.sessions.store import SessionStore
from ftd_editor.settings import EditorSettings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--session-fixture", type=Path, required=True)
    parser.add_argument("--run-worker-on-start", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = EditorSettings.for_development(args.root, bind_port=args.port)
    settings.workspace.prepare()
    jobs = JobStore(settings.workspace.state)
    sessions = SessionStore(settings.workspace)
    if not list(settings.workspace.authoring.glob("*/session.json")):
        sessions.create(json.loads(args.session_fixture.read_text()))
    approvals = ApprovalStore(jobs)
    artifacts = ArtifactStore(settings.workspace.artifacts, jobs)
    service = JobService(
        jobs=jobs,
        approvals=approvals,
        artifacts=artifacts,
        sessions=sessions,
        action_kinds=FTD_ACTION_KINDS,
    )

    def provider_free_handler(context):
        artifact = context.register_artifact(
            context.job.id,
            b'{"journey":"provider-free"}\n',
            display_name="provider-free-result.json",
            media_type="application/json",
        )
        return {"journey": "provider-free", "artifactId": artifact.artifact_id}

    worker = DurableJobWorker(
        store=jobs,
        handlers={"ftd.background_generate": provider_free_handler},
        register_artifact=artifacts.register,
        lock_path=settings.workspace.locks / "jobs.worker.lock",
        providers=FailClosedProviders(),
        owner_id="u9-rehearsal-worker",
    )
    if args.run_worker_on_start:
        if not worker.acquire_ownership():
            raise RuntimeError("restarted worker could not acquire ownership")
        try:
            worker.run_once()
        finally:
            worker.release_ownership()

    publishing = PublishingService(
        public_root=settings.workspace.public,
        state_root=settings.workspace.state / "publishing",
        approvals=approvals,
    )
    app = create_app(
        settings,
        AppComponents(
            stores=EditorStores(sessions=sessions, jobs=service, publishing=publishing),
            worker=worker,
            providers=FailClosedProviders(),
            redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
            human_approval_credential="u9-disposable-human-gate-disabled",
        ),
    )
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
