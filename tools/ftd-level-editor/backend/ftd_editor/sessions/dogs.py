"""Exact legacy-compatible membership for one generated FTD dog variant."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Mapping

from ..fs import FilesystemContractError, RawBundle, encode_json
from .model import AuthoringSession


class StableDogNotFound(LookupError):
    """A named dog action could not resolve one unique stable authoring ID."""


def set_active_variant(
    session: AuthoringSession,
    dog_id: str,
    active_variant: int | None,
) -> AuthoringSession:
    """Return one lossless FTD session mutation addressed only by stable dog ID."""

    if active_variant is not None and active_variant < 0:
        raise ValueError("active variant must be null or a non-negative integer")
    mapping = session.to_mapping()
    dogs = mapping.get("dogs")
    if not isinstance(dogs, list):
        raise StableDogNotFound(f"stable dog id {dog_id!r} was not found")
    matches = [dog for dog in dogs if isinstance(dog, dict) and dog.get("id") == dog_id]
    if len(matches) != 1:
        raise StableDogNotFound(f"stable dog id {dog_id!r} did not resolve uniquely")
    if (
        "activeVariant" in matches[0]
        and matches[0]["activeVariant"] == active_variant
    ):
        return session
    matches[0]["activeVariant"] = active_variant
    return session.with_mapping(mapping)


@dataclass(frozen=True, slots=True)
class DogBundlePayload:
    """Raw bytes committed together; no U3 session defaults or revision semantics."""

    variant_image: bytes
    box: Mapping[str, Any]
    sprite_image: bytes
    sprite_metadata: Mapping[str, Any]
    session_json: Mapping[str, Any]
    job_artifact: bytes
    job_artifact_name: str

    def as_bundle(
        self,
        *,
        session_id: str,
        dog_key: str,
        variant_index: int,
    ) -> RawBundle:
        artifact = PurePosixPath(self.job_artifact_name)
        if artifact.name != self.job_artifact_name or artifact.name in ("", ".", ".."):
            raise FilesystemContractError("job artifact name must be one confined filename")
        prefix = f"dogs/{dog_key}"
        return RawBundle.from_bytes(
            kind="dog-variant",
            members=(
                (f"{prefix}/variant_{variant_index:03d}.png", self.variant_image),
                (f"{prefix}/variant_{variant_index:03d}.box.json", encode_json(dict(self.box))),
                (f"{prefix}/sprite_{variant_index:03d}.png", self.sprite_image),
                (f"{prefix}/sprite_{variant_index:03d}.json", encode_json(dict(self.sprite_metadata))),
                ("session.json", encode_json(dict(self.session_json))),
                (f"artifacts/{artifact.name}", self.job_artifact),
            ),
            metadata={
                "sessionId": session_id,
                "dogKey": dog_key,
                "variantIndex": variant_index,
            },
        )
