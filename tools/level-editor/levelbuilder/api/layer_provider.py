"""Layer provider helpers for levelbuilder asset generation."""

from __future__ import annotations

import io
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from PIL import Image

LAYER_API_BASE = "https://api.app.layer.ai/api"
LAYER_ALLOWED_OUTPUT_HOSTS = frozenset({"media.app.layer.ai"})
LAYER_ALLOWED_UPLOAD_HOSTS = frozenset({"storage.googleapis.com"})
LAYER_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
LAYER_POLL_DEADLINE_S = 360.0
LAYER_CARTOON_2D_MODEL_ID = "20bb78fa-bf6a-4fa1-80c0-615053987e7d"
LAYER_CARTOON_2D_MODEL = "layer/cartoon-2d"
LAYER_MODEL_OPTIONS = [
    {"id": LAYER_CARTOON_2D_MODEL, "label": "Layer Cartoon 2D"},
]


class LayerProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class LayerEstimate:
    creative_units: float | None
    raw_status: str


@dataclass
class LayerGenerationResult:
    image: Image.Image
    metadata: dict[str, Any]


@dataclass(frozen=True)
class LayerAnimationResult:
    content: bytes
    content_type: str
    extension: str
    metadata: dict[str, Any]


def is_layer_model(model: str | None) -> bool:
    return model == LAYER_CARTOON_2D_MODEL


def layer_token() -> str | None:
    token = os.environ.get("LAYER_TOKEN") or os.environ.get("LAYER_API_KEY")
    return token.strip() if token and token.strip() else None


def layer_configured() -> bool:
    return layer_token() is not None


def layer_model_id(model: str) -> str:
    if model != LAYER_CARTOON_2D_MODEL:
        raise LayerProviderError(f"Unsupported Layer model: {model}")
    return os.environ.get("LAYER_CARTOON_2D_MODEL_ID", LAYER_CARTOON_2D_MODEL_ID)


def layer_dimensions(aspect_ratio: str, image_size: str) -> tuple[int, int]:
    long_edge_by_size = {"1K": 1024, "2K": 2048, "4K": 3840}
    long_edge = long_edge_by_size.get(image_size, 1024)
    try:
        raw_w, raw_h = aspect_ratio.split(":", 1)
        aspect_w = max(1, int(raw_w))
        aspect_h = max(1, int(raw_h))
    except ValueError:
        aspect_w, aspect_h = 1, 1

    if aspect_w >= aspect_h:
        width = long_edge
        height = round(long_edge * aspect_h / aspect_w)
    else:
        height = long_edge
        width = round(long_edge * aspect_w / aspect_h)
    return max(64, width), max(64, height)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _workspace_id(client: httpx.Client, token: str) -> str:
    configured = os.environ.get("LAYER_WORKSPACE_ID")
    if configured and configured.strip():
        return configured.strip()
    response = client.get(f"{LAYER_API_BASE}/v1/workspaces", headers=_headers(token))
    response.raise_for_status()
    payload = response.json()
    workspaces = payload.get("workspaces") or payload.get("data") or payload
    if not isinstance(workspaces, list) or not workspaces:
        raise LayerProviderError("Layer workspace lookup returned no workspaces")
    workspace = workspaces[0]
    workspace_id = None
    if isinstance(workspace, dict):
        workspace_id = workspace.get("id") or workspace.get("workspace_id") or workspace.get("workspaceId")
    if not workspace_id:
        raise LayerProviderError("Layer workspace response did not include an id")
    return str(workspace_id)


def _sprite_model_id() -> str:
    model_id = os.environ.get("LAYER_SPRITE_ANIMATION_MODEL_ID")
    if model_id is None or not model_id.strip():
        raise LayerProviderError("LAYER_SPRITE_ANIMATION_MODEL_ID is not configured")
    return model_id.strip()


