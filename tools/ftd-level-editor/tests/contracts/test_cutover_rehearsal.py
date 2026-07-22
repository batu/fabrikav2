from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest

from ftd_editor.cutover import (
    CutoverError,
    LegacyArchiveRecord,
    copy_authoring_clone,
    freeze_candidate,
    inventory_tree,
    set_tree_read_only,
)
from ftd_editor.jobs.models import ExecutionSpec
from ftd_editor.jobs.store import ArchivedRequestIdentity, JobStore


def _spec() -> ExecutionSpec:
    return ExecutionSpec(
        kind="ftd.background_generate",
        session_id="session-1",
        source_revision="revision-1",
        inputs={"prompt": "dog"},
        recipe_version="recipe-1",
        policy_version="policy-1",
    )


def test_inert_archive_blocks_request_replay_without_creating_runnable_work(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "state")
    spec = _spec()
    record = LegacyArchiveRecord(
        request_id="legacy-request-1",
        kind=spec.kind,
        input_hash=spec.input_hash(),
        attempt_id="legacy-attempt-1",
        disposition="succeeded",
        artifacts=(
            {
                "checksum": "sha256:" + "a" * 64,
                "locator": "legacy/session-1/result.png",
            },
        ),
    )

    archive_checksum = store.import_legacy_archive([record])

    assert archive_checksum.startswith("sha256:")
    assert store.list_jobs() == []
    assert store.list_active_jobs() == []
    assert store.find_legacy_archive(spec.kind, record.request_id) == record
    with pytest.raises(ArchivedRequestIdentity, match="inert legacy archive"):
        store.start_job(spec, request_id=record.request_id)
    assert store.list_jobs() == []


def test_archive_rejects_active_dispositions_and_conflicting_duplicate_identity(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "state")
    spec = _spec()
    with pytest.raises(ValueError, match="terminal or explicitly resolved"):
        store.import_legacy_archive(
            [
                LegacyArchiveRecord(
                    request_id="active",
                    kind=spec.kind,
                    input_hash=spec.input_hash(),
                    attempt_id="attempt-active",
                    disposition="running",
                    artifacts=(),
                )
            ]
        )

    original = LegacyArchiveRecord(
        request_id="duplicate",
        kind=spec.kind,
        input_hash=spec.input_hash(),
        attempt_id="attempt-1",
        disposition="failed_terminal",
        artifacts=(),
    )
    store.import_legacy_archive([original])
    changed = LegacyArchiveRecord(
        request_id=original.request_id,
        kind=original.kind,
        input_hash="sha256:" + "b" * 64,
        attempt_id=original.attempt_id,
        disposition=original.disposition,
        artifacts=(),
    )
    with pytest.raises(ValueError, match="conflicting legacy identity"):
        store.import_legacy_archive([changed])


def test_clone_excludes_legacy_ledger_and_read_only_precedes_copy(tmp_path: Path) -> None:
    source = tmp_path / "v1-clone"
    (source / "session-a").mkdir(parents=True)
    (source / "session-a" / "session.json").write_text('{"id":"session-a"}')
    (source / "jobs.sqlite").write_bytes(b"must-not-copy")
    (source / "jobs.sqlite-wal").write_bytes(b"must-not-copy")
    destination = tmp_path / "target" / "authoring"

    set_tree_read_only(source)
    assert not (source.stat().st_mode & stat.S_IWUSR)
    assert not ((source / "session-a" / "session.json").stat().st_mode & stat.S_IWUSR)

    report = copy_authoring_clone(source, destination)

    assert report.source == inventory_tree(
        source, exclude_names=("jobs.sqlite", "jobs.sqlite-shm", "jobs.sqlite-wal")
    )
    assert report.destination == inventory_tree(destination)
    assert not (destination / "jobs.sqlite").exists()
    assert not (destination / "jobs.sqlite-wal").exists()
    assert report.excluded == ("jobs.sqlite", "jobs.sqlite-wal")
    assert [entry.relative_path for entry in report.destination.files] == [
        "session-a/session.json"
    ]


def test_clone_requires_read_only_source_and_empty_destination(tmp_path: Path) -> None:
    source = tmp_path / "v1-clone"
    source.mkdir()
    (source / "session.json").write_text("{}")
    destination = tmp_path / "target"

    with pytest.raises(CutoverError, match="must be read-only before copy"):
        copy_authoring_clone(source, destination)

    set_tree_read_only(source)
    destination.mkdir()
    (destination / "existing").write_text("do not overwrite")
    with pytest.raises(CutoverError, match="destination must be absent or empty"):
        copy_authoring_clone(source, destination)


def test_freeze_candidate_is_checksumming_and_refuses_unpassed_gates(tmp_path: Path) -> None:
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    (evidence / "census.json").write_text(json.dumps({"unexplainedCount": 0}))
    (evidence / "rehearsal.json").write_text(json.dumps({"writerEnabled": False}))

    frozen = freeze_candidate(
        evidence,
        candidate_commit="a" * 40,
        required_gates={
            "census_zero_unexplained": True,
            "live_authority_unchanged": True,
            "target_writer_disabled": True,
            "human_acceptance": False,
            "external_provider_publisher": False,
        },
    )

    assert frozen.candidate_commit == "a" * 40
    assert frozen.evidence_checksum.startswith("sha256:")
    assert frozen.blocked_gates == ("external_provider_publisher", "human_acceptance")
    assert frozen.activation_allowed is False
    assert inventory_tree(evidence).files


@pytest.fixture(autouse=True)
def restore_writable_tmp_path(tmp_path: Path):
    yield
    for path in sorted(tmp_path.rglob("*"), reverse=True):
        if not path.is_symlink():
            os.chmod(path, path.stat().st_mode | stat.S_IWUSR)
