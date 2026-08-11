"""Read-only inventory and integrity census for Find the Bird levels."""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from .canonical_bird_contract import CanonicalReadState, CanonicalRevisionStore


InventoryKind = Literal["source_only", "public_only", "source_and_public", "metadata_only"]
AuditStatus = Literal["safe", "migratable", "frozen_legacy", "quarantined"]


@dataclass(frozen=True)
class LevelIntegrityAudit:
    level_id: str
    inventory: InventoryKind
    status: AuditStatus
    issue_codes: tuple[str, ...]
    source_present: bool
    public_present: bool
    lineup: bool
    archived: bool
    canonical_state: str | None

    def to_dict(self) -> dict:
        value = asdict(self)
        value["issueCodes"] = list(value.pop("issue_codes"))
        value["levelId"] = value.pop("level_id")
        value["sourcePresent"] = value.pop("source_present")
        value["publicPresent"] = value.pop("public_present")
        value["canonicalState"] = value.pop("canonical_state")
        return value


@dataclass(frozen=True)
class CorpusIntegrityAudit:
    levels: tuple[LevelIntegrityAudit, ...]

    def to_dict(self) -> dict:
        status_counts = Counter(level.status for level in self.levels)
        inventory_counts = Counter(level.inventory for level in self.levels)
        return {
            "levels": [level.to_dict() for level in self.levels],
            "counts": {
                "total": len(self.levels),
                "byStatus": dict(sorted(status_counts.items())),
                "byInventory": dict(sorted(inventory_counts.items())),
            },
        }


def _level_dirs(root: Path) -> set[str]:
    if not root.is_dir():
        return set()
    return {
        path.name
        for path in root.iterdir()
        if path.is_dir() and not path.name.startswith(".")
    }


def _legacy_identity_issues(session_dir: Path) -> list[str]:
    """Reuse the existing migration classifier only as read-only evidence."""
    from .backfill_stable_ids import classify_session

    try:
        _prepared, action, _reason, codes = classify_session(session_dir)
    except Exception as error:  # census never crashes the remaining corpus
        return [f"legacy_audit_error:{type(error).__name__}"]
    if action == "quarantine":
        return [f"legacy_identity:{code}" for code in codes] or ["legacy_identity:permuted_binding"]
    return []


def audit_level_inventory(
    *,
    source_root: Path,
    public_root: Path,
    lineup_ids: list[str] | tuple[str, ...],
    archived_ids: set[str],
    inspect_legacy: bool = True,
) -> CorpusIntegrityAudit:
    """Classify all known levels without writing, hydrating, or promoting.

    Public-only content remains frozen. A broken source never yields to a public
    namesake: the conflict is visible and quarantined for explicit migration.
    """
    source_ids = _level_dirs(source_root)
    public_ids = _level_dirs(public_root)
    lineup = set(lineup_ids)
    all_ids = sorted(source_ids | public_ids | lineup | archived_ids)
    results: list[LevelIntegrityAudit] = []

    for level_id in all_ids:
        source_present = level_id in source_ids
        public_present = level_id in public_ids
        is_lineup = level_id in lineup
        is_archived = level_id in archived_ids
        issues: list[str] = []
        canonical_state: str | None = None

        if source_present and public_present:
            inventory: InventoryKind = "source_and_public"
        elif source_present:
            inventory = "source_only"
        elif public_present:
            inventory = "public_only"
        else:
            inventory = "metadata_only"

        if source_present:
            read = CanonicalRevisionStore(source_root / level_id).read()
            canonical_state = read.state.value
            if read.state is CanonicalReadState.VALID_CURRENT:
                status: AuditStatus = "safe"
            elif read.state is CanonicalReadState.MIGRATION_REQUIRED:
                status = "migratable"
                issues.append("migration_required")
                if inspect_legacy:
                    legacy_issues = _legacy_identity_issues(source_root / level_id)
                    if legacy_issues:
                        issues.extend(legacy_issues)
                        status = "quarantined"
            else:
                status = "quarantined"
                issues.append(
                    "orphaned_revision_stage"
                    if read.state is CanonicalReadState.ORPHANED_STAGE
                    else "canonical_integrity"
                )
            if public_present and status == "quarantined":
                issues.append("shadowed_projection_conflict")
        else:
            status = "frozen_legacy"
            issues.append("public_only_frozen")

        if not source_present and not public_present:
            status = "quarantined"
            issues.append("inventory_missing")
        if is_archived and is_lineup:
            status = "quarantined"
            issues.append("archived_in_lineup")

        results.append(LevelIntegrityAudit(
            level_id=level_id,
            inventory=inventory,
            status=status,
            issue_codes=tuple(sorted(set(issues))),
            source_present=source_present,
            public_present=public_present,
            lineup=is_lineup,
            archived=is_archived,
            canonical_state=canonical_state,
        ))

    return CorpusIntegrityAudit(tuple(results))
