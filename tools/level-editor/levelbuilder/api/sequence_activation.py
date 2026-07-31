"""Live sequence activation and rollback workflow for Find the Dog Levelbuilder."""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import remote_config_publisher as RemoteConfigPublisher
from . import sequence_workflow as SequenceWorkflow
from . import session as S

SEQUENCE_ACTIVATION_STATE_PATH = S.WORKSPACE_ROOT / "state" / "sequence-activation.json"
SEQUENCE_ACTIVATION_SCHEMA_VERSION = 1
SEQUENCE_PAYLOAD_MAX_BYTES = 64 * 1024
_SEQUENCE_ACTIVATION_LOCK = threading.Lock()
_SEQUENCE_PUBLISH_LOCK = threading.Lock()
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class SequenceActivationConflict(ValueError):
    """Raised when activation uses stale local draft/live/catalog tokens."""

    def __init__(self, message: str, current_state: dict[str, Any]) -> None:
        super().__init__(message)
        self.current_state = current_state


class SequenceActivationValidationError(ValueError):
    """Raised when activation or rollback has blocking validation diagnostics."""

    def __init__(self, message: str, diagnostics: list[dict[str, Any]], current_state: dict[str, Any]) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics
        self.current_state = current_state


class SequenceActivationRemoteConflict(ValueError):
    """Raised when Firebase Remote Config rejects a stale template publish."""

    def __init__(self, message: str, current_state: dict[str, Any]) -> None:
        super().__init__(message)
        self.current_state = current_state


class SequenceActivationPublishUnavailable(ValueError):
    """Raised when live publish is requested without a configured publisher."""

    def __init__(self, message: str, current_state: dict[str, Any]) -> None:
        super().__init__(message)
        self.current_state = current_state


class SequenceActivationPublishError(RuntimeError):
    """Raised when Remote Config publishing fails after local validation."""

    def __init__(self, message: str, current_state: dict[str, Any]) -> None:
        super().__init__(message)
        self.current_state = current_state


class SequenceActivationStateError(ValueError):
    """Raised when the app-owned activation ledger is corrupt or incompatible."""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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
        tmp_path.unlink(missing_ok=True)


def _canonical_payload_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _diagnostic(
    code: str,
    message: str,
    *,
    severity: str = "error",
    blocking: bool | None = None,
    level_id: str | None = None,
    package_id: str | None = None,
    version: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "blocking": severity == "error" if blocking is None else blocking,
        "message": message,
        **({"levelId": level_id} if level_id is not None else {}),
        **({"packageId": package_id} if package_id is not None else {}),
        **({"version": version} if version is not None else {}),
        **({"details": details} if details is not None else {}),
    }


def _bootstrap_state(workflow_state: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": SEQUENCE_ACTIVATION_SCHEMA_VERSION,
        "activeVersion": workflow_state["liveSequence"]["sequenceVersion"],
        "versions": [],
        "auditEvents": [],
        "pendingAttempts": [],
        "updatedAt": None,
    }


def _normalize_state(raw: dict[str, Any] | None, workflow_state: dict[str, Any]) -> dict[str, Any]:
    if raw is None:
        return _bootstrap_state(workflow_state)
    if not isinstance(raw, dict):
        raise SequenceActivationStateError("Sequence activation ledger must be a JSON object.")
    if raw.get("schemaVersion") != SEQUENCE_ACTIVATION_SCHEMA_VERSION:
        raise SequenceActivationStateError("Sequence activation ledger schemaVersion is unsupported.")
    active_version = raw.get("activeVersion")
    if not isinstance(active_version, str):
        raise SequenceActivationStateError("Sequence activation ledger activeVersion must be a string.")
    versions = _required_dict_list(raw, "versions")
    audit_events = _required_dict_list(raw, "auditEvents")
    pending_attempts = _required_dict_list(raw, "pendingAttempts")
    updated_at = raw.get("updatedAt")
    if updated_at is not None and not isinstance(updated_at, str):
        raise SequenceActivationStateError("Sequence activation ledger updatedAt must be a string when present.")
    return {
        "schemaVersion": SEQUENCE_ACTIVATION_SCHEMA_VERSION,
        "activeVersion": active_version,
        "versions": versions,
        "auditEvents": audit_events,
        "pendingAttempts": pending_attempts,
        "updatedAt": updated_at,
    }


def _required_dict_list(raw: dict[str, Any], field_name: str) -> list[dict[str, Any]]:
    value = raw.get(field_name)
    if not isinstance(value, list):
        raise SequenceActivationStateError(f"Sequence activation ledger {field_name} must be a list.")
    if not all(isinstance(entry, dict) for entry in value):
        raise SequenceActivationStateError(f"Sequence activation ledger {field_name} entries must be objects.")
    return list(value)


