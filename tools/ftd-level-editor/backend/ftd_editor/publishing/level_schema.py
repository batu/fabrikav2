"""Single source of truth for the public Find the Dog ``level.json`` shape."""

from __future__ import annotations

from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..schema_codegen import ts_type


class DogSpriteCleanup(BaseModel):
    model_config = ConfigDict(extra="ignore")

    x: int
    y: int
    width: int = Field(ge=1)
    height: int = Field(ge=1)


class DogSprite(BaseModel):
    model_config = ConfigDict(extra="ignore")

    image: str = Field(min_length=1)
    x: int
    y: int
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    cleanup: DogSpriteCleanup
    anchorX: float = Field(default=0.5, ge=0.0, le=1.0)
    anchorY: float = Field(default=0.5, ge=0.0, le=1.0)


class Dog(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^dog_\d{2,}$")
    x: int
    y: int
    r: int = Field(ge=1)
    sprite: DogSprite | None = None


class Section(BaseModel):
    model_config = ConfigDict(extra="ignore")

    xStart: int = Field(ge=0)
    xEnd: int

    @model_validator(mode="after")
    def end_after_start(self) -> Self:
        if self.xEnd <= self.xStart:
            raise ValueError("section xEnd must be greater than xStart")
        return self


class LevelExtension(BaseModel):
    model_config = ConfigDict(extra="ignore")

    targetAspect: float = Field(gt=0.0)
    bandsRef: str = Field(min_length=1)
    topBand: int = Field(ge=0)
    bottomBand: int = Field(ge=0)
    nativeWidth: int = Field(ge=1)
    nativeHeight: int = Field(ge=1)


class LevelFileV1(BaseModel):
    """Public-stage Find the Dog level contract."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    bwImage: str | None = Field(default=None, min_length=1)
    colorImage: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    dogs: list[Dog] = Field(min_length=1)
    sections: list[Section] = Field(default_factory=list)
    extension: LevelExtension | None = None


def _validate_sections(level: LevelFileV1) -> None:
    if not level.sections:
        return
    expected = 0
    for section in level.sections:
        if section.xStart != expected or section.xEnd > level.width:
            raise ValueError("sections must be contiguous and within level width")
        expected = section.xEnd
    if expected != level.width:
        raise ValueError("sections must cover the full level width")


def _validate_dog_geometry(level: LevelFileV1) -> None:
    for dog in level.dogs:
        if dog.x - dog.r < 0 or dog.x + dog.r > level.width:
            raise ValueError(f"{dog.id} hitbox is outside level width")
        if dog.y - dog.r < 0 or dog.y + dog.r > level.height:
            raise ValueError(f"{dog.id} hitbox is outside level height")
        if dog.sprite is None:
            continue
        cleanup = dog.sprite.cleanup
        if not (
            0 <= cleanup.x < cleanup.x + cleanup.width <= level.width
            and 0 <= cleanup.y < cleanup.y + cleanup.height <= level.height
        ):
            raise ValueError(f"{dog.id} cleanup geometry is outside the level")
        if not (
            cleanup.x <= dog.x <= cleanup.x + cleanup.width
            and cleanup.y <= dog.y <= cleanup.y + cleanup.height
        ):
            raise ValueError(f"{dog.id} cleanup geometry does not contain its center")


def validate_level_geometry(level: LevelFileV1, *, native: LevelFileV1 | None = None) -> None:
    """Validate baked runtime geometry and, when provided, the native transform."""

    _validate_sections(level)
    _validate_dog_geometry(level)
    if native is None:
        return
    _validate_sections(native)
    _validate_dog_geometry(native)
    extension = level.extension
    if extension is None or native.extension != extension:
        raise ValueError("native/baked extension metadata differs")
    if native.width != extension.nativeWidth or native.height != extension.nativeHeight:
        raise ValueError("native/baked native dimensions differ")
    if level.width != native.width:
        raise ValueError("native/baked width differs")
    if level.height != native.height + extension.topBand + extension.bottomBand:
        raise ValueError("native/baked height differs from extension bands")
    native_dogs = {dog.id: dog for dog in native.dogs}
    if set(native_dogs) != {dog.id for dog in level.dogs}:
        raise ValueError("native/baked dog identity differs")
    for baked_dog in level.dogs:
        native_dog = native_dogs.get(baked_dog.id)
        if native_dog is None:
            raise ValueError("native/baked dog identity differs")
        if baked_dog.x != native_dog.x or baked_dog.y != native_dog.y + extension.topBand:
            raise ValueError("native/baked dog coordinates differ")
        if baked_dog.r != native_dog.r:
            raise ValueError("native/baked hitbox radius differs")
        if (baked_dog.sprite is None) != (native_dog.sprite is None):
            raise ValueError("native/baked sprite presence differs")
        if baked_dog.sprite is not None and native_dog.sprite is not None:
            if (
                baked_dog.sprite.image != native_dog.sprite.image
                or baked_dog.sprite.width != native_dog.sprite.width
                or baked_dog.sprite.height != native_dog.sprite.height
                or baked_dog.sprite.anchorX != native_dog.sprite.anchorX
                or baked_dog.sprite.anchorY != native_dog.sprite.anchorY
                or baked_dog.sprite.cleanup.width != native_dog.sprite.cleanup.width
                or baked_dog.sprite.cleanup.height != native_dog.sprite.cleanup.height
                or baked_dog.sprite.x != native_dog.sprite.x
                or baked_dog.sprite.y != native_dog.sprite.y + extension.topBand
                or baked_dog.sprite.cleanup.x != native_dog.sprite.cleanup.x
                or baked_dog.sprite.cleanup.y
                != native_dog.sprite.cleanup.y + extension.topBand
            ):
                raise ValueError("native/baked sprite coordinates differ")


def generate_level_typescript() -> str:
    """Emit the runtime-facing TypeScript contract deterministically."""
    schema = public_schema()
    definitions = schema.pop("$defs", {})
    definitions["LevelFileV1"] = schema
    order = (
        "LevelFileV1",
        "Dog",
        "DogSprite",
        "DogSpriteCleanup",
        "Section",
        "LevelExtension",
    )
    lines = ["""/**
 * AUTOGENERATED — DO NOT EDIT BY HAND.
 * Source: tools/ftd-level-editor/backend/ftd_editor/publishing/level_schema.py
 * Regenerate/check: npm run editor:schema:write / editor:schema:check
 */"""]
    for name in order:
        model_schema = definitions[name]
        required = set(model_schema.get("required", ()))
        lines.append(f"export interface {name} {{")
        for property_name, property_schema in model_schema["properties"].items():
            optional = "" if property_name in required else "?"
            lines.append(
                f"  {property_name}{optional}: "
                f"{ts_type(property_schema, omit_null=True, array_style='suffix')};"
            )
        lines.append("}")
        lines.append("")
    return "\n".join(lines)


def public_schema() -> dict[str, Any]:
    return LevelFileV1.model_json_schema()