def _creative_units(payload: Any) -> float | None:
    if not isinstance(payload, dict):
        return None
    candidates = [
        payload.get("actual_price_creative_units"),
        payload.get("estimated_price_creative_units"),
        payload.get("creative_units"),
        payload.get("creativeUnits"),
        payload.get("estimated_creative_units"),
        payload.get("estimatedCreativeUnits"),
        payload.get("actualCreativeUnits"),
        payload.get("cost"),
    ]
    usage = payload.get("usage")
    if isinstance(usage, dict):
        candidates.extend([usage.get("creative_units"), usage.get("creativeUnits")])
    for candidate in candidates:
        if candidate is None:
            continue
        try:
            return float(candidate)
        except (TypeError, ValueError):
            continue
    return None


def estimate_layer_background(
    *,
    prompt: str,
    model: str,
    aspect_ratio: str,
    image_size: str,
) -> LayerEstimate:
    token = layer_token()
    if token is None:
        raise LayerProviderError("LAYER_TOKEN is not configured")
    width, height = layer_dimensions(aspect_ratio, image_size)
    model_id = layer_model_id(model)
    with httpx.Client(timeout=30) as client:
        workspace_id = _workspace_id(client, token)
        response = client.post(
            f"{LAYER_API_BASE}/v1/workspaces/{workspace_id}/inferences/estimate",
            headers=_headers(token),
            json={
                "model_id": model_id,
                "prompt": prompt,
                "width": width,
                "height": height,
                "batch_size": 1,
            },
        )
        response.raise_for_status()
        payload = response.json()
    return LayerEstimate(creative_units=_creative_units(payload), raw_status="estimated")


def _inference_id(payload: dict[str, Any]) -> str:
    inference_id = payload.get("id") or payload.get("inference_id") or payload.get("inferenceId")
    if not inference_id:
        raise LayerProviderError("Layer inference response did not include an id")
    return str(inference_id)


def _status(payload: dict[str, Any]) -> str:
    return str(payload.get("status") or payload.get("state") or "").lower()


def _validated_output_url(url: Any) -> str:
    if not isinstance(url, str):
        raise LayerProviderError("Layer output did not include a download URL")
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise LayerProviderError("Layer output URL must use https")
    if parsed.hostname not in LAYER_ALLOWED_OUTPUT_HOSTS:
        raise LayerProviderError("Layer output URL host is not allowed")
    return url


def _validated_upload_url(url: Any) -> str:
    if not isinstance(url, str):
        raise LayerProviderError("Layer upload URL response was missing a URL")
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise LayerProviderError("Layer upload URL must use https")
    if parsed.hostname not in LAYER_ALLOWED_UPLOAD_HOSTS:
        raise LayerProviderError("Layer upload URL host is not allowed")
    return url


def _output_from_inference(payload: dict[str, Any], *, kind: str) -> dict[str, Any]:
    outputs = payload.get("outputs")
    if outputs is None:
        outputs = payload.get("files")
    if outputs is None:
        outputs = payload.get("result")
    if isinstance(outputs, dict):
        outputs = [outputs]
    if not isinstance(outputs, list):
        raise LayerProviderError("Layer inference completed without output files")

    for output in outputs:
        if not isinstance(output, dict):
            continue
        content_type = str(output.get("content_type") or output.get("contentType") or "")
        url = output.get("url") or output.get("download_url") or output.get("downloadUrl")
        if kind == "background" and url and (not content_type or content_type.startswith("image/")):
            return output
        if kind == "animation" and url and (
            content_type.startswith("video/") or content_type in {"image/gif", "image/webp", "image/png"}
        ):
            return output

    raise LayerProviderError(f"Layer inference completed without a usable {kind} output")