def _load_state(workflow_state: dict[str, Any]) -> dict[str, Any]:
    return _normalize_state(_read_json_file(SEQUENCE_ACTIVATION_STATE_PATH), workflow_state)


def _save_state(state: dict[str, Any]) -> None:
    _write_json_file(SEQUENCE_ACTIVATION_STATE_PATH, {**state, "updatedAt": _utc_now_iso()})


def _version_by_id(state: dict[str, Any], sequence_version: str) -> dict[str, Any] | None:
    for version in state["versions"]:
        if version.get("sequenceVersion") == sequence_version:
            return version
    return None


def _event_by_request_id(state: dict[str, Any], request_id: str) -> dict[str, Any] | None:
    for event in state["auditEvents"]:
        if event.get("requestId") == request_id and event.get("status") == "finalized":
            return event
    return None


def _matching_finalized_event(
    state: dict[str, Any],
    *,
    request_id: str,
    operation: str,
    target_version: str,
) -> dict[str, Any] | None:
    event = _event_by_request_id(state, request_id)
    if event is None:
        return None
    if event.get("operation") == operation and event.get("toVersion") == target_version:
        return event
    raise SequenceActivationConflict("Request id was already used for a different sequence operation.", state)


def _pending_by_request_id(state: dict[str, Any], request_id: str) -> dict[str, Any] | None:
    for attempt in state["pendingAttempts"]:
        if attempt.get("requestId") == request_id:
            return attempt
    return None


def _pending_matches_candidate(pending: dict[str, Any], *, operation: str, candidate: dict[str, Any]) -> bool:
    return (
        pending.get("operation") == operation
        and pending.get("sequenceVersion") == candidate["sequenceVersion"]
        and pending.get("rawPayload") == candidate["rawPayload"]
        and pending.get("sha256Hex") == candidate["sha256Hex"]
    )


def _state_with_retention(state: dict[str, Any]) -> dict[str, Any]:
    retained_level_ids: set[str] = set()
    retained_package_ids: set[str] = set()
    for version in state["versions"]:
        if version.get("sequenceVersion") != state["activeVersion"] and version.get("rollbackEligible") is not True:
            continue
        for level_id in version.get("levelIds") or []:
            if isinstance(level_id, str):
                retained_level_ids.add(level_id)
        for package_id in version.get("packageIds") or []:
            if isinstance(package_id, str):
                retained_package_ids.add(package_id)
    return {
        **state,
        "retention": {
            "retainedLevelIds": sorted(retained_level_ids),
            "retainedPackageIds": sorted(retained_package_ids),
        },
    }


def get_sequence_activation_state(workflow_state: dict[str, Any] | None = None) -> dict[str, Any]:
    current_workflow_state = workflow_state if workflow_state is not None else SequenceWorkflow.get_sequence_editor_state()
    with _SEQUENCE_ACTIVATION_LOCK:
        return _state_with_retention(_load_state(current_workflow_state))


def _assert_local_tokens_current(
    *,
    workflow_state: dict[str, Any],
    draft_revision: str,
    base_live_sequence_version: str,
    base_catalog_revision: str,
) -> None:
    if (
        workflow_state["draft"]["draftRevision"] != draft_revision
        or workflow_state["liveSequence"]["sequenceVersion"] != base_live_sequence_version
        or workflow_state["catalog"]["catalogRevision"] != base_catalog_revision
    ):
        raise SequenceActivationConflict("Sequence activation request is stale; reload current sequence workflow state.", workflow_state)


def _catalog_manifest_for_revision(catalog_revision: str) -> dict[str, Any] | None:
    current_manifest = S.load_catalog_manifest()
    if isinstance(current_manifest, dict) and current_manifest.get("catalogRevision") == catalog_revision:
        return current_manifest
    return S.load_catalog_snapshot(catalog_revision)


def _catalog_levels_by_id(catalog_revision: str | None = None) -> dict[str, dict[str, Any]]:
    manifest = _catalog_manifest_for_revision(catalog_revision) if catalog_revision is not None else S.load_catalog_manifest()
    levels = manifest.get("levels") if isinstance(manifest, dict) else []
    return {
        level["id"]: level
        for level in levels or []
        if isinstance(level, dict) and isinstance(level.get("id"), str)
    }


def _starter_level_ids() -> list[str]:
    manifest = S.load_bundled_manifest()
    levels = manifest.get("levels") if isinstance(manifest, dict) else []
    return [
        level["id"]
        for level in levels or []
        if isinstance(level, dict) and isinstance(level.get("id"), str) and level.get("bundled") is True
    ]


