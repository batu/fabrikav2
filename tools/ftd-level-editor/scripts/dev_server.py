#!/usr/bin/env python3
"""Run the Fabrikav2 editor against an explicit disposable workspace."""

from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn

from ftd_editor.app import (
    AppComponents,
    EditorStores,
    FailClosedProviders,
    ManualWorker,
    create_app,
)
from ftd_editor.fs import atomic_write_json, ensure_durable_directory
from ftd_editor.approvals import ApprovalStore
from ftd_editor.artifacts import ArtifactStore
from ftd_editor.jobs.actions import FTD_ACTION_KINDS, JobService
from ftd_editor.jobs.store import JobStore
from ftd_editor.presets.store import PresetStore, seed_default_presets
from ftd_editor.publishing.sequence import PublishingService
from ftd_editor.security import CompositionSecrets, SecretRedactor
from ftd_editor.sessions.store import SessionStore
from ftd_editor.settings import EditorSettings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--port", type=int, default=5192)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = EditorSettings.for_development(args.root, bind_port=args.port)
    settings.workspace.prepare()
    levels_root = ensure_durable_directory(settings.workspace.public / "levels")
    catalog_path = levels_root / "catalog-manifest.json"
    if not catalog_path.exists():
        atomic_write_json(
            catalog_path,
            {"catalogRevision": "find-the-bird-empty-v1", "levels": []},
        )

    sessions = SessionStore(settings.workspace)
    jobs = JobStore(settings.workspace.state)
    approvals = ApprovalStore(jobs)
    artifacts = ArtifactStore(settings.workspace.artifacts, jobs)
    service = JobService(
        jobs=jobs,
        approvals=approvals,
        artifacts=artifacts,
        sessions=sessions,
        action_kinds=FTD_ACTION_KINDS,
    )
    presets = PresetStore(settings.workspace.state / "presets")
    seed_default_presets(presets)
    publishing = PublishingService(
        public_root=settings.workspace.public,
        state_root=settings.workspace.state / "publishing",
        approvals=approvals,
    )

    app = create_app(
        settings,
        AppComponents(
            stores=EditorStores(
                sessions=sessions,
                jobs=service,
                publishing=publishing,
                presets=presets,
            ),
            worker=ManualWorker(),
            providers=FailClosedProviders(),
            redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
            human_approval_credential="development-publishing-disabled",
        ),
    )
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
