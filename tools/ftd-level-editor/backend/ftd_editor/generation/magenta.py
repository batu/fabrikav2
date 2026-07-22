"""FTD magenta-overlay inpaint: pure prompt derivation plus the durable action.

The prompt builder is an exact port of v1 `_magenta_prompt` (inpaint.py:4413):
it strips the per-crop positional phrases from the wizard's entity prompt and
wraps the subject in the fixed magenta-marker task framing. The paid execution
itself moves off the v1 GET+SSE request path onto the U4 durable job.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from ..jobs.worker import JobContext
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

_POSITIONAL_PHRASES = (
    "at the center of the image",
    "occupying roughly the central third of the frame (not filling it).",
    "occupying roughly the central third of the frame",
    "Place exactly one",
    "do not repeat the subject.",
    "Keep all other elements of the image unchanged.",
)


def magenta_prompt(entity_prompt: str) -> str:
    """Exact v1 port: strip per-crop framing clauses, keep aesthetic clauses."""

    cleaned = entity_prompt.strip()
    for phrase in _POSITIONAL_PHRASES:
        cleaned = cleaned.replace(phrase, "")
    cleaned = re.sub(r"\s{2,}", " ", cleaned).replace(" ,", ",").replace(" .", ".").strip()
    return (
        "TASK: This image contains several opaque bright magenta (#FF00FF) "
        "circular regions painted on top of a scene. The magenta circles are "
        "LOCATION MARKERS ONLY — each one marks roughly where one instance "
        "of the subject should appear. Replace every magenta circle with exactly "
        "one instance of the subject described below, centered near that "
        "circle's position.\n\n"
        f"SUBJECT: {cleaned}\n\n"
        "SCALE: Do NOT fill the circle. Render the subject at whatever physical "
        "size is realistic for this scene — compare it to the other visible "
        "objects around that spot (doorways, people, furniture, crates, trees, "
        "etc.) and size the subject so it looks like it actually belongs there. "
        "If the subject is a small animal, it should look small relative to "
        "human-scale props in the scene, even when the magenta circle is large. "
        "If the magenta circle is larger than a realistic subject, leave the "
        "remainder of the circle area filled with what the surrounding scene "
        "would plausibly contain at that spot (ground, floor, background texture).\n\n"
        "STYLE: Match the surrounding scene's art style, palette, line weight, "
        "lighting, shadow direction, and level of detail exactly. The subject "
        "must look like it was always part of the illustration.\n\n"
        "HARD CONSTRAINTS: "
        "(1) Every magenta region must be fully replaced — no magenta pixels "
        "may remain. "
        "(2) Do not introduce any magenta, pink, or fuchsia tones elsewhere in "
        "the output. "
        "(3) Do not alter pixels far from the magenta regions — keep the "
        "rest of the scene pixel-identical. "
        "(4) Produce exactly one subject per circle; do not clone the subject "
        "into the surrounding scene."
    )


def magenta_inpaint_handler(runtime: PaidRuntime) -> Callable[[JobContext], dict[str, Any]]:
    def handler(context: JobContext) -> dict[str, Any]:
        spec = load_spec(context)
        entity_prompt = str(require_input(spec, "dogPrompt"))
        override = str(spec.inputs.get("magentaPromptOverride") or "")
        prompt = override if override else magenta_prompt(entity_prompt)
        policy = policy_for("image")
        url = submit_and_obtain_output_url(
            context,
            runtime,
            "ftd.image",
            policy,
            {**dict(spec.inputs), "prompt": prompt},
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
