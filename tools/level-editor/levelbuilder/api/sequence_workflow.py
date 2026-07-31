"""Backend-owned sequence draft workflow for Find the Dog levelbuilder.

This module intentionally owns editor drafts and dry-run payload generation only.
It does not publish Firebase Remote Config or mark a sequence globally live.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import session as S

SEQUENCE_WORKFLOW_STATE_PATH = S.WORKSPACE_ROOT / "state" / "sequence-workflow.json"
_SCHEMA_VERSION = 1
_SEQUENCE_WORKFLOW_LOCK = threading.Lock()
_LIVE_SEQUENCE_MUTATION: dict[str, str] | None = None
# Catalog/sequence level IDs intentionally mirror existing public level IDs,
# but this workflow owns its validation contract rather than importing a
# session-directory private constant.
_SEQUENCE_LEVEL_ID_RE = re.compile(r"^[a-z0-9_-]{3,64}$")
SEQUENCE_WORKFLOW_DIAGNOSTIC_CODES = frozenset({
    "catalogLevelCohortRestricted",
    "catalogLevelMissing",
    "catalogLevelTombstoned",
    "catalogLevelUnlistable",
    "catalogSnapshotsMissing",
    "changelogMissing",
    "levelVisibilityBlocked",
    "sequenceDestructiveChange",
    "sequenceDraftCatalogStale",
    "sequenceDraftStale",
    "sequenceDuplicateLevel",
    "sequenceEmpty",
    "starterPrefixMismatch",
    "starterPrefixTooShort",
    "supportedBuildStartersEmpty",
})


class SequenceDraftStaleError(ValueError):
    """Raised when a draft operation uses stale live/catalog base tokens."""

    def __init__(self, message: str, current_state: dict[str, Any]) -> None:
        super().__init__(message)
        self.current_state = current_state


class SequenceValidationError(ValueError):
    """Raised when a dry-run request has blocking validation diagnostics."""

    def __init__(self, message: str, current_state: dict[str, Any]) -> None:
        super().__init__(message)
        self.current_state = current_state


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _diagnostic(
    code: str,
    message: str,
    *,
    severity: str = "error",
    blocking: bool | None = None,
    level_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if code not in SEQUENCE_WORKFLOW_DIAGNOSTIC_CODES:
        raise ValueError(f"Unknown sequence workflow diagnostic code: {code}")
    return {
        "code": code,
        "severity": severity,
        "blocking": severity == "error" if blocking is None else blocking,
        "message": message,
        **({"levelId": level_id} if level_id is not None else {}),
        **({"details": details} if details is not None else {}),
    }


def _read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    with open(path) as f:
        data = json.load(f)
    return data if isinstance(data, dict) else None


def _write_json_file(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f".json.tmp-{os.getpid()}-{threading.get_ident()}")
    try:
        with open(tmp_path, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _valid_level_ids(level_ids: list[str]) -> bool:
    return all(isinstance(level_id, str) and _SEQUENCE_LEVEL_ID_RE.match(level_id) for level_id in level_ids)


def _draft_revision(
    *,
    level_ids: list[str],
    base_live_sequence_version: str,
    base_catalog_revision: str,
    updated_at: str | None,
) -> str:
    raw = json.dumps({
        "levelIds": level_ids,
        "baseLiveSequenceVersion": base_live_sequence_version,
        "baseCatalogRevision": base_catalog_revision,
        "updatedAt": updated_at,
    }, sort_keys=True, separators=(",", ":"))
    return f"draft-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]}"


def _draft_state(
    *,
    level_ids: list[str],
    base_live_sequence_version: str,
    base_catalog_revision: str,
    updated_at: str | None,
    draft_revision: str | None = None,
) -> dict[str, Any]:
    revision = draft_revision or _draft_revision(
        level_ids=level_ids,
        base_live_sequence_version=base_live_sequence_version,
        base_catalog_revision=base_catalog_revision,
        updated_at=updated_at,
    )
    return {
        "levelIds": level_ids,
        "baseLiveSequenceVersion": base_live_sequence_version,
        "baseCatalogRevision": base_catalog_revision,
        "updatedAt": updated_at,
        "draftRevision": revision,
    }


def _catalog_revision(catalog_manifest: dict[str, Any] | None) -> str:
    if isinstance(catalog_manifest, dict) and isinstance(catalog_manifest.get("catalogRevision"), str):
        return catalog_manifest["catalogRevision"]
    return "catalog-unavailable"


def _bundled_manifest_revision(bundled_manifest: dict[str, Any] | None) -> str:
    if isinstance(bundled_manifest, dict):
        revision = bundled_manifest.get("manifestRevision")
        if isinstance(revision, int) and revision >= 0:
            return str(revision)
    return "0"


def _manifest_level_ids(bundled_manifest: dict[str, Any] | None) -> list[str]:
    levels = bundled_manifest.get("levels") if isinstance(bundled_manifest, dict) else []
    result: list[str] = []
    for level in levels or []:
        if isinstance(level, dict) and isinstance(level.get("id"), str):
            result.append(level["id"])
    return result


def _starter_level_ids(bundled_manifest: dict[str, Any] | None) -> list[str]:
    levels = bundled_manifest.get("levels") if isinstance(bundled_manifest, dict) else []
    bundled_ids = [
        level["id"]
        for level in levels or []
        if isinstance(level, dict) and isinstance(level.get("id"), str) and level.get("bundled") is True
    ]
    if bundled_ids:
        return bundled_ids
    return _manifest_level_ids(bundled_manifest)


def _bootstrap_live_sequence(
    bundled_manifest: dict[str, Any] | None,
    catalog_manifest: dict[str, Any] | None,
) -> dict[str, Any]:
    manifest_revision = _bundled_manifest_revision(bundled_manifest)
    catalog_revision = _catalog_revision(catalog_manifest)
    return {
        "sequenceVersion": f"editor-default-{manifest_revision}",
        "catalogRevision": catalog_revision,
        "levelIds": _starter_level_ids(bundled_manifest),
        "source": "bundled-manifest-default",
        "updatedAt": None,
    }


def _normalize_live_sequence(
    raw: dict[str, Any] | None,
    bundled_manifest: dict[str, Any] | None,
    catalog_manifest: dict[str, Any] | None,
) -> dict[str, Any]:
    if isinstance(raw, dict):
        sequence_version = raw.get("sequenceVersion")
        catalog_revision = raw.get("catalogRevision")
        level_ids = raw.get("levelIds")
        source = raw.get("source")
        if (
            isinstance(sequence_version, str)
            and isinstance(catalog_revision, str)
            and isinstance(level_ids, list)
            and _valid_level_ids(level_ids)
            and isinstance(source, str)
        ):
            return {
                "sequenceVersion": sequence_version,
                "catalogRevision": catalog_revision,
                "levelIds": list(level_ids),
                "source": source,
                "updatedAt": raw.get("updatedAt") if isinstance(raw.get("updatedAt"), str) else None,
            }
    return _bootstrap_live_sequence(bundled_manifest, catalog_manifest)


def _normalize_draft(raw: dict[str, Any] | None, live_sequence: dict[str, Any], catalog_revision: str) -> dict[str, Any]:
    if isinstance(raw, dict):
        level_ids = raw.get("levelIds")
        base_live_sequence_version = raw.get("baseLiveSequenceVersion")
        base_catalog_revision = raw.get("baseCatalogRevision")
        draft_revision = raw.get("draftRevision")
        updated_at = raw.get("updatedAt") if isinstance(raw.get("updatedAt"), str) else None
        if (
            isinstance(level_ids, list)
            and _valid_level_ids(level_ids)
            and isinstance(base_live_sequence_version, str)
            and isinstance(base_catalog_revision, str)
        ):
            return _draft_state(
                level_ids=list(level_ids),
                base_live_sequence_version=base_live_sequence_version,
                base_catalog_revision=base_catalog_revision,
                updated_at=updated_at,
                draft_revision=draft_revision if isinstance(draft_revision, str) else None,
            )
    return _draft_state(
        level_ids=list(live_sequence["levelIds"]),
        base_live_sequence_version=live_sequence["sequenceVersion"],
        base_catalog_revision=catalog_revision,
        updated_at=None,
    )


def _load_raw_state() -> dict[str, Any] | None:
    return _read_json_file(SEQUENCE_WORKFLOW_STATE_PATH)


def _save_raw_state(state: dict[str, Any]) -> None:
    _write_json_file(SEQUENCE_WORKFLOW_STATE_PATH, state)


def _catalog_levels(catalog_manifest: dict[str, Any] | None) -> list[dict[str, Any]]:
    levels = catalog_manifest.get("levels") if isinstance(catalog_manifest, dict) else []
    return [level for level in levels or [] if isinstance(level, dict) and isinstance(level.get("id"), str)]


def _catalog_summary(catalog_manifest: dict[str, Any] | None) -> dict[str, Any]:
    levels = _catalog_levels(catalog_manifest)
    return {
        "available": isinstance(catalog_manifest, dict),
        "catalogRevision": _catalog_revision(catalog_manifest),
        "levelCount": len(levels),
        "levels": [
            {
                "id": level["id"],
                "name": level.get("name") if isinstance(level.get("name"), str) else level["id"],
                "packageId": level.get("packageId") if isinstance(level.get("packageId"), str) else "",
                "listable": level.get("listable") is True,
                "bundledInApp": level.get("bundledInApp") is True,
                "cohortBuckets": level.get("cohortBuckets") if isinstance(level.get("cohortBuckets"), list) else [],
                "allCohortAvailable": level.get("allCohortAvailable") is True,
                "tombstonedAt": level.get("tombstonedAt") if isinstance(level.get("tombstonedAt"), str) else None,
            }
            for level in levels
        ],
    }


def _ab_config() -> dict[str, Any]:
    return _read_json_file(S.GAME_ROOT / "tools" / "ab-config.json") or {}


def _public_level_names() -> list[str]:
    if not S.GAME_PUBLIC_LEVELS.exists():
        return []
    return sorted(
        path.name
        for path in S.GAME_PUBLIC_LEVELS.iterdir()
        if path.is_dir() and (path / "level.json").exists()
    )


def _local_preview_summary(catalog: dict[str, Any], bundled_manifest: dict[str, Any] | None) -> dict[str, Any]:
    """Return the local preview/discovery order used by publish-levels.mjs.

    `tools/ab-config.json#bundledLevelIds` forms the starter prefix, and the
    remaining public level packages follow in stable directory-name order.
    """
    ab_config = _ab_config()
    bundled_level_ids = ab_config.get("bundledLevelIds")
    starter_level_ids = [
        level_id
        for level_id in bundled_level_ids
        if isinstance(level_id, str)
    ] if isinstance(bundled_level_ids, list) else []

    public_level_ids = _public_level_names()
    public_level_set = set(public_level_ids)
    ordered_ids: list[str] = []
    seen: set[str] = set()
    missing_starter_ids: list[str] = []
    for level_id in starter_level_ids:
        if level_id in seen:
            continue
        if level_id not in public_level_set:
            missing_starter_ids.append(level_id)
            continue
        ordered_ids.append(level_id)
        seen.add(level_id)
    for level_id in public_level_ids:
        if level_id in seen:
            continue
        ordered_ids.append(level_id)
        seen.add(level_id)

    catalog_by_id = _catalog_by_id(catalog)
    runtime_manifest_ids = set(_manifest_level_ids(bundled_manifest))
    return {
        "source": "tools/ab-config.json + public/levels",
        "levelCount": len(ordered_ids),
        "starterLevelIds": [level_id for level_id in starter_level_ids if level_id in public_level_set],
        "missingStarterLevelIds": missing_starter_ids,
        "levels": [
            {
                "id": level_id,
                "name": catalog_by_id.get(level_id, {}).get("name", level_id),
                "inStarterPrefix": level_id in starter_level_ids,
                "inRuntimeManifest": level_id in runtime_manifest_ids,
                "catalogUploaded": level_id in catalog_by_id,
                "catalogListable": catalog_by_id.get(level_id, {}).get("listable") is True,
            }
            for level_id in ordered_ids
        ],
    }


def _catalog_by_id(catalog_summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        level["id"]: level
        for level in catalog_summary["levels"]
        if isinstance(level, dict) and isinstance(level.get("id"), str)
    }


def _supported_builds_summary(bundled_manifest: dict[str, Any] | None) -> dict[str, Any]:
    starter_level_ids = _starter_level_ids(bundled_manifest)
    diagnostics: list[dict[str, Any]] = []
    if not starter_level_ids:
        diagnostics.append(_diagnostic(
            "supportedBuildStartersEmpty",
            "Derived supported-build starter set is empty; sequence dry-run cannot prove first-install compatibility.",
        ))
    return {
        "source": "derived-from-bundled-manifest",
        "platforms": ["android", "ios"],
        "starterLevelIds": starter_level_ids,
        "diagnostics": diagnostics,
    }


def _sequence_diff(live_level_ids: list[str], draft_level_ids: list[str]) -> dict[str, Any]:
    live_positions = {level_id: index for index, level_id in enumerate(live_level_ids)}
    draft_positions = {level_id: index for index, level_id in enumerate(draft_level_ids)}
    added_ids = [level_id for level_id in draft_level_ids if level_id not in live_positions]
    removed_ids = [level_id for level_id in live_level_ids if level_id not in draft_positions]
    moved_ids = [
        level_id
        for level_id in draft_level_ids
        if level_id in live_positions and live_positions[level_id] != draft_positions[level_id]
    ]
    return {
        "addedIds": added_ids,
        "removedIds": removed_ids,
        "movedIds": moved_ids,
        "destructive": bool(removed_ids or moved_ids),
    }


def _catalog_status(level_id: str, catalog_by_id: dict[str, dict[str, Any]]) -> str:
    level = catalog_by_id.get(level_id)
    if level is None:
        return "missing"
    if level.get("tombstonedAt") is not None:
        return "tombstoned"
    if level.get("allCohortAvailable") is not True:
        return "cohort-restricted"
    if level.get("listable") is not True:
        return "unlistable"
    return "available"


def _public_level_data(level_id: str) -> dict[str, Any] | None:
    return _read_json_file(S.GAME_PUBLIC_LEVELS / level_id / "level.json")


def _visibility_diagnostics(level_ids: list[str]) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    seen: set[str] = set()
    for level_id in level_ids:
        if level_id in seen:
            continue
        seen.add(level_id)
        level_data = _public_level_data(level_id)
        if level_data is None:
            continue
        report = S.mobile_visibility_report(level_data)
        blocking_issues = S.blocking_visibility_issues(report)
        if not blocking_issues:
            continue
        diagnostics.append(_diagnostic(
            "levelVisibilityBlocked",
            f"Draft-listed level {level_id} has {len(blocking_issues)} mobile HUD/ad/safe-area visibility blocker(s).",
            level_id=level_id,
            details={"blockingIssues": blocking_issues},
        ))
    return diagnostics


def _row_statuses(
    *,
    live_level_ids: list[str],
    draft_level_ids: list[str],
    catalog_by_id: dict[str, dict[str, Any]],
    supported_builds: dict[str, Any],
) -> list[dict[str, Any]]:
    live_positions = {level_id: index for index, level_id in enumerate(live_level_ids)}
    draft_positions = {level_id: index for index, level_id in enumerate(draft_level_ids)}
    starter_ids = set(supported_builds["starterLevelIds"])
    rows: list[dict[str, Any]] = []
    for index, level_id in enumerate(draft_level_ids):
        catalog_level = catalog_by_id.get(level_id)
        rows.append({
            "levelId": level_id,
            "draftIndex": index,
            "liveIndex": live_positions.get(level_id),
            "draftListed": True,
            "liveListed": level_id in live_positions,
            "added": level_id not in live_positions,
            "moved": level_id in live_positions and live_positions[level_id] != index,
            "removed": False,
            "catalogStatus": _catalog_status(level_id, catalog_by_id),
            "catalogListable": bool(catalog_level and catalog_level.get("listable") is True),
            "bundledInApp": bool(catalog_level and catalog_level.get("bundledInApp") is True) or level_id in starter_ids,
            "cohortRestricted": bool(catalog_level and catalog_level.get("allCohortAvailable") is not True),
            "tombstoned": bool(catalog_level and catalog_level.get("tombstonedAt") is not None),
            "name": catalog_level.get("name") if catalog_level and isinstance(catalog_level.get("name"), str) else level_id,
        })
    for level_id in live_level_ids:
        if level_id in draft_positions:
            continue
        catalog_level = catalog_by_id.get(level_id)
        rows.append({
            "levelId": level_id,
            "draftIndex": None,
            "liveIndex": live_positions[level_id],
            "draftListed": False,
            "liveListed": True,
            "added": False,
            "moved": False,
            "removed": True,
            "catalogStatus": _catalog_status(level_id, catalog_by_id),
            "catalogListable": bool(catalog_level and catalog_level.get("listable") is True),
            "bundledInApp": bool(catalog_level and catalog_level.get("bundledInApp") is True) or level_id in starter_ids,
            "cohortRestricted": bool(catalog_level and catalog_level.get("allCohortAvailable") is not True),
            "tombstoned": bool(catalog_level and catalog_level.get("tombstonedAt") is not None),
            "name": catalog_level.get("name") if catalog_level and isinstance(catalog_level.get("name"), str) else level_id,
        })
    return rows


def _missing_catalog_prompt(missing_level_ids: list[str]) -> str | None:
    if not missing_level_ids:
        return None
    ids = ", ".join(missing_level_ids)
    return (
        "Find the Dog sequence draft is blocked because these draft-listed levels are missing from the production catalog: "
        f"{ids}. Upload assets to the production catalog only if these levels are already approved for production catalog availability. "
        "Do not activate or publish the live sequence as part of this fix; return with the catalog upload result and catalog revision."
    )


def _validate_editor_state(
    *,
    live_sequence: dict[str, Any],
    draft: dict[str, Any],
    catalog: dict[str, Any],
    supported_builds: dict[str, Any],
) -> dict[str, Any]:
    diagnostics: list[dict[str, Any]] = []
    draft_level_ids = list(draft["levelIds"])
    live_level_ids = list(live_sequence["levelIds"])
    catalog_by_id = _catalog_by_id(catalog)

    if draft["baseLiveSequenceVersion"] != live_sequence["sequenceVersion"]:
        diagnostics.append(_diagnostic(
            "sequenceDraftStale",
            "Draft is based on an older live sequence. Reload before saving or dry-running.",
            details={
                "expected": live_sequence["sequenceVersion"],
                "actual": draft["baseLiveSequenceVersion"],
            },
        ))
    if draft["baseCatalogRevision"] != catalog["catalogRevision"]:
        diagnostics.append(_diagnostic(
            "sequenceDraftCatalogStale",
            "Draft is based on an older catalog revision. Reload before saving or dry-running.",
            details={
                "expected": catalog["catalogRevision"],
                "actual": draft["baseCatalogRevision"],
            },
        ))

    if not catalog["available"]:
        diagnostics.append(_diagnostic(
            "catalogSnapshotsMissing",
            "Production catalog manifest is unavailable; sequence dry-run cannot prove catalog compatibility.",
        ))

    if not draft_level_ids:
        diagnostics.append(_diagnostic("sequenceEmpty", "Draft sequence must include at least one level."))

    seen: set[str] = set()
    for level_id in draft_level_ids:
        if level_id in seen:
            diagnostics.append(_diagnostic(
                "sequenceDuplicateLevel",
                f"Draft sequence contains duplicate level {level_id}.",
                level_id=level_id,
            ))
        seen.add(level_id)

    missing_catalog_level_ids: list[str] = []
    for level_id in draft_level_ids:
        status = _catalog_status(level_id, catalog_by_id)
        if status == "missing":
            missing_catalog_level_ids.append(level_id)
            diagnostics.append(_diagnostic(
                "catalogLevelMissing",
                f"Draft-listed level {level_id} is missing from the production catalog.",
                level_id=level_id,
            ))
        elif status == "cohort-restricted":
            diagnostics.append(_diagnostic(
                "catalogLevelCohortRestricted",
                f"Draft-listed level {level_id} is cohort-restricted and cannot be in the global V1 sequence.",
                level_id=level_id,
            ))
        elif status == "tombstoned":
            diagnostics.append(_diagnostic(
                "catalogLevelTombstoned",
                f"Draft-listed level {level_id} is tombstoned and not listable.",
                level_id=level_id,
            ))
        elif status == "unlistable":
            diagnostics.append(_diagnostic(
                "catalogLevelUnlistable",
                f"Draft-listed level {level_id} is not listable in the production catalog.",
                level_id=level_id,
            ))

    diagnostics.extend(_visibility_diagnostics(draft_level_ids))
    diagnostics.extend(supported_builds["diagnostics"])

    starter_level_ids = list(supported_builds["starterLevelIds"])
    if starter_level_ids and len(draft_level_ids) < len(starter_level_ids):
        diagnostics.append(_diagnostic(
            "starterPrefixTooShort",
            "Draft sequence is shorter than the derived bundled starter set.",
            details={"starterLevelIds": starter_level_ids},
        ))
    elif starter_level_ids:
        actual_prefix = draft_level_ids[:len(starter_level_ids)]
        if set(actual_prefix) != set(starter_level_ids):
            diagnostics.append(_diagnostic(
                "starterPrefixMismatch",
                "The first sequence positions must contain exactly the derived bundled starter set.",
                details={"expectedStarterIds": starter_level_ids, "actualStarterIds": actual_prefix},
            ))

    diff = _sequence_diff(live_level_ids, draft_level_ids)
    if diff["destructive"]:
        diagnostics.append(_diagnostic(
            "sequenceDestructiveChange",
            "Draft moves or removes live-listed levels; review the player-facing order impact before activation.",
            severity="warning",
            blocking=False,
            details=diff,
        ))

    copy_prompt = _missing_catalog_prompt(missing_catalog_level_ids)
    blocking_diagnostics = [diagnostic for diagnostic in diagnostics if diagnostic["blocking"]]
    return {
        "activatable": len(blocking_diagnostics) == 0,
        "dryRunnable": len(blocking_diagnostics) == 0,
        "diagnostics": diagnostics,
        "blockingDiagnostics": blocking_diagnostics,
        "warnings": [diagnostic for diagnostic in diagnostics if diagnostic["severity"] == "warning"],
        "diff": diff,
        "rows": _row_statuses(
            live_level_ids=live_level_ids,
            draft_level_ids=draft_level_ids,
            catalog_by_id=catalog_by_id,
            supported_builds=supported_builds,
        ),
        "missingCatalogLevelIds": missing_catalog_level_ids,
        "copyFixPrompt": copy_prompt,
    }


def _build_state() -> dict[str, Any]:
    raw_state = _load_raw_state() or {}
    bundled_manifest = S.load_bundled_manifest()
    catalog_manifest = S.load_catalog_manifest()
    catalog = _catalog_summary(catalog_manifest)
    local_preview = _local_preview_summary(catalog, bundled_manifest)
    live_sequence = _normalize_live_sequence(
        raw_state.get("liveSequence") if isinstance(raw_state, dict) else None,
        bundled_manifest,
        catalog_manifest,
    )
    draft = _normalize_draft(
        raw_state.get("draft") if isinstance(raw_state, dict) else None,
        live_sequence,
        catalog["catalogRevision"],
    )
    supported_builds = _supported_builds_summary(bundled_manifest)
    validation = _validate_editor_state(
        live_sequence=live_sequence,
        draft=draft,
        catalog=catalog,
        supported_builds=supported_builds,
    )
    return {
        "schemaVersion": _SCHEMA_VERSION,
        "liveSequence": live_sequence,
        "draft": draft,
        "catalog": catalog,
        "localPreview": local_preview,
        "supportedBuilds": supported_builds,
        "validation": validation,
    }


def get_sequence_editor_state() -> dict[str, Any]:
    with _SEQUENCE_WORKFLOW_LOCK:
        return _build_state()


def _assert_base_current(
    *,
    state: dict[str, Any],
    base_live_sequence_version: str,
    base_catalog_revision: str,
) -> None:
    live_sequence = state["liveSequence"]
    catalog = state["catalog"]
    if (
        base_live_sequence_version != live_sequence["sequenceVersion"]
        or base_catalog_revision != catalog["catalogRevision"]
    ):
        raise SequenceDraftStaleError("Sequence draft base is stale; reload current live/catalog state.", state)


def _assert_draft_current(*, state: dict[str, Any], draft_revision: str) -> None:
    if draft_revision != state["draft"]["draftRevision"]:
        raise SequenceDraftStaleError("Sequence draft was changed by another editor. Reload before saving or dry-running.", state)


def _assert_no_live_sequence_mutation(state: dict[str, Any]) -> None:
    if _LIVE_SEQUENCE_MUTATION is not None:
        raise SequenceDraftStaleError("Live sequence publish is in progress; reload after it completes before editing the draft.", state)


def begin_live_sequence_mutation(
    *,
    operation: str,
    request_id: str,
    draft_revision: str | None,
    base_live_sequence_version: str,
    base_catalog_revision: str,
) -> dict[str, Any]:
    global _LIVE_SEQUENCE_MUTATION
    with _SEQUENCE_WORKFLOW_LOCK:
        state = _build_state()
        _assert_no_live_sequence_mutation(state)
        _assert_base_current(
            state=state,
            base_live_sequence_version=base_live_sequence_version,
            base_catalog_revision=base_catalog_revision,
        )
        if draft_revision is not None:
            _assert_draft_current(state=state, draft_revision=draft_revision)
        _LIVE_SEQUENCE_MUTATION = {"operation": operation, "requestId": request_id}
        return state


def clear_live_sequence_mutation(*, request_id: str) -> None:
    global _LIVE_SEQUENCE_MUTATION
    with _SEQUENCE_WORKFLOW_LOCK:
        if _LIVE_SEQUENCE_MUTATION is not None and _LIVE_SEQUENCE_MUTATION.get("requestId") == request_id:
            _LIVE_SEQUENCE_MUTATION = None


def save_sequence_draft(
    *,
    level_ids: list[str],
    base_live_sequence_version: str,
    base_catalog_revision: str,
    draft_revision: str,
) -> dict[str, Any]:
    if not _valid_level_ids(level_ids):
        raise ValueError("Draft level IDs must be lowercase ids with letters, numbers, underscores, or dashes.")
    with _SEQUENCE_WORKFLOW_LOCK:
        state = _build_state()
        _assert_no_live_sequence_mutation(state)
        _assert_base_current(
            state=state,
            base_live_sequence_version=base_live_sequence_version,
            base_catalog_revision=base_catalog_revision,
        )
        _assert_draft_current(state=state, draft_revision=draft_revision)
        raw_state = _load_raw_state() or {}
        live_sequence = state["liveSequence"]
        updated_at = _utc_now_iso()
        draft = _draft_state(
            level_ids=list(level_ids),
            base_live_sequence_version=live_sequence["sequenceVersion"],
            base_catalog_revision=state["catalog"]["catalogRevision"],
            updated_at=updated_at,
        )
        _save_raw_state({
            "schemaVersion": _SCHEMA_VERSION,
            "liveSequence": live_sequence,
            "draft": draft,
            "updatedAt": _utc_now_iso(),
            **({"history": raw_state.get("history")} if isinstance(raw_state.get("history"), list) else {}),
        })
        return _build_state()


def reset_sequence_draft(*, draft_revision: str, force: bool = False) -> dict[str, Any]:
    with _SEQUENCE_WORKFLOW_LOCK:
        state = _build_state()
        _assert_no_live_sequence_mutation(state)
        if not force:
            _assert_draft_current(state=state, draft_revision=draft_revision)
        raw_state = _load_raw_state() or {}
        live_sequence = state["liveSequence"]
        updated_at = _utc_now_iso()
        _save_raw_state({
            "schemaVersion": _SCHEMA_VERSION,
            "liveSequence": live_sequence,
            "draft": _draft_state(
                level_ids=list(live_sequence["levelIds"]),
                base_live_sequence_version=live_sequence["sequenceVersion"],
                base_catalog_revision=state["catalog"]["catalogRevision"],
                updated_at=updated_at,
            ),
            "updatedAt": _utc_now_iso(),
            **({"history": raw_state.get("history")} if isinstance(raw_state.get("history"), list) else {}),
        })
        return _build_state()


def set_live_sequence_from_activation(
    *,
    sequence_version: str,
    catalog_revision: str,
    level_ids: list[str],
) -> dict[str, Any]:
    """Update the editor live mirror after a successful activation or rollback."""
    if not _valid_level_ids(level_ids):
        raise ValueError("Live sequence level IDs must be lowercase ids with letters, numbers, underscores, or dashes.")
    with _SEQUENCE_WORKFLOW_LOCK:
        raw_state = _load_raw_state() or {}
        updated_at = _utc_now_iso()
        live_sequence = {
            "sequenceVersion": sequence_version,
            "catalogRevision": catalog_revision,
            "levelIds": list(level_ids),
            "source": "remote-config-activation",
            "updatedAt": updated_at,
        }
        _save_raw_state({
            "schemaVersion": _SCHEMA_VERSION,
            "liveSequence": live_sequence,
            "draft": _draft_state(
                level_ids=list(level_ids),
                base_live_sequence_version=sequence_version,
                base_catalog_revision=catalog_revision,
                updated_at=updated_at,
            ),
            "updatedAt": updated_at,
            **({"history": raw_state.get("history")} if isinstance(raw_state.get("history"), list) else {}),
        })
        return _build_state()


def _canonical_payload_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def dry_run_sequence_draft(
    *,
    changelog_note: str,
    base_live_sequence_version: str,
    base_catalog_revision: str,
    draft_revision: str,
) -> dict[str, Any]:
    with _SEQUENCE_WORKFLOW_LOCK:
        state = _build_state()
        _assert_base_current(
            state=state,
            base_live_sequence_version=base_live_sequence_version,
            base_catalog_revision=base_catalog_revision,
        )
        _assert_draft_current(state=state, draft_revision=draft_revision)
        validation = state["validation"]
        diagnostics = list(validation["diagnostics"])
        note = changelog_note.strip()
        if not note:
            diagnostics.append(_diagnostic(
                "changelogMissing",
                "A short changelog note is required before dry-running an activation candidate.",
            ))
        blocking = [diagnostic for diagnostic in diagnostics if diagnostic["blocking"]]
        if blocking:
            failed_state = {
                **state,
                "validation": {
                    **validation,
                    "diagnostics": diagnostics,
                    "blockingDiagnostics": blocking,
                    "activatable": False,
                    "dryRunnable": False,
                },
            }
            raise SequenceValidationError("Sequence draft has blocking validation diagnostics.", failed_state)

        payload = {
            "schemaVersion": 1,
            "sequenceVersion": f"seq-editor-dry-run-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            "catalogRevision": state["catalog"]["catalogRevision"],
            "levelIds": state["draft"]["levelIds"],
        }
        raw_payload = _canonical_payload_json(payload)
        return {
            "ok": True,
            "changelogNote": note,
            "payload": payload,
            "rawPayload": raw_payload,
            "sha256Hex": hashlib.sha256(raw_payload.encode("utf-8")).hexdigest(),
            "diagnostics": diagnostics,
            "state": state,
            "globalActivationMutated": False,
        }
