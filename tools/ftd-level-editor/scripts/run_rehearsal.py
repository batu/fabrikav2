#!/usr/bin/env python3
"""Run the real-data FTD v2 rehearsal without changing v1 authority."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn

from ftd_editor.app import AppComponents, EditorStores, create_app
from ftd_editor.approvals import ApprovalStore
from ftd_editor.artifacts import ArtifactStore
from ftd_editor.generation import build_ftd_paid_handlers
from ftd_editor.jobs.actions import FTD_ACTION_KINDS, JobService
from ftd_editor.jobs.store import JobStore, utc_now_iso
from ftd_editor.jobs.worker import DurableJobWorker
from ftd_editor.generation.openrouter import LiveProviderRegistry
from ftd_editor.rehearsal import initialize_clone
from ftd_editor.security import CompositionSecrets, SecretRedactor
from ftd_editor.sessions.store import SessionStore
from ftd_editor.settings import EditorSettings
from ftd_editor.jobs.worker import SingleOwnerWorkerLoop


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-authoring", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--port", type=int, default=5192)
    return parser.parse_args()


def _read_secret(path: Path, name: str) -> str:
    if not path.is_file():
        raise RuntimeError(f"explicit environment file does not exist: {path}")
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == name:
            secret = value.strip().strip("\"'")
            if secret:
                return secret
    raise RuntimeError(f"{name} is absent from the explicit environment file")


def build_app(args: argparse.Namespace):
    source = args.source_authoring.expanduser().resolve()
    root = args.root.expanduser().resolve()
    initialize_clone(source, root)
    api_key = _read_secret(args.env_file.expanduser().resolve(), "OPENROUTER_API_KEY")
    settings = EditorSettings.for_production(
        root,
        bind_port=args.port,
        forbidden_roots=(source,),
    )
    settings.workspace.prepare()

    redactor = SecretRedactor(
        CompositionSecrets.from_mapping({"openrouter": api_key})
    )
    jobs = JobStore(settings.workspace.state, sanitize=redactor.sanitize_text)
    sessions = SessionStore(settings.workspace)
    approvals = ApprovalStore(jobs)
    artifacts = ArtifactStore(settings.workspace.artifacts, jobs)
    service = JobService(
        jobs=jobs,
        approvals=approvals,
        artifacts=artifacts,
        sessions=sessions,
        action_kinds=FTD_ACTION_KINDS,
    )
    providers = LiveProviderRegistry.openrouter(api_key)
    handlers, resume_handlers = build_ftd_paid_handlers(sessions, utc_now_iso)
    durable_worker = DurableJobWorker(
        store=jobs,
        handlers=handlers,
        resume_handlers=resume_handlers,
        providers=providers,
        register_artifact=artifacts.register,
        lock_path=settings.workspace.locks / "jobs.worker.lock",
        owner_id=f"ftd-rehearsal-{os.getpid()}",
    )
    worker = SingleOwnerWorkerLoop(durable_worker)
    app = create_app(
        settings,
        AppComponents(
            stores=EditorStores(sessions=sessions, jobs=service),
            worker=worker,
            providers=providers,
            redactor=redactor,
        ),
    )

    return app


def main() -> None:
    args = parse_args()
    app = build_app(args)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
