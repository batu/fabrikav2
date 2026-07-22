"""Side-effect-free current-session gallery facts and named metadata mutation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .model import AuthoringSession


@dataclass(frozen=True, slots=True)
class GallerySession:
    session_id: str
    revision: str
    dog_count: int
    tags: tuple[str, ...]
    archived: bool


CaptureVariant = Literal[
    "gemini",
    "openai",
    "openai_v2",
    "gemini_bg_only",
    "openai_bg_only",
    "openai_v2_bg_only",
]


def capture_source_candidates(
    session: AuthoringSession, variant: CaptureVariant
) -> tuple[str, ...]:
    """Choose current image bytes using the v1 gallery-preview precedence."""

    raw = session.to_mapping()
    selected_bg = raw.get("selected_bg")
    if not isinstance(selected_bg, int):
        selected_bg = 0
    selected = f"bg_{selected_bg:02d}.png"

    match variant:
        case "gemini":
            return ("color.png", "bg_00.png")
        case "openai":
            return ("openai_color.png", "openai_bg.png")
        case "openai_v2":
            return ("openai_color_v2.png", "openai_bg_v2.png")
        case "gemini_bg_only":
            return (selected, "bg_00.png")
        case "openai_bg_only":
            return ("openai_bg.png",)
        case "openai_v2_bg_only":
            return ("openai_bg_v2.png",)


def gallery_metadata(session: AuthoringSession) -> tuple[tuple[str, ...], bool]:
    mapping = session.to_mapping()
    raw_tags = mapping.get("tags")
    tags = (
        tuple(value for value in raw_tags if isinstance(value, str))
        if isinstance(raw_tags, list)
        else ()
    )
    return tags, mapping.get("archived") is True


def update_gallery_metadata(
    session: AuthoringSession,
    *,
    tags: list[str] | None,
    archived: bool | None,
) -> AuthoringSession:
    mapping: dict[str, Any] = session.to_mapping()
    changed = False
    if tags is not None:
        if any(not isinstance(tag, str) or not tag.strip() for tag in tags):
            raise ValueError("gallery tags must be non-empty strings")
        normalized_tags = list(dict.fromkeys(tag.strip() for tag in tags))
        if "tags" not in mapping or mapping["tags"] != normalized_tags:
            mapping["tags"] = normalized_tags
            changed = True
    if archived is not None:
        if "archived" not in mapping or mapping["archived"] is not archived:
            mapping["archived"] = archived
            changed = True
    return session.with_mapping(mapping) if changed else session
