"""Provider-free cutover rehearsal primitives for Find the Dog."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import shutil
import stat
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, Mapping

import httpx

from .fs import ensure_durable_directory, fsync_tree, require_same_filesystem


class CutoverError(RuntimeError):
    """A rehearsal precondition failed closed."""


LegacyDisposition = Literal[
    "succeeded", "failed_terminal", "failed_retryable", "cancelled", "resolved"
]
_TERMINAL_DISPOSITIONS = frozenset(
    {"succeeded", "failed_terminal", "failed_retryable", "cancelled", "resolved"}
)


@dataclass(frozen=True, slots=True)
class LegacyArchiveRecord:
    """Historical identity only; deliberately lacks execution or ownership state."""

    request_id: str
    kind: str
    input_hash: str
    attempt_id: str
    disposition: str
    artifacts: tuple[dict[str, str], ...]

    def validate(self) -> None:
        if not all((self.request_id, self.kind, self.input_hash, self.attempt_id)):
            raise ValueError("legacy identity fields must be non-empty")
        if self.disposition not in _TERMINAL_DISPOSITIONS:
            raise ValueError("legacy disposition must be terminal or explicitly resolved")
        if not self.input_hash.startswith("sha256:"):
            raise ValueError("legacy Input Hash must be a sha256 digest")
        for artifact in self.artifacts:
            if set(artifact) != {"checksum", "locator"}:
                raise ValueError("legacy artifact requires only checksum and locator")
            if not artifact["checksum"].startswith("sha256:") or not artifact["locator"]:
                raise ValueError("legacy artifact checksum and locator are required")


@dataclass(frozen=True, slots=True)
class InventoryFile:
    relative_path: str
    size: int
    checksum: str


@dataclass(frozen=True, slots=True)
class TreeInventory:
    root: str
    files: tuple[InventoryFile, ...]
    checksum: str


@dataclass(frozen=True, slots=True)
class CloneReport:
    source: TreeInventory
    destination: TreeInventory
    excluded: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class FrozenCandidate:
    candidate_commit: str
    evidence_checksum: str
    gates: tuple[tuple[str, bool], ...]
    blocked_gates: tuple[str, ...]
    activation_allowed: bool


def _free_loopback_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _start_rehearsal_server(
    root: Path, fixture: Path, port: int, *, run_worker: bool
) -> subprocess.Popen[str]:
    script = Path(__file__).resolve().parents[2] / "scripts/live_reliability_server.py"
    command = [
        sys.executable,
        str(script),
        "--root",
        str(root),
        "--port",
        str(port),
        "--session-fixture",
        str(fixture),
    ]
    if run_worker:
        command.append("--run-worker-on-start")
    return subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )


def _await_bootstrap(base_url: str, process: subprocess.Popen[str]) -> str:
    for _ in range(100):
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr is not None else ""
            raise RuntimeError(f"rehearsal server exited before ready: {stderr}")
        try:
            response = httpx.get(f"{base_url}/bootstrap", timeout=0.2)
            if response.status_code == 200:
                return str(response.json()["launchCredential"])
        except httpx.TransportError:
            pass
        time.sleep(0.05)
    raise RuntimeError("rehearsal server did not become ready")


def _stop_rehearsal_server(process: subprocess.Popen[str]) -> None:
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run_live_reliability_journey(root: Path, session_fixture: Path) -> dict[str, object]:
    """Observe lost-response/reload/API+worker restart against real processes."""

    root.mkdir(parents=True, exist_ok=False)
    fixture_payload = json.loads(session_fixture.read_text())
    for index, dog in enumerate(fixture_payload.get("dogs", ())):
        dog.setdefault("index", index)
    disposable_fixture = root / "session-fixture.json"
    disposable_fixture.write_text(json.dumps(fixture_payload, sort_keys=True) + "\n")
    session_id = str(fixture_payload["id"])
    port = _free_loopback_port()
    base_url = f"http://127.0.0.1:{port}"
    request_id = "u9-rehearsal-lost-response"
    first = _start_rehearsal_server(root, disposable_fixture, port, run_worker=False)
    try:
        credential = _await_bootstrap(base_url, first)
        headers = {
            "X-FTD-Launch-Credential": credential,
            "Origin": base_url,
        }
        snapshot = httpx.get(
            f"{base_url}/api/sessions/{session_id}", headers=headers
        ).json()
        with httpx.Client() as client:
            start_request = client.build_request(
                "POST",
                f"{base_url}/api/jobs/actions/ftd.background_generate",
                headers=headers,
                json={
                    "requestId": request_id,
                    "sessionId": session_id,
                    "revision": snapshot["revision"],
                    "inputs": {"sceneIntent": {"description": "provider-free rehearsal"}},
                },
            )
            lost_response = client.send(start_request, stream=True)
            lost_response.close()  # Discard the durable Job response body.
        persisted = False
        for _ in range(50):
            jobs = httpx.get(
                f"{base_url}/api/jobs",
                params={"requestId": request_id},
                headers=headers,
                timeout=0.5,
            ).json()
            if jobs:
                persisted = True
                break
            time.sleep(0.02)
        if not persisted:
            raise RuntimeError("lost-response Request ID did not become durable")
    finally:
        _stop_rehearsal_server(first)

    disconnected = False
    try:
        httpx.get(f"{base_url}/api/jobs", timeout=0.2)
    except httpx.TransportError:
        disconnected = True

    second = _start_rehearsal_server(root, disposable_fixture, port, run_worker=True)
    try:
        credential = _await_bootstrap(base_url, second)
        headers = {
            "X-FTD-Launch-Credential": credential,
            "Origin": base_url,
        }
        jobs = httpx.get(
            f"{base_url}/api/jobs",
            params={"requestId": request_id},
            headers=headers,
        ).json()
        if len(jobs) != 1:
            raise RuntimeError("reload by Request ID did not find exactly one job")
        job = jobs[0]
        events = httpx.get(
            f"{base_url}/api/jobs/{job['jobId']}/events", headers=headers
        ).json()
        export = httpx.post(
            f"{base_url}/api/publishing/export-dry-run",
            headers=headers,
            json={"sessionId": session_id, "revision": snapshot["revision"]},
        )
        export.raise_for_status()
        return {
            "processes": [first.pid, second.pid],
            "port": port,
            "requestId": request_id,
            "jobId": job["jobId"],
            "lostResponseRequestPersisted": persisted,
            "disconnectObserved": disconnected,
            "apiRestarted": first.pid != second.pid,
            "workerRestarted": job["status"] == "succeeded",
            "reloadByRequestId": True,
            "terminalStatus": job["status"],
            "eventCount": len(events),
            "artifactCount": len(job["artifacts"]),
            "exportDryRunValid": export.json()["valid"],
            "providerMode": "fail-closed",
        }
    finally:
        _stop_rehearsal_server(second)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def inventory_tree(root: Path, *, exclude_names: tuple[str, ...] = ()) -> TreeInventory:
    """Hash every regular file in a symlink-free tree without modifying it."""

    resolved = root.resolve(strict=True)
    files: list[InventoryFile] = []
    for path in sorted(resolved.rglob("*")):
        relative = path.relative_to(resolved).as_posix()
        if path.is_symlink():
            raise CutoverError(f"inventory refuses symlink: {relative}")
        if path.is_file() and path.name not in exclude_names:
            files.append(InventoryFile(relative, path.stat().st_size, _sha256_file(path)))
    payload = [asdict(item) for item in files]
    checksum = "sha256:" + hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return TreeInventory(str(resolved), tuple(files), checksum)


def set_tree_read_only(root: Path) -> None:
    """Remove write bits from a disposable clone before drain/copy rehearsal."""

    resolved = root.resolve(strict=True)
    for path in (resolved, *resolved.rglob("*")):
        if path.is_symlink():
            raise CutoverError(f"read-only rehearsal refuses symlink: {path}")
        mode = stat.S_IMODE(path.stat().st_mode)
        os.chmod(path, mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))


def _assert_read_only(root: Path) -> None:
    writable = [
        path
        for path in (root, *root.rglob("*"))
        if not path.is_symlink()
        and stat.S_IMODE(path.stat().st_mode)
        & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
    ]
    if writable:
        raise CutoverError(f"source must be read-only before copy: {writable[0]}")


def copy_authoring_clone(source: Path, destination: Path) -> CloneReport:
    """Copy a quiesced clone once, excluding every possible v1 runnable ledger file."""

    excluded = ("jobs.sqlite", "jobs.sqlite-shm", "jobs.sqlite-wal")
    source = source.resolve(strict=True)
    _assert_read_only(source)
    if destination.exists() and any(destination.iterdir()):
        raise CutoverError("destination must be absent or empty")
    destination = ensure_durable_directory(destination)
    require_same_filesystem(source, destination)
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        if path.name in excluded:
            continue
        target = destination / relative
        if path.is_symlink():
            raise CutoverError(f"copy refuses symlink: {relative}")
        if path.is_dir():
            target.mkdir(exist_ok=True)
        elif path.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    fsync_tree(destination)
    source_inventory = inventory_tree(source, exclude_names=excluded)
    destination_inventory = inventory_tree(destination)
    source_members = tuple((item.relative_path, item.size, item.checksum) for item in source_inventory.files)
    destination_members = tuple(
        (item.relative_path, item.size, item.checksum) for item in destination_inventory.files
    )
    if source_members != destination_members:
        raise CutoverError("cloned authoring inventory differs from source")
    return CloneReport(source_inventory, destination_inventory, tuple(name for name in excluded if (source / name).exists()))


def freeze_candidate(
    evidence_root: Path,
    *,
    candidate_commit: str,
    required_gates: Mapping[str, bool],
) -> FrozenCandidate:
    """Bind evidence to one commit while keeping human/external gates visibly blocked."""

    if len(candidate_commit) != 40 or any(char not in "0123456789abcdef" for char in candidate_commit):
        raise ValueError("candidate commit must be one exact lowercase Git SHA")
    # The freeze manifest is derived from the evidence and must never hash an
    # older copy of itself when a rehearsal is repeated.
    inventory = inventory_tree(evidence_root, exclude_names=("frozen-candidate.json",))
    gates = tuple(sorted((name, bool(value)) for name, value in required_gates.items()))
    blocked = tuple(name for name, passed in gates if not passed)
    return FrozenCandidate(
        candidate_commit=candidate_commit,
        evidence_checksum=inventory.checksum,
        gates=gates,
        blocked_gates=blocked,
        activation_allowed=not blocked,
    )