def _poll_inference(
    client: httpx.Client,
    token: str,
    workspace_id: str,
    inference_id: str,
    payload: dict[str, Any],
    *,
    cancel_event: Any | None = None,
) -> dict[str, Any]:
    deadline = time.monotonic() + LAYER_POLL_DEADLINE_S
    while time.monotonic() < deadline:
        if cancel_event is not None and cancel_event.is_set():
            raise LayerProviderError("Layer generation cancelled after inference submission")
        status = _status(payload)
        if status in {"complete", "completed", "succeeded", "success", "done"}:
            return payload
        if status in {"failed", "error", "cancelled", "canceled", "deleted"}:
            raise LayerProviderError(f"Layer inference {inference_id} ended with status {status}")
        # CLAMP the remote-controlled interval (ledger 054 #18): a buggy/hostile
        # poll_interval_seconds (negative -> ValueError; huge -> sleeps far past
        # the deadline, which is only checked BEFORE the sleep) controlled our
        # sleep unvalidated.
        try:
            _interval = float(payload.get("poll_interval_seconds") or 2)
        except (TypeError, ValueError):
            _interval = 2.0
        time.sleep(min(15.0, max(1.0, _interval)))
        polled = client.get(
            f"{LAYER_API_BASE}/v1/workspaces/{workspace_id}/inferences/{inference_id}",
            headers=_headers(token),
        )
        polled.raise_for_status()
        payload = polled.json()
    raise LayerProviderError(f"Layer inference {inference_id} timed out")


def _download_output(client: httpx.Client, output: dict[str, Any]) -> httpx.Response:
    url = _validated_output_url(output.get("url") or output.get("download_url") or output.get("downloadUrl"))
    downloaded = client.get(url, follow_redirects=False)
    if 300 <= getattr(downloaded, "status_code", 200) < 400:
        raise LayerProviderError("Layer output URL redirected unexpectedly")
    downloaded.raise_for_status()
    if len(downloaded.content) > LAYER_MAX_OUTPUT_BYTES:
        raise LayerProviderError("Layer output exceeded maximum allowed size")
    return downloaded


def _extension_for_content_type(content_type: str) -> str:
    if content_type == "video/mp4":
        return ".mp4"
    if content_type == "image/gif":
        return ".gif"
    if content_type == "image/png":
        return ".png"
    if content_type == "image/webp":
        return ".webp"
    return ".bin"


def generate_layer_background(
    *,
    prompt: str,
    model: str,
    aspect_ratio: str,
    image_size: str,
    estimate: LayerEstimate | None = None,
    cancel_event: Any | None = None,
) -> LayerGenerationResult:
    token = layer_token()
    if token is None:
        raise LayerProviderError("LAYER_TOKEN is not configured")
    width, height = layer_dimensions(aspect_ratio, image_size)
    model_id = layer_model_id(model)
    t0 = time.perf_counter()

    timeout = httpx.Timeout(15.0, connect=5.0, read=15.0, write=5.0, pool=5.0)
    with httpx.Client(timeout=timeout) as client:
        workspace_id = _workspace_id(client, token)
        if cancel_event is not None and cancel_event.is_set():
            raise LayerProviderError("Layer generation cancelled before inference submission")

        created = client.post(
            f"{LAYER_API_BASE}/v1/workspaces/{workspace_id}/inferences",
            headers=_headers(token),
            json={
                "model_id": model_id,
                "prompt": prompt,
                "width": width,
                "height": height,
                "batch_size": 1,
            },
        )
        created.raise_for_status()
        payload = created.json()
        inference_id = _inference_id(payload)
        payload = _poll_inference(client, token, workspace_id, inference_id, payload, cancel_event=cancel_event)
        output = _output_from_inference(payload, kind="background")
        downloaded = _download_output(client, output)

    content_type = output.get("content_type") or output.get("contentType") or downloaded.headers.get("content-type")
    if content_type and not str(content_type).startswith("image/"):
        raise LayerProviderError(f"Layer output had unsupported content type {content_type}")
    try:
        image = Image.open(io.BytesIO(downloaded.content)).convert("RGBA")
        image.load()
    except Exception as exc:
        raise LayerProviderError("Layer output was not a readable image") from exc
    if image.width <= 0 or image.height <= 0:
        raise LayerProviderError("Layer output had invalid dimensions")

    metadata = {
        "provider": "layer",
        "model": model,
        "providerModelId": model_id,
        "providerJobId": inference_id,
        "status": "generated",
        "selectable": True,
        "outputKind": "background",
        "contentType": str(content_type or "image/png"),
        "estimatedCreativeUnits": estimate.creative_units if estimate else None,
        "actualCreativeUnits": _creative_units(payload),
        "providerElapsed": round(time.perf_counter() - t0, 1),
    }
    return LayerGenerationResult(image=image, metadata=metadata)