def _activation_catalog_diagnostics(level_ids: list[str], catalog_revision: str) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    catalog_levels = _catalog_levels_by_id(catalog_revision)
    if not catalog_levels and _catalog_manifest_for_revision(catalog_revision) is None:
        diagnostics.append(_diagnostic("catalogSnapshotUnavailable", f"Catalog snapshot {catalog_revision} is not available."))
        return diagnostics

    for level_id in level_ids:
        catalog_level = catalog_levels.get(level_id)
        if catalog_level is None:
            diagnostics.append(_diagnostic("catalogLevelMissing", f"Listed level {level_id} is missing from catalog snapshot {catalog_revision}.", level_id=level_id))
            continue
        if catalog_level.get("tombstonedAt") is not None:
            diagnostics.append(_diagnostic("catalogLevelTombstoned", f"Listed level {level_id} is tombstoned.", level_id=level_id))
        elif catalog_level.get("allCohortAvailable") is not True:
            diagnostics.append(_diagnostic("catalogLevelCohortRestricted", f"Listed level {level_id} is cohort-restricted.", level_id=level_id))
        elif catalog_level.get("listable") is not True:
            diagnostics.append(_diagnostic("catalogLevelUnlistable", f"Listed level {level_id} is not listable.", level_id=level_id))

    starter_ids = _starter_level_ids()
    if starter_ids:
        if len(level_ids) < len(starter_ids):
            diagnostics.append(_diagnostic("starterPrefixTooShort", "Rollback target is shorter than the bundled starter prefix."))
        elif set(level_ids[:len(starter_ids)]) != set(starter_ids):
            diagnostics.append(_diagnostic("starterPrefixMismatch", "Rollback target does not preserve the bundled starter prefix."))
    return diagnostics


def _package_diagnostics(level_ids: list[str], catalog_revision: str | None = None) -> tuple[list[dict[str, Any]], list[str]]:
    diagnostics: list[dict[str, Any]] = []
    package_ids: list[str] = []
    seen_package_ids: set[str] = set()
    duplicate_package_ids: set[str] = set()
    catalog_by_id = _catalog_levels_by_id(catalog_revision)
    for level_id in level_ids:
        catalog_level = catalog_by_id.get(level_id)
        if catalog_level is None:
            continue
        package_id = catalog_level.get("packageId")
        if not isinstance(package_id, str) or not package_id:
            diagnostics.append(_diagnostic("packageMissing", f"Catalog level {level_id} is missing package metadata.", level_id=level_id))
            continue
        if package_id in seen_package_ids:
            duplicate_package_ids.add(package_id)
        seen_package_ids.add(package_id)
        package_ids.append(package_id)
        package = catalog_level.get("package")
        if not isinstance(package, dict) or package.get("complete") is not True:
            diagnostics.append(_diagnostic("packageIncomplete", f"Catalog package {package_id} is not complete.", level_id=level_id, package_id=package_id))
            continue
        required_assets = package.get("requiredAssets")
        if not isinstance(required_assets, list) or len(required_assets) == 0:
            diagnostics.append(_diagnostic("packageIncomplete", f"Catalog package {package_id} has no required assets.", level_id=level_id, package_id=package_id))
            continue
        for asset in required_assets:
            if not isinstance(asset, dict):
                diagnostics.append(_diagnostic("packageAssetInvalid", f"Catalog package {package_id} contains invalid required asset metadata.", level_id=level_id, package_id=package_id))
                continue
            asset_hash = asset.get("hash")
            asset_size = asset.get("size")
            if not isinstance(asset_hash, str) or _SHA256_RE.match(asset_hash) is None or not isinstance(asset_size, int) or asset_size <= 0:
                diagnostics.append(_diagnostic(
                    "packageAssetInvalid",
                    f"Catalog package {package_id} contains invalid required asset metadata.",
                    level_id=level_id,
                    package_id=package_id,
                    details={"hash": asset_hash, "size": asset_size},
                ))
    for package_id in sorted(duplicate_package_ids):
        diagnostics.append(_diagnostic("packageDuplicate", f"Catalog package {package_id} is used by multiple listed levels.", package_id=package_id))
    return diagnostics, sorted(set(package_ids))


def _activation_payload(*, sequence_version: str, catalog_revision: str, level_ids: list[str]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "sequenceVersion": sequence_version,
        "catalogRevision": catalog_revision,
        "levelIds": level_ids,
    }


def _sequence_version_for_request(*, request_id: str, catalog_revision: str, level_ids: list[str]) -> str:
    raw = json.dumps({"requestId": request_id, "catalogRevision": catalog_revision, "levelIds": level_ids}, sort_keys=True)
    return f"seq-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]}"


