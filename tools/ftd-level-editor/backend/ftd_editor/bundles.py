"""FTD-specific raw membership for authoring and publication bundles."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from .fs import RawBundle


@dataclass(frozen=True, slots=True)
class SessionEditPayload:
    """One raw session mutation without interpreting its JSON fields."""

    session_json: bytes
    files: Mapping[str, bytes] = field(default_factory=dict)

    def as_bundle(self) -> RawBundle:
        return RawBundle.from_bytes(
            kind="session-edit",
            members=(("session.json", self.session_json), *self.files.items()),
        )


@dataclass(frozen=True, slots=True)
class PublicPackagePayload:
    """The required runtime files plus exact optional FTD level assets."""

    level_json: bytes
    color_png: bytes
    assets: Mapping[str, bytes] = field(default_factory=dict)

    def as_bundle(self) -> RawBundle:
        return RawBundle.from_bytes(
            kind="public-package",
            members=(
                ("level.json", self.level_json),
                ("color.png", self.color_png),
                *self.assets.items(),
            ),
        )


@dataclass(frozen=True, slots=True)
class ManifestSetPayload:
    """FTD's two live manifests, optional legacy index, and retained snapshots."""

    bundled_manifest: bytes
    catalog_manifest: bytes
    levels_index: bytes | None = None
    catalog_snapshots: Sequence[tuple[str, bytes]] = ()

    def as_bundle(self) -> RawBundle:
        members: list[tuple[str, bytes]] = [
            ("bundled-manifest.json", self.bundled_manifest),
            ("catalog-manifest.json", self.catalog_manifest),
        ]
        if self.levels_index is not None:
            members.append(("levels-index.json", self.levels_index))
        members.extend(
            (f"catalog-snapshots/{name}", content)
            for name, content in self.catalog_snapshots
        )
        return RawBundle.from_bytes(kind="manifest-set", members=members)
