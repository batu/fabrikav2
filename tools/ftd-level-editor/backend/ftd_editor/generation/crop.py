"""FTD dog-targeted paid actions: crop inpaint, dog regeneration, retry sweep.

Every accepted dog variant lands through `SessionStore.publish_dog_bundle`,
so a paid output and its complete per-dog bundle share the U2 exclusion
boundary: same-dog concurrency yields distinct complete bundles or one
explicit reservation outcome, never partial cross-writes. A stale session
revision keeps the paid artifact retained and the current session intact.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping

from ..jobs.worker import ApplicationConflict, JobContext, TerminalJobError
from ..sessions.dogs import DogBundlePayload, StableDogNotFound, require_stable_dog, set_active_variant
from ..sessions.store import ReservationRejected, SessionRevisionConflict
from .boundary import ValidatedOutput
from .cutout import crop_box, sprite_export
from .paid import (
    PaidRuntime,
    completed_items_from_prior_attempts,
    fetch_output,
    load_spec,
    policy_for,
    register_output_artifact,
    require_input,
    retain_if_cancelled,
    submit_and_obtain_output_url,
)

IMAGE_PROVIDER = "ftd.image"


def _variant_reference(artifact: Any, validated: ValidatedOutput) -> dict[str, Any]:
    return {
        "artifactId": artifact.artifact_id,
        "checksum": artifact.checksum,
        "mediaType": artifact.media_type,
        "width": validated.width,
        "height": validated.height,
    }


def publish_variant_bundle(
    context: JobContext,
    runtime: PaidRuntime,
    spec: Any,
    dog_id: str,
    validated: ValidatedOutput,
    hitbox: Mapping[str, Any],
) -> dict[str, Any]:
    """Register the paid artifact, then apply it as one complete dog bundle."""

    display_name = f"{dog_id}_variant.png"
    retain_if_cancelled(
        context, validated.payload, display_name=display_name, media_type=validated.media_type
    )
    artifact = register_output_artifact(
        context, validated.payload, display_name=display_name, media_type=validated.media_type
    )
    reference = _variant_reference(artifact, validated)
    retained = {"application": "retained", "dogId": dog_id, **reference}
    box = crop_box(hitbox, validated.width or 1, validated.height or 1)
    sprite_bytes, sprite_metadata = sprite_export(validated.payload, box)
    snapshot = runtime.sessions.load(spec.session_id)
    if snapshot.revision != spec.source_revision:
        raise ApplicationConflict(retained)

    def build(variant_index: int) -> DogBundlePayload:
        selected = set_active_variant(snapshot.session, dog_id, variant_index)
        return DogBundlePayload(
            variant_image=validated.payload,
            box={"left": box.left, "top": box.top, "right": box.right, "bottom": box.bottom},
            sprite_image=sprite_bytes,
            sprite_metadata=sprite_metadata,
            session_json=selected.to_mapping(),
            job_artifact=validated.payload,
            job_artifact_name=f"{context.job.id}-{dog_id}.png",
        )

    try:
        publication = runtime.sessions.publish_dog_bundle(
            spec.session_id,
            dog_id,
            build,
            expected_revision=spec.source_revision,
            wait_for_reservation=True,
        )
    except SessionRevisionConflict as conflict:
        raise ApplicationConflict(retained) from conflict
    except ReservationRejected as rejection:
        raise ApplicationConflict({**retained, "reservation": "rejected"}) from rejection
    return {
        "application": "applied",
        "dogId": dog_id,
        "variantIndex": publication.variant_index,
        "bundleId": publication.bundle_id,
        **reference,
    }


def _require_dog(runtime: PaidRuntime, spec: Any, dog_id: str) -> None:
    snapshot = runtime.sessions.load(spec.session_id)
    try:
        require_stable_dog(snapshot.session, dog_id)
    except StableDogNotFound as error:
        raise TerminalJobError("stable_dog_not_found", str(error)) from error


def _single_dog_handler(
    runtime: PaidRuntime, *, prompt_input: str
) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        dog_id = str(require_input(spec, "dogId"))
        hitbox = require_input(spec, "hitbox")
        if not isinstance(hitbox, Mapping):
            raise TerminalJobError("invalid_inputs", "hitbox must be a mapping")
        prompt = str(require_input(spec, prompt_input))
        _require_dog(runtime, spec, dog_id)
        policy = policy_for("image")
        url = submit_and_obtain_output_url(
            context,
            runtime,
            IMAGE_PROVIDER,
            policy,
            {**dict(spec.inputs), "prompt": prompt},
            spec.provider_options,
        )
        validated = fetch_output(context, url, policy)
        return publish_variant_bundle(context, runtime, spec, dog_id, validated, hitbox)

    return handler


def crop_inpaint_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    return _single_dog_handler(runtime, prompt_input="prompt")


def dog_regenerate_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    return _single_dog_handler(runtime, prompt_input="prompt")


def retry_failed_dogs_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        dogs = require_input(spec, "dogs")
        if not isinstance(dogs, list) or not dogs:
            raise TerminalJobError("invalid_inputs", "dogs must be a non-empty list")
        policy = policy_for("image")
        already_completed = completed_items_from_prior_attempts(
            context, "job.dog_completed", "dogId"
        )
        results: list[dict[str, Any]] = []
        for entry in dogs:
            if not isinstance(entry, Mapping):
                raise TerminalJobError("invalid_inputs", "each dog entry must be a mapping")
            dog_id = str(entry.get("dogId") or "")
            hitbox = entry.get("hitbox")
            prompt = str(entry.get("prompt") or "")
            if not dog_id or not isinstance(hitbox, Mapping) or not prompt:
                raise TerminalJobError(
                    "invalid_inputs", "each dog entry needs dogId, hitbox, and prompt"
                )
            prior = already_completed.get(dog_id)
            if prior is not None:
                # A prior attempt already paid for and published this dog:
                # reuse its checkpoint instead of ever re-submitting.
                results.append({**prior, "application": "reused_prior_attempt"})
                continue
            context.raise_if_cancel_requested()
            context.heartbeat()
            _require_dog(runtime, spec, dog_id)
            url = submit_and_obtain_output_url(
                context,
                runtime,
                IMAGE_PROVIDER,
                policy,
                {**dict(spec.inputs), "dogId": dog_id, "prompt": prompt},
                spec.provider_options,
            )
            validated = fetch_output(context, url, policy)
            outcome = publish_variant_bundle(context, runtime, spec, dog_id, validated, hitbox)
            results.append(outcome)
            context.store.append_event(
                context.job.id,
                "job.dog_completed",
                data={"dogId": dog_id, **outcome},
            )
        return {"application": "applied", "dogs": results}

    return handler
