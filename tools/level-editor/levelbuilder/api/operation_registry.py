"""Server-owned editor operation inventory shared by UI and CLI parity gates."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class OperationSpec:
    operation_id: str
    cli_verb: str
    method: str | None = None
    path: str | None = None
    ui_function: str | None = None
    human_only: bool = False


_LEGACY_VERBS = {
    "config": "config", "assemble-recipe-prompts": "create", "create-session": "create",
    "background-generation-job": "generate-bg", "select-background": "select-bg",
    "upscale-background-job": "upscale", "auto-hitboxes": "auto-hitboxes",
    "visibility-check": "visibility-check", "inpaint-job": "inpaint",
    "single-dog-regenerate": "regenerate", "dog-set-active-variant": "dogs", "dog-delete": "dogs",
    "sequence-state": "export", "sequence-draft": "export", "sequence-dry-run": "export",
    "sequence-start-job": "export", "session-archive": "archive", "sprite-gaps": "repair-sprites",
    "compare-inpaint": "compare", "bundle-starter": "export", "prompt-library": "prompts",
    "generation-status": "status", "golden-review-level": "bless-level",
}

PRIMARY_OPERATIONS = (
    OperationSpec("list-sessions", "sessions", "GET", "/api/sessions", "listSessions"),
    OperationSpec("get-session", "session", "GET", "/api/sessions/{session_id}", "getSession"),
    OperationSpec("artifact-integrity-audit", "integrity-audit", "GET", "/api/artifact-integrity-audit", "getArtifactIntegrityAudit"),
    OperationSpec("artifact-integrity-migration-preview", "integrity-migration-preview", "GET", "/api/artifact-integrity-migration", "getArtifactIntegrityMigration"),
    OperationSpec("artifact-integrity-migration-apply", "integrity-migration-apply", "POST", "/api/artifact-integrity-migration/apply", "applyArtifactIntegrityMigration"),
    OperationSpec("save-hitboxes", "set-hitboxes", "POST", "/api/sessions/{session_id}/hitboxes", "saveHitboxes"),
    OperationSpec("list-sprite-candidates", "sprite-candidates", "GET", "/api/sessions/{session_id}/sprite-candidates", "listSpriteCandidates"),
    OperationSpec("manual-sprite-placement", "place-sprite", "PUT", "/api/sessions/{session_id}/sprite-candidates/{candidate_id}/placement", "saveSpriteCandidatePlacement"),
    OperationSpec("auto-place-sprites", "auto-place-sprites", "POST", "/api/sessions/{session_id}/sprite-candidates/auto-placement", "autoPlaceSpriteCandidates"),
    OperationSpec("human-confirm-sprite", "confirm-sprite", "PUT", "/api/sessions/{session_id}/sprite-candidates/{candidate_id}/human-confirmation", "saveSpriteCandidateHumanConfirmation", True),
    OperationSpec("human-review-hitboxes", "bless-hitboxes", "PUT", "/api/sessions/{session_id}/hitbox-review", "setHitboxApproval", True),
    OperationSpec("human-review-final-cutouts", "bless-cutouts", "PUT", "/api/sessions/{session_id}/final-cutout-review", "setFinalCutoutApproval", True),
    OperationSpec("selected-cutout-extraction", "cutouts", "POST", "/api/sessions/{session_id}/dogs/retry-inpaint/jobs", "startRetryFailedDogsJob"),
    OperationSpec("selected-cutout-regeneration", "cutouts", "POST", "/api/sessions/{session_id}/dogs/retry-inpaint/jobs", "startRetryFailedDogsJob"),
    OperationSpec("retry-failed-dogs-job", "inpaint", "POST", "/api/sessions/{session_id}/dogs/retry-inpaint/jobs", "startRetryFailedDogsJob"),
    OperationSpec("list-jobs", "jobs", "GET", "/api/jobs", "listJobs"),
    OperationSpec("get-job", "job", "GET", "/api/jobs/{job_id}", "getJob"),
    OperationSpec("approve-catalog", "approve", "POST", "/api/sessions/{session_id}/approve-catalog", "publishLevelToCatalog"),
)

OPERATIONS = PRIMARY_OPERATIONS + tuple(
    OperationSpec(operation_id, cli_verb)
    for operation_id, cli_verb in _LEGACY_VERBS.items()
)


def operation_payload() -> list[dict]:
    return [{
        "operationId": value.pop("operation_id"),
        "cliVerb": value.pop("cli_verb"),
        "uiFunction": value.pop("ui_function"),
        "humanOnly": value.pop("human_only"),
        **value,
    } for item in OPERATIONS for value in [asdict(item)]]
