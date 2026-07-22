"""FTD upscale action: every v1 upscale caller lands on this one durable kind.

`ftd.dog_variant_upscale` serves both v1 call sites — the per-dog variant
upscale and the background upscale (`_upscale_background_sync`) — selected
by the FTD-named `target` input. The fal model ids stay the v1 registry
values (`fal-ai/esrgan`, `fal-ai/aura-sr` in `models/options.py`).
"""

from __future__ import annotations

from typing import Any, Callable, Mapping

from ..jobs.worker import JobContext, TerminalJobError
from .crop import publish_variant_bundle
from .paid import (
    PaidRuntime,
    apply_session_mutation,
    fetch_output,
    load_spec,
    policy_for,
    register_output_artifact,
    require_input,
    retain_if_cancelled,
    submit_and_obtain_output_url,
)

IMAGE_PROVIDER = "ftd.image"

UPSCALE_TARGETS = ("dog_variant", "background")


def upscale_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        target = str(require_input(spec, "target"))
        if target not in UPSCALE_TARGETS:
            raise TerminalJobError(
                "invalid_inputs", f"upscale target must be one of {UPSCALE_TARGETS}"
            )
        policy = policy_for("image")
        url = submit_and_obtain_output_url(
            context,
            runtime,
            IMAGE_PROVIDER,
            policy,
            dict(spec.inputs),
            spec.provider_options,
        )
        validated = fetch_output(context, url, policy)
        if target == "dog_variant":
            dog_id = str(require_input(spec, "dogId"))
            hitbox = require_input(spec, "hitbox")
            if not isinstance(hitbox, Mapping):
                raise TerminalJobError("invalid_inputs", "hitbox must be a mapping")
            return publish_variant_bundle(context, runtime, spec, dog_id, validated, hitbox)
        display_name = "background_upscaled.png"
        retain_if_cancelled(
            context, validated.payload, display_name=display_name, media_type=validated.media_type
        )
        artifact = register_output_artifact(
            context, validated.payload, display_name=display_name, media_type=validated.media_type
        )
        reference = {
            "artifactId": artifact.artifact_id,
            "checksum": artifact.checksum,
            "mediaType": artifact.media_type,
            "width": validated.width,
            "height": validated.height,
        }
        retained = {"application": "retained", **reference}

        def mutation(session: Any) -> Any:
            mapping = session.to_mapping()
            mapping["backgroundUpscale"] = reference
            return session.with_mapping(mapping)

        revision = apply_session_mutation(runtime, spec, mutation, retained_result=retained)
        return {"application": "applied", "sessionRevision": revision, **reference}

    return handler
