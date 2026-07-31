"""Source-of-truth schema for the find_the_dog **public** `level.json`.

This pydantic v2 model is the single definition of the on-disk (public-stage)
`level.json` shape. It has two consumers:

1. **Python validation** — `export_to_game` validates the assembled level dict
   against `LevelFileV1` before the atomic write, so a malformed level never
   lands on disk (let alone ships to a player's device).
2. **TypeScript codegen** — `tools/gen-level-types.mjs` emits
   `LevelFileV1.model_json_schema()` and runs `json-schema-to-typescript` to
   produce `src/data/generated/levelFile.ts`, the type the runtime consumes.
   A CI freshness gate keeps the generated TS in sync with this model.

Scope (see docs/plans/2026-06-01-002-feat-ftd-level-schema-codegen-plan.md):
the **public** stage only. The session-dir stage is a superset; the dist stage
is a pruned projection (`bwImage` removed, `colorImage` → packaged `.webp`).
Neither is modeled here. Normalization (`radius`→`r`, sprite path prefix,
anchor defaults) already happens upstream in `build_level_dict` /
`_level_sprite_metadata`, so this model **validates post-normalization data** —
it does not re-implement normalization.

`extra="ignore"`: `level.json` accretes authoring metadata over time (e.g. the
legacy `tags` key has no current writer). Forbidding extras would reject valid
levels; the CI git-diff gate is what keeps the generated TS contract tight.

**Untyped downstream consumers** that parse `level.json` with ad-hoc field
access (plain JS, no typecheck) — update these on any schema change:
`tools/publish-levels.mjs`, `tools/package-dist-level-assets.mjs`,
`tools/validate-level-assets.mjs`, `tools/validate-dist-level-assets.mjs`.

NOTE: intentionally NO `from __future__ import annotations`. The codegen script
(tools/gen-level-types.mjs) loads this module by file path via importlib to emit
`model_json_schema()`; stringized annotations would force a `model_rebuild()`
with an unavailable namespace. Eager annotations (classes defined in dependency
order) keep the model loadable in isolation with only pydantic installed.
"""

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DogSpriteCleanup(BaseModel):
    """Authoritative restoration removal footprint for a dog sprite."""

    model_config = ConfigDict(extra="ignore")

    x: int
    y: int
    width: int = Field(ge=1)
    height: int = Field(ge=1)


class DogSprite(BaseModel):
    """Transparent pickup-sprite crop plus restoration cleanup footprint."""

    model_config = ConfigDict(extra="ignore")

    image: str = Field(min_length=1)
    x: int
    y: int
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    cleanup: DogSpriteCleanup
    # Normalized anchor in [0, 1]; _level_sprite_metadata defaults these to 0.5
    # before write, so on-disk levels always carry them — modeled with the same
    # default for the (rare) sprite that predates anchor metadata.
    anchorX: float = Field(default=0.5, ge=0.0, le=1.0)
    anchorY: float = Field(default=0.5, ge=0.0, le=1.0)


class Dog(BaseModel):
    """A hideable dog: hitbox center (`x`,`y`) + radius `r`, plus an optional
    pickup sprite. `id` is the writer's `dog_{i:02d}` format."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^dog_\d{2,}$")
    x: int
    y: int
    r: int = Field(ge=1)
    sprite: DogSprite | None = None


class Section(BaseModel):
    """A landscape camera section (one phone-width pan slice). Cross-section
    invariants (count, contiguity, full coverage) stay in
    `session.py::_validate_sections`; this models only per-item bounds."""

    model_config = ConfigDict(extra="ignore")

    xStart: int = Field(ge=0)
    xEnd: int

    @model_validator(mode="after")
    def _end_after_start(self) -> Self:
        if self.xEnd <= self.xStart:
            raise ValueError(
                f"section xEnd ({self.xEnd}) must be > xStart ({self.xStart})"
            )
        return self


class LevelExtension(BaseModel):
    """Records a level's vertical scene extension so the baked public package
    is a reproducible pure function of (native art + bands + this block).

    Two levels of the same `level.json` carry this block:

    - **native** (`public/levels/<id>/native/level.json`): native dims, unshifted
      coords. This is the immutable source of truth publish re-derives from.
    - **baked** (shipped `public/levels/<id>/level.json`): `height` grown by the
      bands, coords shifted down by `topBand`. The block is echoed unchanged so
      the transform stays reversible and the geometry gate can check consistency.

    `topBand`/`bottomBand` are the color-space band pixel heights added on each
    side; the invariant that keeps every layer (color, bw, ~0.4× bg) aligned is
    the band *fraction* (`topBand / nativeHeight`), which the per-image resize in
    the bake preserves. Storing px + `nativeHeight` makes the fraction derivable
    without loading the bands. Absent block ⇒ a level with no extension (all 54
    pre-bake-on-publish levels), validated exactly as before.
    """

    model_config = ConfigDict(extra="ignore")

    # The design target aspect (height : width), e.g. 2.1875 for the skinniest
    # iPhone. Advisory — carried for validation/reporting, not the transform.
    targetAspect: float = Field(gt=0.0)
    # Identifier of the band set that produced the extension (e.g. the level id
    # under the archived `.work/level-ext-full/` tree). Lets publish locate bands.
    bandsRef: str = Field(min_length=1)
    # Color-space band pixel heights added above / below the native scene.
    topBand: int = Field(ge=0)
    bottomBand: int = Field(ge=0)
    # Authored native dimensions — explicit so the block is self-describing even
    # in the baked json, where `width`/`height` are the extended dims.
    nativeWidth: int = Field(ge=1)
    nativeHeight: int = Field(ge=1)


class LevelFileV1(BaseModel):
    """The public-stage find_the_dog `level.json` contract."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    bwImage: str | None = Field(default=None, min_length=1)
    colorImage: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    dogs: list[Dog] = Field(min_length=1)
    # Landscape only; portrait levels omit the key (export_to_game pops it).
    sections: list[Section] = Field(default_factory=list)
    # Vertical scene extension config; absent on levels that ship native-aspect.
    extension: LevelExtension | None = None
