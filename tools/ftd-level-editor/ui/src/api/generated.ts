// GENERATED FILE - do not edit by hand.
// Source of truth: tools/ftd-level-editor/openapi.json
// Regenerate: uv run python scripts/generate_contracts.py

export interface ApprovalGrantResponse {
  "actionKind": string;
  "actor": string;
  "expiresAt": string;
  "grantId": string;
  "requestBinding": string;
  "sourceRevision": string;
}

export interface ArtifactReferenceResponse {
  "artifactId": string;
  "checksum": string;
  "displayName": string;
  "mediaType": string;
  "size": number;
}

export interface AuthoringDog {
  "activeVariant"?: null | number | string;
  "id"?: null | string;
  "index": number | string;
  "promptOverride"?: null | string;
  "status"?: null | string;
}

export interface AuthoringSession {
  "dogs"?: Array<AuthoringDog>;
  "id": string;
}

export interface BootstrapResponse {
  "launchCredential": string;
}

export interface CandidateResponse {
  "actor": string;
  "candidateId": string;
  "catalogRevision": string;
  "changelog": string;
  "digest": string;
  "levelIds": Array<string>;
  "sequenceVersion": string;
  "sourceRevision": string;
}

export interface CaptureSessionImageRequest {
  "revision": string;
  "variant"?: "gemini" | "openai" | "openai_v2" | "gemini_bg_only" | "openai_bg_only" | "openai_v2_bg_only";
}

export interface CreateSessionRequest {
  "session": AuthoringSession;
}

export interface EditorStatus {
  "providerMode": string;
  "service": string;
  "stores": Array<string>;
  "workerMode": string;
}

export interface ExportDryRunRequest {
  "revision": string;
  "sessionId": string;
}

export interface ExportDryRunResponse {
  "dogCount": number;
  "levelId": string;
  "revision": string;
  "sessionId": string;
  "valid": boolean;
}

export interface ForceNewJobRequest {
  "actor": string;
  "grantId": string;
  "inputs"?: Record<string, unknown>;
  "providerOptions"?: Record<string, unknown>;
  "requestId": string;
  "revision": string;
  "sessionId": string;
}

export interface GallerySessionResponse {
  "archived": boolean;
  "dog_count": number;
  "revision": string;
  "session_id": string;
  "tags": Array<string>;
}

export interface HTTPValidationError {
  "detail"?: Array<ValidationError>;
}

export interface JobAttemptResponse {
  "previousAttemptId": null | string;
  "reason": "initial" | "retry" | "force_new";
  "supersededBy": null | string;
}

export interface JobErrorResponse {
  "code": string;
  "message": null | string;
}

export interface JobEventResponse {
  "createdAt": string;
  "data": Record<string, unknown>;
  "eventType": string;
  "id": number;
  "message": null | string;
}

export interface JobResource {
  "artifacts": Array<ArtifactReferenceResponse>;
  "attempt": JobAttemptResponse;
  "completedAt": null | string;
  "createdAt": string;
  "error": JobErrorResponse | null;
  "inputHash": string;
  "jobId": string;
  "kind": string;
  "requestId": null | string;
  "result": Record<string, unknown>;
  "retryable": boolean;
  "sessionId": string;
  "stage": string;
  "status": string;
  "updatedAt": string;
}

export interface MintApprovalRequest {
  "acknowledgement": string;
  "actionKind": string;
  "actor": string;
  "requestBinding": string;
  "sourceRevision": string;
}

export interface MintPublishingApprovalRequest {
  "acknowledgement": string;
  "action": "publish" | "rollback";
  "candidateId": string;
  "remote"?: boolean;
}

export interface PrepareSequenceRequest {
  "actor": string;
  "catalogRevision": string;
  "changelog": string;
  "levelIds": Array<string>;
  "sequenceVersion": string;
  "sourceRevision": string;
}

export interface ProtectedSequenceRequest {
  "candidateId": string;
  "grantId": string;
  "remote"?: boolean;
  "requestId": string;
}

export interface PublishingApprovalResponse {
  "actionKind": string;
  "actor": string;
  "expiresAt": string;
  "grantId": string;
  "requestBinding": string;
  "sourceRevision": string;
}

export interface PublishingErrorResponse {
  "detail": Array<Record<string, unknown>> | string;
}

export interface PublishingSnapshotResponse {
  "candidates": Array<CandidateResponse>;
  "remoteEnabled": boolean;
  "rollbackEligibleCandidateIds": Array<string>;
  "sagas": Array<SagaResponse>;
  "selected": CandidateResponse | null;
  "selectedRemoteRevision": null | string;
}

export interface RequestIdentityConflictDetail {
  "code": "request_identity_conflict";
  "existingInputHash": string;
  "existingJobId": string;
  "submittedInputHash": string;
}

