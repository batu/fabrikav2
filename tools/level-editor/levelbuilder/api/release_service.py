"""O3/O4/O11 — the ONE release transaction.

Order (each step gated on the previous):
  1. refuse if a break-glass entry is open (O11 journal);
  2. allocate the next monotonic releaseRevision (never reused, never rolled
     back — rollback publishes a NEWER revision with older content);
  3. build ManifestV2: version 2, releaseRevision, levels in order,
     artifactDigest over the canonical serialization (digest field excluded
     from its own hash);
  4. upload assets first, the manifest LAST — the manifest upload is the one
     visibility commit;
  5. read the manifest back and verify revision + digest — a mismatched
     origin aborts BEFORE any local mutation;
  6. install the SAME bytes as the local manifest (app bundle source);
  7. append the release to the server-side journal.

The remote is injectable (tests use a fake; the live lane wires R2). UI and
CLI are thin adapters over this service — there is no second publisher.
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from pathlib import Path
from typing import Any, Protocol


class ReleaseError(Exception):
    pass


class ReleaseReadbackError(ReleaseError):
    """The origin's manifest does not match what this release uploaded."""


class BreakGlassOpenError(ReleaseError):
    """An unreconciled break-glass entry blocks every release."""


class Remote(Protocol):
    def upload(self, key: str, data: bytes) -> None: ...
    def read(self, key: str) -> bytes | None: ...


def _canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def manifest_digest(manifest: dict[str, Any]) -> str:
    """Digest over the manifest WITHOUT its own artifactDigest field."""
    body = {k: v for k, v in manifest.items() if k != "artifactDigest"}
    return "sha256:" + hashlib.sha256(_canonical_json(body).encode("utf-8")).hexdigest()


class ReleaseService:
    def __init__(self, *, state_dir: Path, local_manifest_path: Path, remote: Remote):
        self.state_dir = Path(state_dir)
        self.local_manifest_path = Path(local_manifest_path)
        self.remote = remote
        self.journal_path = self.state_dir / "release-journal.jsonl"
        self.revision_path = self.state_dir / "release-revision.json"

    # -- journal -----------------------------------------------------------
    def _journal(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        row = {
            "id": f"rel_{uuid.uuid4().hex[:12]}",
            "kind": kind,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            **payload,
        }
        with open(self.journal_path, "a") as handle:
            handle.write(json.dumps(row) + "\n")
        return row

    def _journal_rows(self) -> list[dict[str, Any]]:
        if not self.journal_path.is_file():
            return []
        return [json.loads(line) for line in self.journal_path.read_text().splitlines()]

    # -- break-glass (O11) -------------------------------------------------
    def open_break_glass(self, *, invariant: str, reason: str, actor: str) -> dict[str, Any]:
        return self._journal("break-glass-open", {
            "invariant": invariant, "reason": reason, "actor": actor, "status": "open",
        })

    def reconcile_break_glass(self, entry_id: str, *, actor: str) -> dict[str, Any]:
        open_ids = {row["id"] for row in self._open_break_glass()}
        if entry_id not in open_ids:
            raise ReleaseError(f"no open break-glass entry {entry_id}")
        return self._journal("break-glass-reconciled", {"entry": entry_id, "actor": actor})

    def _open_break_glass(self) -> list[dict[str, Any]]:
        reconciled = {row.get("entry") for row in self._journal_rows()
                      if row["kind"] == "break-glass-reconciled"}
        return [row for row in self._journal_rows()
                if row["kind"] == "break-glass-open" and row["id"] not in reconciled]

    # -- revision allocation ----------------------------------------------
    def _next_revision(self) -> int:
        current = 0
        if self.revision_path.is_file():
            current = int(json.loads(self.revision_path.read_text())["releaseRevision"])
        return current + 1

    def _commit_revision(self, revision: int) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        temporary = self.revision_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps({"releaseRevision": revision}))
        temporary.replace(self.revision_path)

    # -- the transaction ---------------------------------------------------
    def release(self, request: dict[str, Any]) -> dict[str, Any]:
        blocked = self._open_break_glass()
        if blocked:
            raise BreakGlassOpenError(
                f"open break-glass entries block release: {[row['id'] for row in blocked]}"
            )
        revision = self._next_revision()
        manifest = {
            # V1-compatible bridge: today's shipped runtime accepts only
            # version==1 + manifestRevision (assets.ts validManifest); the V2
            # fields ride ADDITIVELY and O1's monotonicity guard keys off
            # manifestRevision. The version flips to 2 at the O7 runtime
            # cutover — until then one artifact serves both readers.
            "version": 1,
            "manifestRevision": revision,
            "releaseRevision": revision,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "levels": list(request["entries"]),
        }
        manifest["artifactDigest"] = manifest_digest(manifest)
        encoded = (_canonical_json(manifest)).encode("utf-8")

        for key, data in request.get("assets", {}).items():
            self.remote.upload(key, data)
        self.remote.upload("manifest.json", encoded)

        readback_raw = self.remote.read("manifest.json")
        try:
            readback = json.loads(readback_raw or b"")
        except json.JSONDecodeError as error:
            raise ReleaseReadbackError(f"origin manifest unreadable after upload: {error}") from error
        if (readback.get("releaseRevision") != revision
                or readback.get("artifactDigest") != manifest["artifactDigest"]):
            raise ReleaseReadbackError(
                f"origin serves revision {readback.get('releaseRevision')} / "
                f"{str(readback.get('artifactDigest'))[:19]}…, expected {revision} / "
                f"{manifest['artifactDigest'][:19]}… — local state untouched"
            )

        # Visibility commit verified — only now touch local state.
        self.local_manifest_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.local_manifest_path.with_suffix(".json.tmp")
        temporary.write_bytes(encoded)
        temporary.replace(self.local_manifest_path)
        self._commit_revision(revision)
        self._journal("release", {
            "releaseRevision": revision,
            "artifactDigest": manifest["artifactDigest"],
            "levelIds": request.get("levelIds"),
            "actor": request.get("actor"),
        })
        return {"releaseRevision": revision, "artifactDigest": manifest["artifactDigest"]}
