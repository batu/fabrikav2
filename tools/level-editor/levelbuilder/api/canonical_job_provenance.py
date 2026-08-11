"""Immutable per-bird input descriptors for paid generation jobs."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Any

from .canonical_bird_contract import canonical_json, snapshot_revisions, validate_snapshot


def _sha256(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class BirdJobInput:
    session_id: str
    bird_id: str
    operation: str
    content_revision: str
    bird_input_revision: str
    scene_sha256: str
    crop_box: tuple[int, int, int, int]
    model: str
    prompt_sha256: str
    idempotency_key: str

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        return {
            "sessionId": value["session_id"],
            "birdId": value["bird_id"],
            "operation": value["operation"],
            "contentRevision": value["content_revision"],
            "birdInputRevision": value["bird_input_revision"],
            "sceneSha256": value["scene_sha256"],
            "cropBox": list(value["crop_box"]),
            "model": value["model"],
            "promptSha256": value["prompt_sha256"],
            "idempotencyKey": value["idempotency_key"],
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> BirdJobInput:
        return cls(
            session_id=str(value["sessionId"]),
            bird_id=str(value["birdId"]),
            operation=str(value["operation"]),
            content_revision=str(value["contentRevision"]),
            bird_input_revision=str(value["birdInputRevision"]),
            scene_sha256=str(value["sceneSha256"]),
            crop_box=tuple(int(item) for item in value["cropBox"]),
            model=str(value["model"]),
            prompt_sha256=str(value["promptSha256"]),
            idempotency_key=str(value["idempotencyKey"]),
        )


@dataclass(frozen=True)
class JobInputVerification:
    current: bool
    code: str
    actual_bird_input_revision: str | None = None


def _bird_input_projection(snapshot: dict[str, Any], bird: dict[str, Any]) -> dict[str, Any]:
    return {
        "scene": snapshot["assets"]["scene"],
        "cleanBackground": snapshot["assets"]["cleanBackground"],
        "restore": snapshot["restore"],
        "bird": {key: value for key, value in bird.items() if key != "presentationOrder"},
    }


def capture_bird_job_input(
    snapshot: dict[str, Any],
    *,
    bird_id: str,
    operation: str,
    crop_box: tuple[int, int, int, int],
    model: str,
    prompt: str,
) -> BirdJobInput:
    validated = validate_snapshot(snapshot)
    bird = next((item for item in validated["birds"] if item["birdId"] == bird_id), None)
    if bird is None:
        raise ValueError(f"unknown birdId: {bird_id}")
    bird_input_revision = _sha256(_bird_input_projection(validated, bird))
    prompt_sha256 = _sha256(prompt)
    key_payload = {
        "sessionId": validated["sessionId"],
        "birdId": bird_id,
        "operation": operation,
        "birdInputRevision": bird_input_revision,
        "cropBox": crop_box,
        "model": model,
        "promptSha256": prompt_sha256,
    }
    return BirdJobInput(
        session_id=validated["sessionId"],
        bird_id=bird_id,
        operation=operation,
        content_revision=snapshot_revisions(validated).content_revision,
        bird_input_revision=bird_input_revision,
        scene_sha256=validated["assets"]["scene"]["sha256"],
        crop_box=tuple(crop_box),
        model=model,
        prompt_sha256=prompt_sha256,
        idempotency_key=f"bird-job:{_sha256(key_payload).removeprefix('sha256:')}",
    )


def verify_bird_job_input(snapshot: dict[str, Any], captured: BirdJobInput) -> JobInputVerification:
    try:
        validated = validate_snapshot(snapshot)
    except ValueError:
        return JobInputVerification(False, "canonical_integrity")
    if validated["sessionId"] != captured.session_id:
        return JobInputVerification(False, "session_changed")
    bird = next((item for item in validated["birds"] if item["birdId"] == captured.bird_id), None)
    if bird is None:
        return JobInputVerification(False, "bird_missing")
    actual = _sha256(_bird_input_projection(validated, bird))
    if actual != captured.bird_input_revision:
        return JobInputVerification(False, "bird_input_changed", actual)
    return JobInputVerification(True, "current", actual)


def encode_job_inputs(inputs: list[BirdJobInput]) -> str:
    """Canonical serialization used by parent and child idempotency keys."""
    return json.dumps([item.to_dict() for item in inputs], sort_keys=True, separators=(",", ":"))
