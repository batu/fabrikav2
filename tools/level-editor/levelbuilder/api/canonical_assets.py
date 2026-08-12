"""A2: the one canonical asset resolver.

Snapshot validity does not prove asset validity — a descriptor's bytes may have
been overwritten by a legacy writer or deleted. Every canonical read of asset
bytes goes through resolve_asset: containment, existence, byte count, sha256.
The CAS object (.canonical/objects/<sha256><ext>) is the durable source; the
session-relative path is a projection that may lag or be clobbered.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .canonical_bird_contract import CanonicalRevisionStore


class AssetIntegrityError(Exception):
    """A canonical asset descriptor cannot be satisfied by verified bytes."""


@dataclass(frozen=True)
class ResolvedAsset:
    sha256: str
    data: bytes
    path: Path
    source: str  # "path" | "cas"


def resolve_asset(store: CanonicalRevisionStore, descriptor: dict[str, Any]) -> ResolvedAsset:
    """Return verified bytes for a snapshot asset descriptor or raise loudly."""
    relative = Path(str(descriptor.get("path", "")))
    sha256 = descriptor.get("sha256")
    declared_bytes = descriptor.get("bytes")
    if not isinstance(sha256, str) or len(sha256) != 64:
        raise AssetIntegrityError(f"descriptor sha256 is invalid: {sha256!r}")
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise AssetIntegrityError(f"descriptor path escapes the session: {descriptor.get('path')!r}")

    def _verified(path: Path, source: str) -> ResolvedAsset | None:
        if not path.is_file():
            return None
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != sha256:
            return None
        if isinstance(declared_bytes, int) and len(data) != declared_bytes:
            return None
        return ResolvedAsset(sha256=sha256, data=data, path=path, source=source)

    resolved = _verified(store.session_root / relative, "path")
    if resolved is None:
        resolved = _verified(store.root / "objects" / f"{sha256}{relative.suffix.lower()}", "cas")
    if resolved is None:
        raise AssetIntegrityError(
            f"asset bytes match neither their path nor the CAS "
            f"(declared {sha256[:12]}…/{declared_bytes}b): {descriptor.get('path')}"
        )
    return resolved


class LaneSelectionError(Exception):
    """The session's canonical state does not permit any read/write lane."""


def select_lane(state) -> str:
    """A3: the one lane selector. VALID_CURRENT requires canonical behavior;
    MIGRATION_REQUIRED (no canonical artifacts) is the only legacy state;
    everything else fails closed — a partial or quarantined store is never
    a license to guess."""
    from .canonical_bird_contract import CanonicalReadState

    if state is CanonicalReadState.VALID_CURRENT:
        return "canonical"
    if state is CanonicalReadState.MIGRATION_REQUIRED:
        return "legacy"
    raise LaneSelectionError(
        f"session canonical state {state.value!r} permits no lane; repair or migrate first"
    )
