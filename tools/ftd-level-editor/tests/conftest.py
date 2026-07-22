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


def seed_publishing_catalog(public_root: Path) -> None:
    levels = public_root / "levels"
    levels.mkdir(parents=True, exist_ok=True)
    (levels / "catalog-manifest.json").write_text(
        """{
  "catalogRevision": "catalog-1",
  "levels": [
    {
      "id": "starter", "packageId": "starter:a", "listable": true,
      "bundledInApp": true, "cohortBuckets": ["all"], "tombstonedAt": null,
      "retention": {"activeSequenceVersions": [], "rollbackEligibleSequenceVersions": []}
    },
    {
      "id": "later", "packageId": "later:b", "listable": true,
      "bundledInApp": false, "cohortBuckets": ["all"], "tombstonedAt": null,
      "retention": {"activeSequenceVersions": [], "rollbackEligibleSequenceVersions": []}
    }
  ]
}"""
    )


class ManualClock:
    """Deterministic injected clock for store/worker/approval timing tests."""

    def __init__(self) -> None:
        self._current = datetime(2026, 7, 21, 12, 0, 0, tzinfo=timezone.utc)

    def now(self) -> str:
        self._current += timedelta(microseconds=1)
        return self._current.isoformat()

    def advance(self, seconds: float) -> None:
        self._current += timedelta(seconds=seconds)


def make_png(width: int = 64, height: int = 64) -> bytes:
    """A minimal payload that satisfies the boundary's PNG header decode."""

    import struct

    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x02\x00\x00\x00" * 2
    )


def make_mp4() -> bytes:
    return b"\x00\x00\x00\x18ftypisom" + b"\x00" * 32


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
        providers=None,
    ) -> DurableJobWorker:
        worker = DurableJobWorker(
            store=self.jobs,
            handlers=handlers,
            resume_handlers=resume_handlers or {},
            providers=providers,
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


# -- scripted paid-provider fixtures (U6) ------------------------------------


class ScriptedTransport:
    """Redirect-free scripted output transport; records every requested URL."""

    def __init__(self) -> None:
        self.responses: dict[str, object] = {}
        self.seen: list[str] = []
        self.on_get = None

    def get(self, url: str):
        self.seen.append(url)
        if self.on_get is not None:
            self.on_get(url)
        try:
            factory = self.responses[url]
        except KeyError as error:
            raise AssertionError(f"unscripted transport URL {url!r}") from error
        return factory() if callable(factory) else factory


class ScriptedImageProvider:
    """Synchronous image surface: each submit consumes one scripted behavior."""

    def __init__(self) -> None:
        self.script: list[object] = []
        self.submissions: list[dict] = []

    def submit(self, kind, inputs, provider_options):
        self.submissions.append({"kind": kind, "inputs": dict(inputs)})
        if not self.script:
            raise AssertionError("unscripted image-provider submit")
        behavior = self.script.pop(0)
        if isinstance(behavior, Exception):
            raise behavior
        return behavior

    def poll(self, provider_job_id):
        raise AssertionError("the synchronous image surface never polls")


class ScriptedLayerProvider:
    """Submit-and-poll Layer surface with a scripted poll sequence."""

    def __init__(self) -> None:
        self.submit_script: list[object] = []
        self.poll_script: list[object] = []
        self.polls: list[str] = []

    def submit(self, kind, inputs, provider_options):
        if not self.submit_script:
            raise AssertionError("unscripted layer-provider submit")
        behavior = self.submit_script.pop(0)
        if isinstance(behavior, Exception):
            raise behavior
        return behavior

    def poll(self, provider_job_id):
        self.polls.append(provider_job_id)
        if not self.poll_script:
            raise AssertionError("unscripted layer-provider poll")
        behavior = self.poll_script.pop(0)
        if isinstance(behavior, Exception):
            raise behavior
        if callable(behavior):
            return behavior()
        return behavior


@dataclass
class PaidEnv:
    env: JobsEnv
    service: JobService
    image: ScriptedImageProvider
    layer: ScriptedLayerProvider
    transport: ScriptedTransport
    providers: FailClosedProviders

    def make_worker(self, **kwargs) -> DurableJobWorker:
        from ftd_editor.generation import build_ftd_paid_handlers

        handlers, resume_handlers = build_ftd_paid_handlers(
            self.env.sessions, self.env.clock.now
        )
        return self.env.make_worker(
            handlers,
            resume_handlers=resume_handlers,
            providers=self.providers,
            **kwargs,
        )


@pytest.fixture
def paid_env(jobs_env: JobsEnv) -> PaidEnv:
    from ftd_editor.jobs.actions import FTD_ACTION_KINDS

    image = ScriptedImageProvider()
    layer = ScriptedLayerProvider()
    transport = ScriptedTransport()
    providers = FailClosedProviders(
        scripted={
            "ftd.image": image,
            "ftd.layer": layer,
            "ftd.output_transport": transport,
        }
    )
    service = JobService(
        jobs=jobs_env.jobs,
        approvals=jobs_env.approvals,
        artifacts=jobs_env.artifacts,
        sessions=jobs_env.sessions,
        action_kinds=FTD_ACTION_KINDS,
    )
    return PaidEnv(
        env=jobs_env,
        service=service,
        image=image,
        layer=layer,
        transport=transport,
        providers=providers,
    )


@pytest.fixture
def paid_session(jobs_env: JobsEnv):
    return jobs_env.sessions.create(
        {
            "id": "level-01",
            "dogs": [
                {"index": 0, "id": "dog-1", "activeVariant": None},
                {"index": 1, "id": "dog-2", "activeVariant": None},
            ],
        }
    )


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
