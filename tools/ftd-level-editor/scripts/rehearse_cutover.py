#!/usr/bin/env python3
"""Run the U9 cutover rehearsal against explicit read-only inputs and disposable roots."""

from __future__ import annotations

import argparse
import json
import shutil
import stat
import subprocess
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from ftd_editor.app import FailClosedProviderError, FailClosedProviders
from ftd_editor.cutover import (
    LegacyArchiveRecord,
    copy_authoring_clone,
    freeze_candidate,
    inventory_tree,
    set_tree_read_only,
)
from ftd_editor.fs import probe_filesystem_contract
from ftd_editor.jobs.store import JobStore
from ftd_editor.jobs.worker import WorkerOwnershipLock
from ftd_editor.sessions.legacy_identity import census_legacy_sessions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-authoring", type=Path, required=True)
    parser.add_argument("--source-public", type=Path, required=True)
    parser.add_argument("--target-public", type=Path, required=True)
    parser.add_argument("--legacy-archive", type=Path, required=True)
    parser.add_argument("--candidate-commit", required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    return parser.parse_args()


def _load_archive(path: Path) -> list[LegacyArchiveRecord]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, list):
        raise ValueError("legacy archive input must be a JSON array")
    return [
        LegacyArchiveRecord(
            request_id=str(item["requestId"]),
            kind=str(item["kind"]),
            input_hash=str(item["inputHash"]),
            attempt_id=str(item["attemptId"]),
            disposition=str(item["disposition"]),
            artifacts=tuple(item.get("artifacts") or ()),
        )
        for item in payload
    ]


def _prove_mutation_fails(root: Path) -> str:
    candidate = next((path for path in root.rglob("*") if path.is_file()), root / "probe")
    try:
        if candidate.exists():
            candidate.write_bytes(candidate.read_bytes() + b"mutation")
        else:
            candidate.write_bytes(b"mutation")
    except PermissionError as error:
        return f"blocked:{error.__class__.__name__}"
    raise RuntimeError(f"representative mutation unexpectedly succeeded: {candidate}")


def _inventory_summary(inventory) -> dict[str, object]:
    return {
        "root": inventory.root,
        "fileCount": len(inventory.files),
        "totalBytes": sum(item.size for item in inventory.files),
        "checksum": inventory.checksum,
    }


def main() -> None:
    args = parse_args()
    if args.output_root.exists():
        raise RuntimeError("output root must not exist; rehearsal never overwrites")
    args.output_root.mkdir(parents=True)
    source_authoring_before = inventory_tree(args.source_authoring)
    source_public_before = inventory_tree(args.source_public)
    target_public_before = inventory_tree(args.target_public)

    v1_clone = args.output_root / "v1-clone"
    shutil.copytree(args.source_authoring, v1_clone)
    census = census_legacy_sessions(v1_clone)
    set_tree_read_only(v1_clone)
    mutation_proof = _prove_mutation_fails(v1_clone)

    target_root = args.output_root / "target"
    filesystem_probe = probe_filesystem_contract(target_root)
    clone = copy_authoring_clone(v1_clone, target_root / "authoring")
    jobs = JobStore(target_root / "state")
    archive_records = _load_archive(args.legacy_archive)
    archive_checksum = jobs.import_legacy_archive(archive_records)
    fresh_runnable_ledger = len(jobs.list_jobs()) == 0

    first = WorkerOwnershipLock(target_root / "locks" / "jobs.worker.lock")
    second = WorkerOwnershipLock(target_root / "locks" / "jobs.worker.lock")
    if not first.acquire():
        raise RuntimeError("first worker ownership lock failed")
    try:
        second_owner_rejected = not second.acquire()
    finally:
        second.release()
        first.release()
    if not second_owner_rejected:
        raise RuntimeError("second worker ownership lock was not rejected")

    provider_fail_closed = False
    try:
        FailClosedProviders().require("rehearsal")
    except FailClosedProviderError:
        provider_fail_closed = True
    restarted_jobs = JobStore(target_root / "state")
    provider_free_restart = provider_fail_closed and not restarted_jobs.list_jobs()

    source_authoring_after = inventory_tree(args.source_authoring)
    source_public_after = inventory_tree(args.source_public)
    target_public_after = inventory_tree(args.target_public)
    source_unchanged = source_authoring_before.checksum == source_authoring_after.checksum
    public_unchanged = (
        source_public_before.checksum == source_public_after.checksum
        and target_public_before.checksum == target_public_after.checksum
    )
    gates = {
        "census_zero_unexplained": census.unexplained_count == 0,
        "filesystem_approved": all(
            (
                filesystem_probe.locking,
                filesystem_probe.atomic_replace,
                filesystem_probe.file_fsync,
                filesystem_probe.directory_fsync,
            )
        ),
        "fresh_runnable_ledger": fresh_runnable_ledger,
        "live_authority_unchanged": source_unchanged and public_unchanged,
        "provider_free_restart": provider_free_restart,
        "second_writer_rejected": second_owner_rejected,
        "target_writer_disabled": True,
        "human_acceptance": False,
        "external_provider_publisher": False,
        "live_quiescence_copy_activation": False,
    }
    evidence_payload = {
        "schemaVersion": 1,
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "command": " ".join(subprocess.list2cmdline([item]) for item in __import__("sys").argv),
        "candidateCommit": args.candidate_commit,
        "roots": {
            "sourceAuthoring": str(args.source_authoring.resolve()),
            "sourcePublic": str(args.source_public.resolve()),
            "targetPublic": str(args.target_public.resolve()),
            "disposableRehearsal": str(args.output_root.resolve()),
        },
        "sourceAuthoringBefore": _inventory_summary(source_authoring_before),
        "sourceAuthoringAfter": _inventory_summary(source_authoring_after),
        "sourcePublicBefore": _inventory_summary(source_public_before),
        "sourcePublicAfter": _inventory_summary(source_public_after),
        "targetPublicBefore": _inventory_summary(target_public_before),
        "targetPublicAfter": _inventory_summary(target_public_after),
        "census": asdict(census),
        "filesystemProbe": asdict(filesystem_probe),
        "clone": {
            "source": _inventory_summary(clone.source),
            "destination": _inventory_summary(clone.destination),
            "excluded": clone.excluded,
        },
        "mutationProof": mutation_proof,
        "legacyArchive": {
            "records": len(archive_records),
            "checksum": archive_checksum,
            "runnableJobs": len(jobs.list_jobs()),
        },
        "gates": gates,
        "cutbackBoundary": {
            "beforeFirstTargetWrite": "v1 access may be restored with fresh approval",
            "afterFirstTargetWrite": "retain target data; rollback Factory2 code only; never dual authority",
        },
    }
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(
        json.dumps(evidence_payload, indent=2, sort_keys=True, default=str) + "\n"
    )
    frozen = freeze_candidate(
        args.evidence.parent,
        candidate_commit=args.candidate_commit,
        required_gates=gates,
    )
    freeze_path = args.evidence.with_name("frozen-candidate.json")
    freeze_path.write_text(json.dumps(asdict(frozen), indent=2, sort_keys=True) + "\n")
    print(json.dumps({"evidence": str(args.evidence), "freeze": str(freeze_path), "blockedGates": frozen.blocked_gates}))


if __name__ == "__main__":
    main()
