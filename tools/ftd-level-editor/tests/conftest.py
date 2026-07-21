from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ftd_editor.app import (
    AppComponents,
    EditorStores,
    FailClosedProviders,
    ManualWorker,
    create_app,
)
from ftd_editor.approvals import ApprovalStore
from ftd_editor.artifacts import ArtifactStore
from ftd_editor.jobs.actions import FtdActionKind, JobService
from ftd_editor.jobs.store import JobStore
from ftd_editor.jobs.worker import DurableJobWorker
from ftd_editor.security import CompositionSecrets, SecretRedactor
from ftd_editor.sessions.store import SessionStore
from ftd_editor.settings import EditorSettings


CANARY_SECRET = "ftd-canary-secret-8d122253"


class ManualClock:
    """Deterministic injected clock for store/worker/approval timing tests."""

    def __init__(self) -> None:
        self._current = datetime(2026, 7, 21, 12, 0, 0, tzinfo=timezone.utc)

    def now(self) -> str:
        self._current += timedelta(microseconds=1)
        return self._current.isoformat()

    def advance(self, seconds: float) -> None:
        self._current += timedelta(seconds=seconds)


TEST_ACTION_KINDS = (
    FtdActionKind("ftd.dog_variant_upscale", "upscale-r1", "spend-p1"),
    FtdActionKind("ftd.background_generate", "background-r1", "spend-p1"),
)


@dataclass
class JobsEnv:
    settings: EditorSettings
    clock: ManualClock
    redactor: SecretRedactor
    sessions: SessionStore
    jobs: JobStore
    approvals: ApprovalStore
    artifacts: ArtifactStore
    service: JobService
    workers: list[DurableJobWorker] = field(default_factory=list)

    def make_worker(
        self,
        handlers,
        *,
        resume_handlers=None,
        owner_id: str | None = None,
        stale_after_seconds: float = 60.0,
    ) -> DurableJobWorker:
        worker = DurableJobWorker(
            store=self.jobs,
            handlers=handlers,
            resume_handlers=resume_handlers or {},
            register_artifact=self.artifacts.register,
            lock_path=self.settings.workspace.locks / "jobs.worker.lock",
            owner_id=owner_id or f"worker-{len(self.workers)}",
            now=self.clock.now,
            stale_after_seconds=stale_after_seconds,
        )
        self.workers.append(worker)
        return worker


@pytest.fixture
def jobs_env(editor_settings: EditorSettings) -> JobsEnv:
    clock = ManualClock()
    redactor = SecretRedactor(CompositionSecrets.from_mapping({"provider": CANARY_SECRET}))
    sessions = SessionStore(editor_settings.workspace)
    jobs = JobStore(
        editor_settings.workspace.state,
        sanitize=redactor.sanitize_text,
        now=clock.now,
    )
    approvals = ApprovalStore(jobs, now=clock.now)
    artifacts = ArtifactStore(editor_settings.workspace.artifacts, jobs)
    service = JobService(
        jobs=jobs,
        approvals=approvals,
        artifacts=artifacts,
        sessions=sessions,
        action_kinds=TEST_ACTION_KINDS,
    )
    return JobsEnv(
        settings=editor_settings,
        clock=clock,
        redactor=redactor,
        sessions=sessions,
        jobs=jobs,
        approvals=approvals,
        artifacts=artifacts,
        service=service,
    )


@pytest.fixture
def ftd_session(jobs_env: JobsEnv):
    return jobs_env.sessions.create({"id": "level-01", "dogs": []})


@pytest.fixture
def jobs_app(editor_settings: EditorSettings, jobs_env: JobsEnv):
    components = AppComponents(
        stores=EditorStores(sessions=jobs_env.sessions, jobs=jobs_env.service),
        worker=ManualWorker(),
        providers=FailClosedProviders(),
        redactor=jobs_env.redactor,
    )
    return create_app(editor_settings, components)


@pytest.fixture
def jobs_client(jobs_app) -> TestClient:
    with TestClient(jobs_app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def jobs_headers(jobs_app) -> dict[str, str]:
    return {
        "X-FTD-Launch-Credential": jobs_app.state.launch_credential,
        "Origin": "http://testserver",
    }


@pytest.fixture
def legacy_fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "legacy-v1"
    (root / "state").mkdir(parents=True)
    return root


@pytest.fixture
def editor_settings(tmp_path: Path, legacy_fixture_root: Path) -> EditorSettings:
    return EditorSettings.for_test(
        tmp_path / "target",
        allowed_hosts=("testserver",),
        allowed_origins=("http://testserver",),
        forbidden_roots=(legacy_fixture_root,),
    )


@pytest.fixture
def app_components() -> AppComponents:
    secrets = CompositionSecrets.from_mapping({"provider": CANARY_SECRET})
    return AppComponents(
        stores=EditorStores(),
        worker=ManualWorker(),
        providers=FailClosedProviders(),
        redactor=SecretRedactor(secrets),
    )


@pytest.fixture
def app(editor_settings: EditorSettings, app_components: AppComponents):
    return create_app(editor_settings, app_components)


@pytest.fixture
def client(app) -> TestClient:
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def launch_credential(app) -> str:
    return app.state.launch_credential


@pytest.fixture
def authorized_headers(launch_credential: str) -> dict[str, str]:
    return {"X-FTD-Launch-Credential": launch_credential}