def _upload_file(client: httpx.Client, token: str, workspace_id: str, path: Path, content_type: str) -> str:
    content = path.read_bytes()
    response = client.post(
        f"{LAYER_API_BASE}/v1/workspaces/{workspace_id}/files/upload-url",
        headers=_headers(token),
        json={
            "content_type": content_type,
            "file_name": path.name,
            "file_size_bytes": len(content),
        },
    )
    response.raise_for_status()
    payload = response.json()
    file_id = payload.get("file_id") or payload.get("fileId")
    upload_url = payload.get("upload_url") or payload.get("uploadUrl")
    upload_content_type = payload.get("content_type") or content_type
    if not isinstance(file_id, str) or not isinstance(upload_url, str):
        raise LayerProviderError("Layer upload URL response was missing file_id or upload_url")
    upload_url = _validated_upload_url(upload_url)

    upload_start = client.post(
        upload_url,
        headers={
            "x-goog-resumable": "start",
            "x-goog-content-length-range": f"0,{len(content)}",
            "content-type": str(upload_content_type),
        },
    )
    upload_start.raise_for_status()
    session_uri = upload_start.headers.get("location")
    if not session_uri:
        raise LayerProviderError("Layer upload did not return a resumable session URI")
    session_uri = _validated_upload_url(session_uri)
    uploaded = client.put(
        session_uri,
        content=content,
        headers={
            "content-type": str(upload_content_type),
            "content-length": str(len(content)),
        },
    )
    uploaded.raise_for_status()
    return file_id


def generate_layer_sprite_animation(
    *,
    source_image_path: Path,
    prompt: str,
    motion_preset: str | None = None,
    duration_seconds: float = 3.0,
    fps: int = 24,
) -> LayerAnimationResult:
    token = layer_token()
    if token is None:
        raise LayerProviderError("LAYER_TOKEN is not configured")
    if not source_image_path.exists():
        raise LayerProviderError("source sprite image is missing")

    model_id = _sprite_model_id()
    t0 = time.perf_counter()
    timeout = httpx.Timeout(30.0, connect=10.0, read=30.0, write=30.0, pool=10.0)
    with httpx.Client(timeout=timeout) as client:
        workspace_id = _workspace_id(client, token)
        file_id = _upload_file(client, token, workspace_id, source_image_path, "image/png")
        created = client.post(
            f"{LAYER_API_BASE}/v1/workspaces/{workspace_id}/inferences",
            headers=_headers(token),
            json={
                "model_id": model_id,
                "prompt": prompt,
                "batch_size": 1,
                "duration_seconds": duration_seconds,
                "fps": fps,
                "generate_audio": False,
                "guidance_files": [
                    {"file_id": file_id, "type": "first_frame", "weight": 1.0},
                ],
                "session_name": f"find-the-dog sprite animation {motion_preset or 'custom'}",
            },
        )
        created.raise_for_status()
        payload = created.json()
        inference_id = _inference_id(payload)
        payload = _poll_inference(client, token, workspace_id, inference_id, payload)
        output = _output_from_inference(payload, kind="animation")
        downloaded = _download_output(client, output)

    content_type = str(
        output.get("content_type")
        or output.get("contentType")
        or downloaded.headers.get("content-type")
        or "application/octet-stream"
    )
    if not (content_type.startswith("video/") or content_type in {"image/gif", "image/webp", "image/png"}):
        raise LayerProviderError(f"Layer output had unsupported content type {content_type}")
    metadata = {
        "provider": "layer",
        "model": "layer/sprite-animation",
        "providerModelId": model_id,
        "providerJobId": inference_id,
        "status": "generated",
        "outputKind": "sprite_animation",
        "contentType": content_type,
        "uploadedFileId": file_id,
        "actualCreativeUnits": _creative_units(payload),
        "providerElapsed": round(time.perf_counter() - t0, 1),
    }
    return LayerAnimationResult(
        content=downloaded.content,
        content_type=content_type,
        extension=_extension_for_content_type(content_type),
        metadata=metadata,
    )
