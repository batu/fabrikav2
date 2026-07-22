"""FTD magenta-overlay inpaint durable action.

Prompt composition is server-owned by `ftd_editor.prompts.intents` (U7):
the caller submits a structured dog intent and the server derives the
magenta-marker inpaint prompt. The paid execution itself moved off the v1
GET+SSE request path onto the U4 durable job.
"""

from __future__ import annotations

from typing import Any, Callable

from ..jobs.worker import JobContext
from ..prompts.intents import resolve_magenta_prompt
from .paid import (
    PaidRuntime,
    apply_session_mutation,
    fetch_output,
    load_spec,
    policy_for,
    register_output_artifact,
    require_input,
    resolve_prompt_intent,
    retain_if_cancelled,
    submit_and_obtain_output_url,
)

def magenta_inpaint_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        prompt = resolve_prompt_intent(
            spec.inputs,
            lambda: resolve_magenta_prompt(require_input(spec, "dogIntent")),
        )
        policy = policy_for("image")
        url = submit_and_obtain_output_url(
            context,
            runtime,
            "ftd.image",
            policy,
            {"hitboxes": spec.inputs.get("hitboxes", []), "prompt": prompt},
            spec.provider_options,
        )
        validated = fetch_output(context, url, policy)
        retain_if_cancelled(
            context, validated.payload, display_name="magenta_inpaint.png", media_type=validated.media_type
        )
        artifact = register_output_artifact(
            context, validated.payload, display_name="magenta_inpaint.png", media_type=validated.media_type
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
            mapping["magentaComposite"] = reference
            return session.with_mapping(mapping)

        revision = apply_session_mutation(runtime, spec, mutation, retained_result=retained)
        return {"application": "applied", "sessionRevision": revision, **reference}

    return handler
