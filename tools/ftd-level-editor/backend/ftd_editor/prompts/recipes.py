"""Pure prompt catalog and recipe composition ported from the v1 editor."""

from __future__ import annotations

import hashlib
import json
from importlib.resources import files
from typing import Any


def _load_catalog() -> dict[str, Any]:
    resource = files(__package__).joinpath("catalog.json")
    return json.loads(resource.read_text(encoding="utf-8"))


_CATALOG = _load_catalog()
MODEL: str = _CATALOG["MODEL"]
STYLE: str = _CATALOG["STYLE"]
VIEWS: dict[str, str] = _CATALOG["VIEWS"]
STYLES: dict[str, str] = _CATALOG["STYLES"]
SETTINGS: dict[str, dict[str, Any]] = _CATALOG["SETTINGS"]
ENTITIES: dict[str, str] = _CATALOG["ENTITIES"]
ENTITY_PROMPT_TEMPLATE: str = _CATALOG["ENTITY_PROMPT_TEMPLATE"]
_OLD_PIXEL_ART_ENTITY_PROMPT_TEMPLATE: str = _CATALOG[
    "_OLD_PIXEL_ART_ENTITY_PROMPT_TEMPLATE"
]
VARIATION_SYSTEM_PROMPT: str = _CATALOG["VARIATION_SYSTEM_PROMPT"]
LANDSCAPE_PANORAMIC_PREFIX: str = _CATALOG["LANDSCAPE_PANORAMIC_PREFIX"]

CONTENTS = {
    scene_key: scene_prompt
    for setting in SETTINGS.values()
    for scene_key, scene_prompt in setting["scenes"].items()
}
SCENE_TITLES = {
    scene_key: scene_key.removeprefix(f"{setting_key}_").replace("_", " ").title()
    for setting_key, setting in SETTINGS.items()
    for scene_key in setting["scenes"]
}


def _scene_title(scene_key: str) -> str:
    return SCENE_TITLES.get(scene_key, scene_key.replace("_", " ").title())


def _short_scene_description(scene_key: str, scene_prompt: str) -> str:
    first_sentence = scene_prompt.split(". ", 1)[0].strip()
    subject = first_sentence.split(" — ", 1)[0].strip()
    if not subject:
        subject = _scene_title(scene_key)
    if subject.endswith("."):
        subject = subject[:-1]
    return f"{subject} arranged as an organic isometric hidden-object scene."


SCENE_DESCRIPTIONS = {
    scene_key: _short_scene_description(scene_key, scene_prompt)
    for scene_key, scene_prompt in CONTENTS.items()
}


def get_entity_prompt(style: str = "clean_old_cartoon", entity: str = "dog") -> str:
    noun = ENTITIES.get(entity, entity)
    if style == "old_pixel_art":
        return _OLD_PIXEL_ART_ENTITY_PROMPT_TEMPLATE.format(entity=noun)
    return ENTITY_PROMPT_TEMPLATE.format(entity=noun)


DOG_PROMPTS = {slug: get_entity_prompt(slug, "dog") for slug in STYLES}


def build_scene_prompt(
    view: str = "isometric",
    style: str = "clean_old_cartoon",
    content: str = "istanbul_market",
) -> str:
    view_prompt = VIEWS.get(view, view)
    style_prompt = STYLES.get(style, style)
    scene_prompt = CONTENTS.get(content, content)
    title = _scene_title(content)
    short_description = _short_scene_description(content, scene_prompt)
    return "\n\n".join(
        [
            f"[Purpose]\nCreate a full-bleed portrait mobile-game background for Find the Dog. Title: {title}.",
            f"[Short Description]\n{short_description}",
            f"[Scene]\n{scene_prompt}",
            f"[View]\n{view_prompt}",
            f"[Style]\n{style_prompt}",
            (
                "[Gameplay Composition]\n"
                "Design this as a production hidden-object background where dogs will be added later. "
                "Create many plausible hiding pockets on walkable/contact surfaces or open gaps beside "
                "props, plants, rocks, furniture, railings, crates, planters, benches, roots, tools, "
                "shelves, stalls, boats, carts, market goods, or other readable foreground objects. "
                "Near props is ideal; inside solid objects, on blank walls, on roofs, floating over "
                "water, or on decorative vertical faces is not useful. Use theme-specific spatial logic "
                "such as rings, islands, terraces, nested rooms, clearings, bridges, piers, shelves, "
                "courtyards, side alleys, garden pockets, or clustered market zones. Keep open pockets "
                "between prop clusters so hitboxes can sit near objects without excessive overlap."
            ),
            (
                "[Constraints]\n"
                "No people, no live animals, no birds, no insects, no mascots, no dogs, no readable "
                "text, no logos, no watermarks. Market food and fishing props are allowed when the scene calls for them. Avoid huge blank walls, roof-dominated compositions, "
                "empty lawns, empty sand, empty floors, long straight roads, and noisy micro-texture "
                "camouflage. Every visible ground, floor, or water-edge region should read as a clear "
                "material appropriate to the scene; no untextured blank areas."
            ),
        ]
    )


def get_dog_prompt(style: str = "clean_old_cartoon") -> str:
    return get_entity_prompt(style, "dog")


def prompt_catalog_snapshot() -> dict[str, Any]:
    canonical = json.dumps(_CATALOG, sort_keys=True, separators=(",", ":"))
    return {
        "catalogSha256": hashlib.sha256(canonical.encode()).hexdigest(),
        "model": MODEL,
        "views": sorted(VIEWS),
        "styles": sorted(STYLES),
        "settings": sorted(SETTINGS),
        "scenes": sorted(CONTENTS),
        "entities": sorted(ENTITIES),
    }
