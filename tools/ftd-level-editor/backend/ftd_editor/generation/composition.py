"""FTD scene-composition paid actions and pure band-extension math.

Pure leaves port the v1 band arithmetic exactly (`band_generation.py`:
`compute_band_heights`, `_strip_px`, TARGET_ASPECT). Prompt text is
composed only by `ftd_editor.prompts` from structured intents (U7). The
PIL canvas/mask assembly of v1 is provider-side input preparation and
is deferred with the imaging dependencies; the durable handlers pass the
band geometry and prompt to the scripted provider adapter instead.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Mapping

from ..jobs.worker import JobContext, TerminalJobError
from ..prompts.intents import (
    IntentError,
    derive_band_prompt,
    forbid_client_prompt_keys,
    resolve_scene_prompt,
)
from .paid import (
    PaidRuntime,
    apply_session_mutation,
    completed_items_from_prior_attempts,
    fetch_output,
    load_spec,
    policy_for,
    register_output_artifact,
    require_input,
    retain_if_cancelled,
    submit_and_obtain_output_url,
)

# The one production target: height:width for the skinniest iPhone (v1 #338).
TARGET_ASPECT = 2.1875
BAND_MODEL = "fal-ai/flux-pro/v1/fill"

IMAGE_PROVIDER = "ftd.image"


def compute_band_heights(
    native_width: int, native_height: int, target_aspect: float = TARGET_ASPECT
) -> tuple[int, int]:
    """Exact v1 port: (top, bottom) band heights growing a scene to target aspect."""

    baked_height = round(native_width * target_aspect)
    added = baked_height - native_height
    if added <= 0:
        return (0, 0)
    top = math.ceil(added / 2)
    return (top, added - top)


def strip_px(band_height: int) -> int:
    """Exact v1 port: edge-context strip thickness for a seamless band join."""

    return max(64, band_height // 8)


def _artifact_reference(artifact: Any, validated: Any) -> dict[str, Any]:
    return {
        "artifactId": artifact.artifact_id,
        "checksum": artifact.checksum,
        "mediaType": artifact.media_type,
        "width": validated.width,
        "height": validated.height,
    }


def _run_single_scene_action(
    context: JobContext,
    runtime: PaidRuntime,
    *,
    display_name: str,
    prompt: str,
    extra_inputs: Mapping[str, Any],
    apply_key: Callable[[dict[str, Any], dict[str, Any]], None],
) -> dict[str, Any]:
    spec = load_spec(context)
    policy = policy_for("image")
    url = submit_and_obtain_output_url(
        context,
        runtime,
        IMAGE_PROVIDER,
        policy,
        {**dict(spec.inputs), **dict(extra_inputs), "prompt": prompt},
        spec.provider_options,
    )
    validated = fetch_output(context, url, policy)
    retain_if_cancelled(
        context, validated.payload, display_name=display_name, media_type=validated.media_type
    )
    artifact = register_output_artifact(
        context, validated.payload, display_name=display_name, media_type=validated.media_type
    )
    reference = _artifact_reference(artifact, validated)
    retained = {"application": "retained", **reference}

    def mutation(session: Any) -> Any:
        mapping = session.to_mapping()
        apply_key(mapping, reference)
        return session.with_mapping(mapping)

    revision = apply_session_mutation(runtime, spec, mutation, retained_result=retained)
    return {"application": "applied", "sessionRevision": revision, **reference}


def background_generate_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        try:
            forbid_client_prompt_keys(spec.inputs)
            prompt = resolve_scene_prompt(require_input(spec, "sceneIntent"))
        except IntentError as error:
            raise TerminalJobError("invalid_inputs", str(error)) from error

        def apply(mapping: dict[str, Any], reference: dict[str, Any]) -> None:
            mapping["background"] = reference

        return _run_single_scene_action(
            context,
            runtime,
            display_name="background.png",
            prompt=prompt,
            extra_inputs={},
            apply_key=apply,
        )

    return handler


def band_generate_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        try:
            forbid_client_prompt_keys(spec.inputs)
        except IntentError as error:
            raise TerminalJobError("invalid_inputs", str(error)) from error
        side = str(require_input(spec, "side"))
        if side not in ("top", "bottom"):
            raise TerminalJobError("invalid_inputs", "band side must be 'top' or 'bottom'")
        native_width = int(require_input(spec, "nativeWidth"))
        native_height = int(require_input(spec, "nativeHeight"))
        if native_width <= 0 or native_height <= 0:
            raise TerminalJobError("invalid_inputs", "native dimensions must be positive")
        top, bottom = compute_band_heights(native_width, native_height)
        band_height = top if side == "top" else bottom
        if band_height == 0:
            # Deterministic no-spend branch: the scene already meets the aspect.
            return {"application": "none", "reason": "target aspect already met"}
        scene_meta = spec.inputs.get("sceneMeta") or {}
        prompt = derive_band_prompt(side, scene_meta)

        def apply(mapping: dict[str, Any], reference: dict[str, Any]) -> None:
            bands = mapping.setdefault("bands", {})
            bands[side] = {**reference, "bandHeight": band_height, "stripPx": strip_px(band_height)}

        return _run_single_scene_action(
            context,
            runtime,
            display_name=f"band_{side}.png",
            prompt=prompt,
            extra_inputs={
                "side": side,
                "bandHeight": band_height,
                "stripPx": strip_px(band_height),
                "model": BAND_MODEL,
            },
            apply_key=apply,
        )

    return handler


def _multi_scene_handler(
    runtime: PaidRuntime, *, session_key: str
) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        scenes = require_input(spec, "scenes")
        if not isinstance(scenes, list) or not all(isinstance(s, str) and s for s in scenes):
            raise TerminalJobError("invalid_inputs", "scenes must be a non-empty string list")
        policy = policy_for("image")
        already_completed = completed_items_from_prior_attempts(
            context, "job.scene_completed", "scene"
        )
        references: dict[str, dict[str, Any]] = {}
        first_submission = True
        for scene_key in scenes:
            prior = already_completed.get(scene_key)
            if prior is not None:
                # A prior attempt already paid for and registered this scene:
                # reuse its checkpointed reference instead of ever re-submitting.
                references[scene_key] = {
                    field: prior.get(field)
                    for field in ("artifactId", "checksum", "mediaType", "width", "height")
                }
                continue
            if not first_submission:
                context.raise_if_cancel_requested()
                context.heartbeat()
            first_submission = False
            url = submit_and_obtain_output_url(
                context,
                runtime,
                IMAGE_PROVIDER,
                policy,
                {**dict(spec.inputs), "scene": scene_key},
                spec.provider_options,
            )
            validated = fetch_output(context, url, policy)
            display_name = f"{scene_key}.png"
            retain_if_cancelled(
                context,
                validated.payload,
                display_name=display_name,
                media_type=validated.media_type,
            )
            artifact = register_output_artifact(
                context,
                validated.payload,
                display_name=display_name,
                media_type=validated.media_type,
            )
            references[scene_key] = _artifact_reference(artifact, validated)
            context.store.append_event(
                context.job.id,
                "job.scene_completed",
                data={"scene": scene_key, **references[scene_key]},
            )
        retained = {"application": "retained", "scenes": references}

        def mutation(session: Any) -> Any:
            mapping = session.to_mapping()
            target = mapping.setdefault(session_key, {})
            target.update(references)
            return session.with_mapping(mapping)

        revision = apply_session_mutation(runtime, spec, mutation, retained_result=retained)
        return {"application": "applied", "sessionRevision": revision, "scenes": references}

    return handler


def sequence_workflow_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    return _multi_scene_handler(runtime, session_key="sequenceScenes")


def multi_scene_generate_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    return _multi_scene_handler(runtime, session_key="multiScenes")
