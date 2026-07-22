"""FTD sprite animation: submit-and-poll on the Layer surface, ledger-free.

Replaces the v1 per-session sprite JSON mini-ledger entirely: job state lives in the
durable ledger, the provider identity is the U4 `providerJobId` checkpoint,
progress is Job events, and the preview binary is an opaque registered
artifact. The v1 request handler blocked a POST for up to the full 360s
poll deadline; here the worker owns the poll and any observer may leave.
"""

from __future__ import annotations

from typing import Any, Callable

from ..jobs.worker import JobContext
from .boundary import ValidatedOutput
from .paid import (
    PaidRuntime,
    fetch_output,
    load_spec,
    policy_for,
    poll_until_output,
    register_output_artifact,
    require_input,
    retain_if_cancelled,
    submit_and_obtain_output_url,
)

LAYER_PROVIDER = "ftd.layer"

SPRITE_ANIMATION_MODEL = "layer/sprite-animation"


def _finish(context: JobContext, validated: ValidatedOutput, spec: Any) -> dict[str, Any]:
    extension = {
        "image/gif": "gif",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/webm": "webm",
        "image/png": "png",
    }.get(validated.media_type, "bin")
    display_name = f"sprite_animation.{extension}"
    retain_if_cancelled(
        context, validated.payload, display_name=display_name, media_type=validated.media_type
    )
    artifact = register_output_artifact(
        context, validated.payload, display_name=display_name, media_type=validated.media_type
    )
    context.store.append_event(
        context.job.id,
        "job.animation_completed",
        data={
            "artifactId": artifact.artifact_id,
            "motionPreset": spec.inputs.get("motionPreset"),
            "model": SPRITE_ANIMATION_MODEL,
        },
    )
    return {
        "application": "artifact",
        "artifactId": artifact.artifact_id,
        "checksum": artifact.checksum,
        "mediaType": artifact.media_type,
        "model": SPRITE_ANIMATION_MODEL,
    }


def sprite_animate_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        require_input(spec, "dogId")
        require_input(spec, "sourceCandidateId")
        policy = policy_for("layer")
        url = submit_and_obtain_output_url(
            context,
            runtime,
            LAYER_PROVIDER,
            policy,
            {**dict(spec.inputs), "model": SPRITE_ANIMATION_MODEL},
            spec.provider_options,
        )
        validated = fetch_output(context, url, policy)
        return _finish(context, validated, spec)

    return handler


def sprite_animate_resume_handler(
    runtime: PaidRuntime,
) -> Callable[[JobContext, str], dict[str, Any]]:
    def resume(context: JobContext, provider_job_id: str) -> dict[str, Any]:
        spec = load_spec(context)
        policy = policy_for("layer")
        url = poll_until_output(context, runtime, LAYER_PROVIDER, policy, provider_job_id)
        validated = fetch_output(context, url, policy)
        return _finish(context, validated, spec)

    return resume