def _prepare_activation_candidate(
    *,
    workflow_state: dict[str, Any],
    changelog_note: str,
    destructive_warning_acknowledged: bool,
    request_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    diagnostics = list(workflow_state["validation"]["diagnostics"])
    note = changelog_note.strip()
    if not note:
        diagnostics.append(_diagnostic("changelogMissing", "A changelog note is required before live activation."))
    diff = workflow_state["validation"]["diff"]
    if diff.get("destructive") is True and not destructive_warning_acknowledged:
        diagnostics.append(_diagnostic(
            "sequenceDestructiveChangeUnacknowledged",
            "A destructive sequence change must be acknowledged before live activation.",
            details=diff,
        ))
    package_diagnostics, package_ids = _package_diagnostics(list(workflow_state["draft"]["levelIds"]))
    diagnostics.extend(package_diagnostics)

    sequence_version = _sequence_version_for_request(
        request_id=request_id,
        catalog_revision=workflow_state["catalog"]["catalogRevision"],
        level_ids=list(workflow_state["draft"]["levelIds"]),
    )
    payload = _activation_payload(
        sequence_version=sequence_version,
        catalog_revision=workflow_state["catalog"]["catalogRevision"],
        level_ids=list(workflow_state["draft"]["levelIds"]),
    )
    raw_payload = _canonical_payload_json(payload)
    actual_bytes = len(raw_payload.encode("utf-8"))
    if actual_bytes > SEQUENCE_PAYLOAD_MAX_BYTES:
        diagnostics.append(_diagnostic(
            "payloadTooLarge",
            "Remote Config sequence payload exceeds the configured byte budget.",
            details={"actualBytes": actual_bytes, "maxBytes": SEQUENCE_PAYLOAD_MAX_BYTES},
        ))
    candidate = {
        "sequenceVersion": sequence_version,
        "catalogRevision": payload["catalogRevision"],
        "levelIds": payload["levelIds"],
        "rawPayload": raw_payload,
        "sha256Hex": _sha256_hex(raw_payload),
        "changelogNote": note,
        "destructiveDiff": diff,
        "packageIds": package_ids,
    }
    return candidate, diagnostics, package_ids


def _blocking(diagnostics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [diagnostic for diagnostic in diagnostics if diagnostic.get("blocking") is True]


def _pending_attempt(
    *,
    operation: str,
    request_id: str,
    actor: str,
    candidate: dict[str, Any],
    status: str,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "requestId": request_id,
        "operation": operation,
        "status": status,
        "actor": actor,
        "sequenceVersion": candidate["sequenceVersion"],
        "rawPayload": candidate["rawPayload"],
        "sha256Hex": candidate["sha256Hex"],
        "createdAt": _utc_now_iso(),
        **({"error": error} if error is not None else {}),
    }


def _audit_event(
    *,
    operation: str,
    request_id: str,
    actor: str,
    from_version: str | None,
    to_version: str,
    changelog_note: str,
    diagnostics: list[dict[str, Any]],
    publish_metadata: dict[str, Any],
) -> dict[str, Any]:
    event_id = f"evt-{hashlib.sha256(f'{operation}:{request_id}:{to_version}'.encode('utf-8')).hexdigest()[:16]}"
    return {
        "eventId": event_id,
        "operation": operation,
        "requestId": request_id,
        "status": "finalized",
        "actor": actor,
        "fromVersion": from_version,
        "toVersion": to_version,
        "changelogNote": changelog_note,
        "diagnostics": diagnostics,
        "remoteConfig": publish_metadata,
        "createdAt": _utc_now_iso(),
    }


def _version_from_workflow_state(workflow_state: dict[str, Any]) -> dict[str, Any]:
    live_sequence = workflow_state["liveSequence"]
    level_ids = list(live_sequence["levelIds"])
    package_diagnostics, package_ids = _package_diagnostics(level_ids)
    payload = _activation_payload(
        sequence_version=live_sequence["sequenceVersion"],
        catalog_revision=live_sequence["catalogRevision"],
        level_ids=level_ids,
    )
    raw_payload = _canonical_payload_json(payload)
    return {
        "sequenceVersion": live_sequence["sequenceVersion"],
        "catalogRevision": live_sequence["catalogRevision"],
        "levelIds": level_ids,
        "rawPayload": raw_payload,
        "sha256Hex": _sha256_hex(raw_payload),
        "rollbackEligible": True,
        "createdAt": live_sequence.get("updatedAt") or _utc_now_iso(),
        "createdFromRequestId": None,
        "changelogNote": "Bootstrap previous live/default sequence before first activation.",
        "destructiveDiff": {"addedIds": [], "removedIds": [], "movedIds": [], "destructive": False},
        "packageIds": package_ids,
        "bootstrapDiagnostics": package_diagnostics,
    }


def _ensure_active_version_entry(state: dict[str, Any], workflow_state: dict[str, Any]) -> None:
    active_version = state["activeVersion"]
    if _version_by_id(state, active_version) is not None:
        return
    state["versions"].append(_version_from_workflow_state(workflow_state))


def _record_pending_status(state: dict[str, Any], request_id: str, *, status: str, error: str) -> None:
    state["pendingAttempts"] = [
        attempt if attempt.get("requestId") != request_id else {**attempt, "status": status, "error": error}
        for attempt in state["pendingAttempts"]
    ]


def _publisher_matches_payload(
    publisher: RemoteConfigPublisher.RemoteConfigPublisher,
    *,
    raw_payload: str,
    sha256_hex: str,
) -> bool:
    matcher = getattr(publisher, "published_sequence_matches", None)
    if not callable(matcher):
        return False
    try:
        return bool(matcher(raw_payload=raw_payload, sha256_hex=sha256_hex))
    except (RemoteConfigPublisher.RemoteConfigPublishError, RemoteConfigPublisher.RemoteConfigPublishUnavailable):
        return False


def _set_live_sequence_from_activation_and_clear(
    *,
    request_id: str,
    sequence_version: str,
    catalog_revision: str,
    level_ids: list[str],
) -> None:
    try:
        SequenceWorkflow.set_live_sequence_from_activation(
            sequence_version=sequence_version,
            catalog_revision=catalog_revision,
            level_ids=level_ids,
        )
    finally:
        SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)


def _append_pending_if_needed(
    *,
    state: dict[str, Any],
    operation: str,
    request_id: str,
    actor: str,
    candidate: dict[str, Any],
) -> bool:
    pending = _pending_by_request_id(state, request_id)
    if pending is None:
        state["pendingAttempts"].append(_pending_attempt(
            operation=operation,
            request_id=request_id,
            actor=actor,
            candidate=candidate,
            status="pendingPublish",
        ))
        return False
    if not _pending_matches_candidate(pending, operation=operation, candidate=candidate):
        raise SequenceActivationConflict("Request id is already pending for a different sequence operation.", state)
    return True


def _finalize_activation(
    *,
    state: dict[str, Any],
    workflow_state: dict[str, Any],
    candidate: dict[str, Any],
    request_id: str,
    actor: str,
    diagnostics: list[dict[str, Any]],
    publish_metadata: dict[str, Any],
) -> dict[str, Any]:
    previous_active = state["activeVersion"]
    _ensure_active_version_entry(state, workflow_state)
    version = _version_by_id(state, candidate["sequenceVersion"])
    if version is None:
        version = {
            "sequenceVersion": candidate["sequenceVersion"],
            "catalogRevision": candidate["catalogRevision"],
            "levelIds": candidate["levelIds"],
            "rawPayload": candidate["rawPayload"],
            "sha256Hex": candidate["sha256Hex"],
            "rollbackEligible": True,
            "createdAt": _utc_now_iso(),
            "createdFromRequestId": request_id,
            "changelogNote": candidate["changelogNote"],
            "destructiveDiff": candidate["destructiveDiff"],
            "packageIds": candidate["packageIds"],
            "remoteConfig": publish_metadata,
        }
        state["versions"].append(version)
    state["activeVersion"] = candidate["sequenceVersion"]
    if _matching_finalized_event(
        state,
        request_id=request_id,
        operation="activate",
        target_version=candidate["sequenceVersion"],
    ) is None:
        state["auditEvents"].append(_audit_event(
            operation="activate",
            request_id=request_id,
            actor=actor,
            from_version=previous_active,
            to_version=candidate["sequenceVersion"],
            changelog_note=candidate["changelogNote"],
            diagnostics=diagnostics,
            publish_metadata=publish_metadata,
        ))
    state["pendingAttempts"] = [attempt for attempt in state["pendingAttempts"] if attempt.get("requestId") != request_id]
    _save_state(state)
    S.update_catalog_retention_for_activation_versions(state["activeVersion"], state["versions"])
    _set_live_sequence_from_activation_and_clear(
        request_id=request_id,
        sequence_version=candidate["sequenceVersion"],
        catalog_revision=candidate["catalogRevision"],
        level_ids=list(candidate["levelIds"]),
    )
    return version


def _result_from_event(state: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    target = event.get("toVersion")
    version = _version_by_id(state, target) if isinstance(target, str) else None
    if version is not None:
        workflow_state = SequenceWorkflow.get_sequence_editor_state()
        if state["activeVersion"] == version["sequenceVersion"] and workflow_state["liveSequence"]["sequenceVersion"] != version["sequenceVersion"]:
            SequenceWorkflow.set_live_sequence_from_activation(
                sequence_version=version["sequenceVersion"],
                catalog_revision=version["catalogRevision"],
                level_ids=list(version["levelIds"]),
            )
    return {
        "ok": True,
        "version": version,
        "auditEvent": event,
        "state": _state_with_retention(state),
        "idempotent": True,
    }


def activate_sequence_draft(
    *,
    draft_revision: str,
    base_live_sequence_version: str,
    base_catalog_revision: str,
    changelog_note: str,
    destructive_warning_acknowledged: bool,
    request_id: str,
    publisher: RemoteConfigPublisher.RemoteConfigPublisher,
    actor: str,
) -> dict[str, Any]:
    # Guard-leak containment (fresh-review, ledger 054 #39): the in-memory
    # _LIVE_SEQUENCE_MUTATION guard is set mid-flight by the inner body, and
    # several unexpected-failure paths (a raising _save_state, a non-publish
    # exception from the publisher, a failing finalize) used to skip the
    # clear — wedging EVERY subsequent draft edit with "publish is in
    # progress" until server restart. clear is request-id-guarded and
    # idempotent: paths that already cleared (or never reached begin) no-op.
    try:
        return _activate_sequence_draft_inner(
            draft_revision=draft_revision,
            base_live_sequence_version=base_live_sequence_version,
            base_catalog_revision=base_catalog_revision,
            changelog_note=changelog_note,
            destructive_warning_acknowledged=destructive_warning_acknowledged,
            request_id=request_id,
            publisher=publisher,
            actor=actor,
        )
    except BaseException:
        SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
        raise


def _activate_sequence_draft_inner(
    *,
    draft_revision: str,
    base_live_sequence_version: str,
    base_catalog_revision: str,
    changelog_note: str,
    destructive_warning_acknowledged: bool,
    request_id: str,
    publisher: RemoteConfigPublisher.RemoteConfigPublisher,
    actor: str,
) -> dict[str, Any]:
    with _SEQUENCE_PUBLISH_LOCK:
        workflow_state = SequenceWorkflow.get_sequence_editor_state()
        with _SEQUENCE_ACTIVATION_LOCK:
            state = _load_state(workflow_state)
            _assert_local_tokens_current(
                workflow_state=workflow_state,
                draft_revision=draft_revision,
                base_live_sequence_version=base_live_sequence_version,
                base_catalog_revision=base_catalog_revision,
            )
            candidate, diagnostics, _ = _prepare_activation_candidate(
                workflow_state=workflow_state,
                changelog_note=changelog_note,
                destructive_warning_acknowledged=destructive_warning_acknowledged,
                request_id=request_id,
            )
            existing_event = _matching_finalized_event(
                state,
                request_id=request_id,
                operation="activate",
                target_version=candidate["sequenceVersion"],
            )
            if existing_event is not None:
                return _result_from_event(state, existing_event)
            blocking = _blocking(diagnostics)
            if blocking:
                raise SequenceActivationValidationError("Sequence activation has blocking diagnostics.", diagnostics, workflow_state)
            if publisher.status().get("configured") is not True:
                raise SequenceActivationPublishUnavailable("Remote Config publisher is not configured.", workflow_state)
            SequenceWorkflow.begin_live_sequence_mutation(
                operation="activate",
                request_id=request_id,
                draft_revision=draft_revision,
                base_live_sequence_version=base_live_sequence_version,
                base_catalog_revision=base_catalog_revision,
            )
            pending_already_exists = _append_pending_if_needed(
                state=state,
                operation="activate",
                request_id=request_id,
                actor=actor,
                candidate=candidate,
            )
            _save_state(state)
            if pending_already_exists and _publisher_matches_payload(
                publisher,
                raw_payload=candidate["rawPayload"],
                sha256_hex=candidate["sha256Hex"],
            ):
                version = _finalize_activation(
                    state=state,
                    workflow_state=workflow_state,
                    candidate=candidate,
                    request_id=request_id,
                    actor=actor,
                    diagnostics=diagnostics,
                    publish_metadata={"reconciledFromPending": True},
                )
                SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
                return {
                    "ok": True,
                    "version": version,
                    "state": _state_with_retention(_load_state(SequenceWorkflow.get_sequence_editor_state())),
                    "idempotent": True,
                }

        try:
            publish_metadata = publisher.publish_sequence(
                raw_payload=candidate["rawPayload"],
                sha256_hex=candidate["sha256Hex"],
                request_metadata={"operation": "activate", "requestId": request_id, "actor": actor},
            )
        except RemoteConfigPublisher.RemoteConfigPublishConflict as exc:
            with _SEQUENCE_ACTIVATION_LOCK:
                latest = _load_state(SequenceWorkflow.get_sequence_editor_state())
                _record_pending_status(latest, request_id, status="remoteConflict", error=str(exc))
                _save_state(latest)
            SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
            raise SequenceActivationRemoteConflict("Remote Config template changed before publish; reload and retry.", workflow_state) from exc
        except (RemoteConfigPublisher.RemoteConfigPublishError, RemoteConfigPublisher.RemoteConfigPublishUnavailable) as exc:
            with _SEQUENCE_ACTIVATION_LOCK:
                latest = _load_state(SequenceWorkflow.get_sequence_editor_state())
                _record_pending_status(latest, request_id, status="publishFailed", error=str(exc))
                _save_state(latest)
            SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
            raise SequenceActivationPublishError("Remote Config publish failed; active sequence was not changed.", workflow_state) from exc

        with _SEQUENCE_ACTIVATION_LOCK:
            latest = _load_state(SequenceWorkflow.get_sequence_editor_state())
            version = _finalize_activation(
                state=latest,
                workflow_state=workflow_state,
                candidate=candidate,
                request_id=request_id,
                actor=actor,
                diagnostics=diagnostics,
                publish_metadata=publish_metadata,
            )
            refreshed_state = _state_with_retention(_load_state(SequenceWorkflow.get_sequence_editor_state()))
            SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
            return {
                "ok": True,
                "version": version,
                "state": refreshed_state,
                "idempotent": False,
            }


def _rollback_candidate(target: dict[str, Any], changelog_note: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    diagnostics: list[dict[str, Any]] = []
    note = changelog_note.strip()
    if not note:
        diagnostics.append(_diagnostic("changelogMissing", "A changelog note is required before rollback."))
    catalog_revision = target.get("catalogRevision")
    level_ids = list(target.get("levelIds") or [])
    if isinstance(catalog_revision, str):
        diagnostics.extend(_activation_catalog_diagnostics(level_ids, catalog_revision))
    else:
        diagnostics.append(_diagnostic("catalogRevisionInvalid", "Rollback target is missing a catalog revision."))
    package_diagnostics, _ = _package_diagnostics(level_ids, catalog_revision if isinstance(catalog_revision, str) else None)
    diagnostics.extend(package_diagnostics)
    raw_payload = target.get("rawPayload")
    sha256_hex = target.get("sha256Hex")
    if not isinstance(raw_payload, str) or not isinstance(sha256_hex, str) or _sha256_hex(raw_payload) != sha256_hex:
        diagnostics.append(_diagnostic("integrityMismatch", "Rollback target payload/hash integrity check failed."))
    elif len(raw_payload.encode("utf-8")) > SEQUENCE_PAYLOAD_MAX_BYTES:
        diagnostics.append(_diagnostic("payloadTooLarge", "Rollback target payload exceeds the configured byte budget."))
    return {
        "sequenceVersion": target["sequenceVersion"],
        "catalogRevision": target["catalogRevision"],
        "levelIds": list(target["levelIds"]),
        "rawPayload": target["rawPayload"],
        "sha256Hex": target["sha256Hex"],
        "changelogNote": note,
        "packageIds": list(target.get("packageIds") or []),
    }, diagnostics


def rollback_sequence(
    *,
    target_version: str,
    base_active_version: str,
    changelog_note: str,
    request_id: str,
    publisher: RemoteConfigPublisher.RemoteConfigPublisher,
    actor: str,
) -> dict[str, Any]:
    # Same guard-leak containment as activate_sequence_draft (ledger 054 #39).
    try:
        return _rollback_sequence_inner(
            target_version=target_version,
            base_active_version=base_active_version,
            changelog_note=changelog_note,
            request_id=request_id,
            publisher=publisher,
            actor=actor,
        )
    except BaseException:
        SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
        raise


def _rollback_sequence_inner(
    *,
    target_version: str,
    base_active_version: str,
    changelog_note: str,
    request_id: str,
    publisher: RemoteConfigPublisher.RemoteConfigPublisher,
    actor: str,
) -> dict[str, Any]:
    with _SEQUENCE_PUBLISH_LOCK:
        workflow_state = SequenceWorkflow.get_sequence_editor_state()
        with _SEQUENCE_ACTIVATION_LOCK:
            state = _load_state(workflow_state)
            target = _version_by_id(state, target_version)
            if target is None:
                raise SequenceActivationValidationError(
                    "Rollback target has blocking diagnostics.",
                    [_diagnostic("rollbackTargetMissing", f"Rollback target {target_version} does not exist.", version=target_version)],
                    workflow_state,
                )
            diagnostics: list[dict[str, Any]] = []
            if target.get("rollbackEligible") is not True:
                diagnostics.append(_diagnostic("rollbackTargetIneligible", f"Rollback target {target_version} is not rollback-eligible.", version=target_version))
            # Rolling back TO the active version is a no-op the server never
            # guarded (fresh-review P3 — ledger 054 #31): the UI filters its
            # candidate LIST but a stale selection still submitted it, minting
            # a pointless new version + audit event. Reject server-side.
            if target_version == state["activeVersion"]:
                diagnostics.append(_diagnostic("rollbackTargetActive", f"Rollback target {target_version} is already the active version.", version=target_version))
            candidate, candidate_diagnostics = _rollback_candidate(target, changelog_note)
            diagnostics.extend(candidate_diagnostics)
            existing_event = _matching_finalized_event(
                state,
                request_id=request_id,
                operation="rollback",
                target_version=candidate["sequenceVersion"],
            )
            if existing_event is not None:
                return _result_from_event(state, existing_event)
            if state["activeVersion"] != base_active_version:
                raise SequenceActivationConflict("Rollback request is based on an older active sequence. Reload before rolling back.", workflow_state)
            blocking = _blocking(diagnostics)
            if blocking:
                raise SequenceActivationValidationError("Rollback target has blocking diagnostics.", diagnostics, workflow_state)
            if publisher.status().get("configured") is not True:
                raise SequenceActivationPublishUnavailable("Remote Config publisher is not configured.", workflow_state)
            SequenceWorkflow.begin_live_sequence_mutation(
                operation="rollback",
                request_id=request_id,
                draft_revision=None,
                base_live_sequence_version=base_active_version,
                base_catalog_revision=workflow_state["catalog"]["catalogRevision"],
            )
            pending_already_exists = _append_pending_if_needed(
                state=state,
                operation="rollback",
                request_id=request_id,
                actor=actor,
                candidate=candidate,
            )
            _save_state(state)
            if pending_already_exists and _publisher_matches_payload(
                publisher,
                raw_payload=candidate["rawPayload"],
                sha256_hex=candidate["sha256Hex"],
            ):
                publish_metadata = {"reconciledFromPending": True}
                previous_active = state["activeVersion"]
                state["activeVersion"] = candidate["sequenceVersion"]
                state["auditEvents"].append(_audit_event(
                    operation="rollback",
                    request_id=request_id,
                    actor=actor,
                    from_version=previous_active,
                    to_version=candidate["sequenceVersion"],
                    changelog_note=candidate["changelogNote"],
                    diagnostics=diagnostics,
                    publish_metadata=publish_metadata,
                ))
                state["pendingAttempts"] = [attempt for attempt in state["pendingAttempts"] if attempt.get("requestId") != request_id]
                _save_state(state)
                S.update_catalog_retention_for_activation_versions(state["activeVersion"], state["versions"])
                _set_live_sequence_from_activation_and_clear(
                    request_id=request_id,
                    sequence_version=candidate["sequenceVersion"],
                    catalog_revision=candidate["catalogRevision"],
                    level_ids=list(candidate["levelIds"]),
                )
                return {
                    "ok": True,
                    "version": target,
                    "state": _state_with_retention(_load_state(SequenceWorkflow.get_sequence_editor_state())),
                    "idempotent": True,
                }

        try:
            publish_metadata = publisher.publish_sequence(
                raw_payload=candidate["rawPayload"],
                sha256_hex=candidate["sha256Hex"],
                request_metadata={"operation": "rollback", "requestId": request_id, "actor": actor},
            )
        except RemoteConfigPublisher.RemoteConfigPublishConflict as exc:
            with _SEQUENCE_ACTIVATION_LOCK:
                latest = _load_state(SequenceWorkflow.get_sequence_editor_state())
                _record_pending_status(latest, request_id, status="remoteConflict", error=str(exc))
                _save_state(latest)
            SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
            raise SequenceActivationRemoteConflict("Remote Config template changed before rollback; reload and retry.", workflow_state) from exc
        except (RemoteConfigPublisher.RemoteConfigPublishError, RemoteConfigPublisher.RemoteConfigPublishUnavailable) as exc:
            with _SEQUENCE_ACTIVATION_LOCK:
                latest = _load_state(SequenceWorkflow.get_sequence_editor_state())
                _record_pending_status(latest, request_id, status="publishFailed", error=str(exc))
                _save_state(latest)
            SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
            raise SequenceActivationPublishError("Remote Config rollback publish failed; active sequence was not changed.", workflow_state) from exc

        with _SEQUENCE_ACTIVATION_LOCK:
            latest = _load_state(SequenceWorkflow.get_sequence_editor_state())
            previous_active = latest["activeVersion"]
            latest["activeVersion"] = candidate["sequenceVersion"]
            latest["auditEvents"].append(_audit_event(
                operation="rollback",
                request_id=request_id,
                actor=actor,
                from_version=previous_active,
                to_version=candidate["sequenceVersion"],
                changelog_note=candidate["changelogNote"],
                diagnostics=diagnostics,
                publish_metadata=publish_metadata,
            ))
            latest["pendingAttempts"] = [attempt for attempt in latest["pendingAttempts"] if attempt.get("requestId") != request_id]
            _save_state(latest)
            S.update_catalog_retention_for_activation_versions(latest["activeVersion"], latest["versions"])
            _set_live_sequence_from_activation_and_clear(
                request_id=request_id,
                sequence_version=candidate["sequenceVersion"],
                catalog_revision=candidate["catalogRevision"],
                level_ids=list(candidate["levelIds"]),
            )
            target = _version_by_id(latest, candidate["sequenceVersion"])
            refreshed_state = _state_with_retention(_load_state(SequenceWorkflow.get_sequence_editor_state()))
            SequenceWorkflow.clear_live_sequence_mutation(request_id=request_id)
            return {
                "ok": True,
                "version": target,
                "state": refreshed_state,
                "idempotent": False,
            }
