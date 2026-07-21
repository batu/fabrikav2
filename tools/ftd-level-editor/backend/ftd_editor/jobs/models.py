"""Canonical durable-job identity and status models for the FTD editor."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

JobStatus = Literal[
    "queued",
    "running",
    "submitted",
    "polling",
    "downloading",
    "finalizing",
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "orphaned_unknown",
    "cancel_requested",
    "cancelled",
]

TERMINAL_STATUSES: frozenset[str] = frozenset(
    {"succeeded", "failed_terminal", "failed_retryable", "orphaned_unknown", "cancelled"}
)

ACTIVE_STATUSES: frozenset[str] = frozenset(
    {"queued", "running", "submitted", "polling", "downloading", "finalizing", "cancel_requested"}
)

VALID_STATUSES: frozenset[str] = TERMINAL_STATUSES | ACTIVE_STATUSES


def is_terminal_status(status: str) -> bool:
    return status in TERMINAL_STATUSES


EXECUTION_SPEC_VERSION = 1


def _frozen_json(value: Any, label: str) -> Any:
    try:
        encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ValueError(f"execution spec {label} must be canonical JSON data") from error
    return json.loads(encoded)


@dataclass(frozen=True, slots=True)
class ExecutionSpec:
    """The immutable, versioned inputs one worker attempt actually consumes.

    Every field participates in the Input Hash; adding a consumed field
    without hashing it is a contract violation covered by tests.
    """

    kind: str
    session_id: str
    source_revision: str
    inputs: Mapping[str, Any]
    recipe_version: str
    policy_version: str
    provider_options: Mapping[str, Any] = field(default_factory=dict)
    source_hashes: Mapping[str, str] = field(default_factory=dict)
    target_reservation: str | None = None
    spec_version: int = EXECUTION_SPEC_VERSION

    def to_mapping(self) -> dict[str, Any]:
        return {
            "specVersion": self.spec_version,
            "kind": self.kind,
            "sessionId": self.session_id,
            "sourceRevision": self.source_revision,
            "inputs": _frozen_json(dict(self.inputs), "inputs"),
            "recipeVersion": self.recipe_version,
            "policyVersion": self.policy_version,
            "providerOptions": _frozen_json(dict(self.provider_options), "providerOptions"),
            "sourceHashes": dict(self.source_hashes),
            "targetReservation": self.target_reservation,
        }

    def to_bytes(self) -> bytes:
        return json.dumps(
            self.to_mapping(), sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")

    def input_hash(self) -> str:
        return f"sha256:{hashlib.sha256(self.to_bytes()).hexdigest()}"

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ExecutionSpec":
        return cls(
            kind=str(value["kind"]),
            session_id=str(value["sessionId"]),
            source_revision=str(value["sourceRevision"]),
            inputs=dict(value.get("inputs") or {}),
            recipe_version=str(value["recipeVersion"]),
            policy_version=str(value["policyVersion"]),
            provider_options=dict(value.get("providerOptions") or {}),
            source_hashes=dict(value.get("sourceHashes") or {}),
            target_reservation=value.get("targetReservation"),
            spec_version=int(value.get("specVersion", EXECUTION_SPEC_VERSION)),
        )


@dataclass(frozen=True, slots=True)
class JobRecord:
    id: str
    kind: str
    session_id: str
    request_id: str | None
    input_hash: str
    execution_spec: dict[str, Any]
    status: JobStatus
    stage: str
    retryable: bool
    error_code: str | None
    error_message: str | None
    result: dict[str, Any]
    metadata: dict[str, Any]
    previous_attempt_id: str | None
    attempt_reason: Literal["initial", "retry", "force_new"] | str
    superseded_by: str | None
    worker_owner: str | None
    heartbeat_at: str | None
    created_at: str
    updated_at: str
    completed_at: str | None


@dataclass(frozen=True, slots=True)
class JobEvent:
    id: int
    job_id: str
    event_type: str
    message: str | None
    data: dict[str, Any]
    created_at: str


@dataclass(frozen=True, slots=True)
class ArtifactRecord:
    artifact_id: str
    job_id: str
    display_name: str
    media_type: str
    checksum: str
    size: int
    relative_path: str
    created_at: str
