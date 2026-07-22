"""Server-owned structured FTD prompt and inpaint intents (U7).

Callers submit structured intent fields; this module is the single prompt
composition authority. Free-text prompt inputs are rejected so no client
can smuggle its own composition past the server. The band and magenta
composers are exact v1 ports relocated here from the generation handlers
so prompt text has exactly one home.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

from .recipes import build_scene_prompt, get_entity_prompt

# Input keys that would carry client-composed prompt text; always rejected.
CLIENT_PROMPT_KEYS = ("prompt", "dogPrompt", "magentaPromptOverride")

_SCENE_INTENT_KEYS = frozenset({"view", "style", "scene"})
_DOG_INTENT_KEYS = frozenset({"style", "entity"})


class IntentError(ValueError):
    """A structured intent is malformed or carries client-composed text."""


def forbid_client_prompt_keys(inputs: Mapping[str, Any]) -> None:
    for key in CLIENT_PROMPT_KEYS:
        if key in inputs:
            raise IntentError(f"client-composed prompt input '{key}' is not accepted")


def _require_mapping(intent: Any, name: str, allowed: frozenset[str]) -> Mapping[str, Any]:
    if not isinstance(intent, Mapping):
        raise IntentError(f"{name} must be a mapping of structured fields")
    unknown = set(intent) - allowed
    if unknown:
        raise IntentError(f"{name} has unknown fields: {sorted(unknown)}")
    for key, value in intent.items():
        if not isinstance(value, str) or not value:
            raise IntentError(f"{name}.{key} must be a non-empty string")
    return intent


def resolve_scene_prompt(intent: Any) -> str:
    """Compose the scene-generation prompt from a structured scene intent."""

    fields = _require_mapping(intent, "sceneIntent", _SCENE_INTENT_KEYS)
    if "scene" not in fields:
        raise IntentError("sceneIntent.scene is required")
    return build_scene_prompt(
        view=str(fields.get("view", "isometric")),
        style=str(fields.get("style", "clean_old_cartoon")),
        content=str(fields["scene"]),
    )


def resolve_dog_prompt(intent: Any) -> str:
    """Compose the per-dog entity prompt from a structured dog intent."""

    fields = _require_mapping(intent, "dogIntent", _DOG_INTENT_KEYS)
    if "style" not in fields:
        raise IntentError("dogIntent.style is required")
    return get_entity_prompt(str(fields["style"]), str(fields.get("entity", "dog")))


def resolve_magenta_prompt(intent: Any) -> str:
    """Compose the magenta-marker inpaint prompt from a structured dog intent."""

    return magenta_prompt(resolve_dog_prompt(intent))


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


def derive_band_prompt(side: str, scene_meta: Mapping[str, Any]) -> str:
    """Exact v1 port of the scene-aware band prompt with the no-subject guard."""

    context_bits = [
        str(scene_meta.get(key)).strip()
        for key in ("setting", "scene", "scene_prompt")
        if scene_meta.get(key)
    ]
    context = ", ".join(context_bits)
    guard = "No animals, no characters, no dogs, no people, no text, no watermarks."
    if side == "bottom":
        body = (
            "Continue the scene seamlessly downward: more of the same foreground "
            "ground, less detail, same camera angle, scale, perspective, style and "
            "lighting. No new structures."
        )
    else:
        body = (
            "Continue the scene seamlessly upward: let any buildings, walls or "
            "fences at the top edge simply end, and fade into a simple open "
            "low-detail background (sky, grass, water or floor as appropriate). "
            "Calm, sparse, mostly empty."
        )
    prefix = f"Scene: {context}. " if context else ""
    return f"{prefix}{body} {guard}"
