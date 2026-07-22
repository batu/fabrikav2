"""Opaque, root-confined artifact registration and download resolution."""

from __future__ import annotations

import hashlib
import os
import re
import stat
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path

from .fs import atomic_write_bytes, ensure_durable_directory
from .jobs.models import ArtifactRecord
from .jobs.store import JobStore

ALLOWED_MEDIA_TYPES: frozenset[str] = frozenset(
    {
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "application/json",
        "text/plain",
        "application/zip",
    }
)

_ARTIFACT_ID = re.compile(r"^artifact-[0-9a-f]{32}$")
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class ArtifactRejected(RuntimeError):
    pass


class ArtifactNotFound(FileNotFoundError):
    pass


def sanitize_display_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKC", name)
    collapsed = _SAFE_NAME.sub("-", normalized)
    collapsed = re.sub(r"\.{2,}", ".", collapsed).strip("-.")
    if not collapsed:
        return "artifact"
    return collapsed[:128]


@dataclass(frozen=True, slots=True)
class ResolvedArtifact:
    record: ArtifactRecord
    path: Path
    content: bytes


class ArtifactStore:
    """Owns artifact bytes beneath one root; clients only ever see opaque IDs."""

    def __init__(self, root: Path, jobs: JobStore) -> None:
        self.root = root.expanduser().resolve(strict=False)
        self._jobs = jobs
        ensure_durable_directory(self.root)

    def register(
        self,
        job_id: str,
        payload: bytes,
        *,
        display_name: str,
        media_type: str,
    ) -> ArtifactRecord:
        if media_type not in ALLOWED_MEDIA_TYPES:
            raise ArtifactRejected(f"media type {media_type!r} is not allowlisted")
        artifact_id = f"artifact-{uuid.uuid4().hex}"
        relative_path = f"{artifact_id}.bin"
        atomic_write_bytes(
            self.root / relative_path,
            payload,
            staging_dir=self.root / ".staging",
        )
        record = ArtifactRecord(
            artifact_id=artifact_id,
            job_id=job_id,
            display_name=sanitize_display_name(display_name),
            media_type=media_type,
            checksum=f"sha256:{hashlib.sha256(payload).hexdigest()}",
            size=len(payload),
            relative_path=relative_path,
            created_at="",
        )
        self._jobs.record_artifact(record)
        return record

    def resolve_download(self, job_id: str, artifact_id: str) -> ResolvedArtifact:
        """Resolve an opaque reference through the Job relation, root-confined."""

        if not _ARTIFACT_ID.fullmatch(artifact_id):
            raise ArtifactNotFound(artifact_id)
        record = self._jobs.get_artifact_for_job(job_id, artifact_id)
        if record is None:
            raise ArtifactNotFound(artifact_id)
        candidate = (self.root / record.relative_path).resolve(strict=False)
        if candidate.parent != self.root:
            raise ArtifactNotFound(artifact_id)
        try:
            descriptor = os.open(candidate, os.O_RDONLY | os.O_NOFOLLOW)
        except OSError as error:
            raise ArtifactNotFound(artifact_id) from error
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise ArtifactNotFound(artifact_id)
            digest = hashlib.sha256()
            chunks: list[bytes] = []
            while chunk := os.read(descriptor, 1024 * 1024):
                digest.update(chunk)
                chunks.append(chunk)
        finally:
            os.close(descriptor)
        if f"sha256:{digest.hexdigest()}" != record.checksum:
            raise ArtifactNotFound(artifact_id)
        # The served bytes are exactly the bytes that passed O_NOFOLLOW +
        # regular-file + checksum verification; the path is never reopened.
        return ResolvedArtifact(record=record, path=candidate, content=b"".join(chunks))