export interface SagaResponse {
  "action": "publish" | "rollback";
  "actor": string;
  "baseRevision": string;
  "candidateId": string;
  "changelog": string;
  "digest": string;
  "error": null | string;
  "remote": boolean;
  "requestId": string;
  "sagaId": string;
  "sourceRevision": string;
  "status": "pending_remote" | "reconciling" | "remote_committed" | "finalizing" | "succeeded" | "failed";
}

export interface SessionImageNotFoundResponse {
  "detail": "session image not found";
}

export interface SessionProvenanceResponse {
  "file_count": number;
  "session_sha256": string;
  "source": string;
}

export interface SessionRevisionConflictDetail {
  "code": "session_revision_conflict";
  "current": SessionSnapshotResponse;
}

export interface SessionRevisionConflictResponse {
  "detail": SessionRevisionConflictDetail;
}

export interface SessionSnapshotResponse {
  "provenance": SessionProvenanceResponse;
  "revision": string;
  "session": Record<string, unknown>;
  "sessionId": string;
}

export interface SessionUnavailableResponse {
  "detail": string;
}

export interface SetDogActiveVariantRequest {
  "activeVariant": null | number;
  "revision": string;
}

export interface StartJobConflictResponse {
  "detail": RequestIdentityConflictDetail | SessionRevisionConflictDetail | string;
}

export interface StartJobRequest {
  "inputs"?: Record<string, unknown>;
  "providerOptions"?: Record<string, unknown>;
  "requestId": string;
  "revision": string;
  "sessionId": string;
}

export interface UpdateGalleryMetadataRequest {
  "archived"?: boolean | null;
  "revision": string;
  "tags"?: Array<string> | null;
}

export interface ValidationError {
  "ctx"?: Record<string, unknown>;
  "input"?: unknown;
  "loc": Array<number | string>;
  "msg": string;
  "type": string;
}

export interface CaptureCurrentSessionImageResponseHeaders {
  "X-FTD-Image-SHA256": string;
  "X-FTD-Image-Source": string;
  "X-FTD-Session-Id": string;
  "X-FTD-Session-Revision": string;
}

export type CaptureCurrentSessionImageResponseMediaType = "image/png";

export interface CaptureCurrentSessionImageBinaryResponse {
  "body": Blob;
  "headers": CaptureCurrentSessionImageResponseHeaders;
  "mediaType": CaptureCurrentSessionImageResponseMediaType;
}

export interface FtdEditorOperations {
  "mintApprovalGrant": { method: "post"; path: "/api/approvals" };
  "listDurableJobs": { method: "get"; path: "/api/jobs" };
  "startFtdDurableAction": { method: "post"; path: "/api/jobs/actions/{kind}" };
  "getDurableJob": { method: "get"; path: "/api/jobs/{job_id}" };
  "downloadDurableJobArtifact": { method: "get"; path: "/api/jobs/{job_id}/artifacts/{artifact_id}" };
  "cancelDurableJob": { method: "post"; path: "/api/jobs/{job_id}/cancel" };
  "listDurableJobEvents": { method: "get"; path: "/api/jobs/{job_id}/events" };
  "forceNewDurableJob": { method: "post"; path: "/api/jobs/{job_id}/force-new/{kind}" };
  "retryDurableJob": { method: "post"; path: "/api/jobs/{job_id}/retry" };
  "getPublishingSnapshot": { method: "get"; path: "/api/publishing" };
  "activateSequencePublication": { method: "post"; path: "/api/publishing/activate" };
  "mintPublishingApprovalGrant": { method: "post"; path: "/api/publishing/approval-grants" };
  "dryRunCurrentSessionExport": { method: "post"; path: "/api/publishing/export-dry-run" };
  "prepareSequencePublication": { method: "post"; path: "/api/publishing/previews" };
  "rollbackSequencePublication": { method: "post"; path: "/api/publishing/rollback" };
  "reconcileSequencePublication": { method: "post"; path: "/api/publishing/sagas/{saga_id}/reconcile" };
  "listCurrentSessions": { method: "get"; path: "/api/sessions" };
  "createCurrentSession": { method: "post"; path: "/api/sessions" };
  "getCurrentSession": { method: "get"; path: "/api/sessions/{session_id}" };
  "captureCurrentSessionImage": { method: "post"; path: "/api/sessions/{session_id}/capture"; response: CaptureCurrentSessionImageBinaryResponse };
  "setCurrentSessionDogActiveVariant": { method: "post"; path: "/api/sessions/{session_id}/dogs/{dog_id}/active-variant" };
  "updateCurrentSessionGalleryMetadata": { method: "post"; path: "/api/sessions/{session_id}/gallery-metadata" };
  "getEditorStatus": { method: "get"; path: "/api/status" };
  "getEditorBootstrap": { method: "get"; path: "/bootstrap" };
}
