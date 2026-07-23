"""OpenRouter image generation behind the editor's paid-provider boundary."""

from __future__ import annotations

import base64
import binascii
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

import httpx

from .boundary import TransportResponse
from .paid import ProviderCallFailed, ProviderSubmission

_DATA_IMAGE = re.compile(
    r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$"
)
_INLINE_PREFIX = "https://openrouter.ai/ftd-editor-inline/"


def _extract_image_reference(payload: Mapping[str, Any]) -> str:
    try:
        message = payload["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as error:
        raise ProviderCallFailed("OpenRouter response did not contain a message") from error
    for item in message.get("images") or ():
        if not isinstance(item, Mapping):
            continue
        image_url = item.get("image_url")
        if isinstance(image_url, Mapping) and isinstance(image_url.get("url"), str):
            return str(image_url["url"])
        if isinstance(item.get("url"), str):
            return str(item["url"])
    content = message.get("content")
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, Mapping):
                continue
            image_url = part.get("image_url")
            if isinstance(image_url, Mapping) and isinstance(image_url.get("url"), str):
                return str(image_url["url"])
    raise ProviderCallFailed("OpenRouter response did not contain an image")


@dataclass(slots=True)
class InlineOutputStore:
    _items: dict[str, tuple[str, bytes]] = field(default_factory=dict)

    def put(self, media_type: str, payload: bytes) -> str:
        token = uuid.uuid4().hex
        self._items[token] = (media_type, payload)
        return f"{_INLINE_PREFIX}{token}"

    def pop(self, url: str) -> tuple[str, bytes] | None:
        if not url.startswith(_INLINE_PREFIX):
            return None
        return self._items.pop(url.removeprefix(_INLINE_PREFIX), None)


@dataclass(slots=True)
class OpenRouterImageProvider:
    api_key: str
    inline_outputs: InlineOutputStore
    client: httpx.Client = field(
        default_factory=lambda: httpx.Client(timeout=300, follow_redirects=False)
    )
    default_model: str = "google/gemini-3.1-flash-image-preview"

    def submit(
        self,
        kind: str,
        inputs: Mapping[str, Any],
        provider_options: Mapping[str, Any],
    ) -> ProviderSubmission:
        prompt = inputs.get("prompt")
        if not isinstance(prompt, str) or not prompt:
            raise ProviderCallFailed("image submission requires a server-composed prompt")
        model = str(provider_options.get("model") or self.default_model)
        try:
            response = self.client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "modalities": ["image", "text"],
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
        except httpx.HTTPError as error:
            raise ProviderCallFailed("OpenRouter request failed") from error
        if response.status_code != 200:
            raise ProviderCallFailed(f"OpenRouter returned HTTP {response.status_code}")
        try:
            response_payload = response.json()
        except ValueError as error:
            raise ProviderCallFailed("OpenRouter returned invalid JSON") from error
        reference = _extract_image_reference(response_payload)
        if reference.startswith("https://"):
            return ProviderSubmission(output_url=reference)
        match = _DATA_IMAGE.fullmatch(reference)
        if match is None:
            raise ProviderCallFailed("OpenRouter returned an unsupported image reference")
        try:
            payload = base64.b64decode(match.group(2), validate=True)
        except (binascii.Error, ValueError) as error:
            raise ProviderCallFailed("OpenRouter returned invalid base64 image bytes") from error
        if not payload or len(payload) > 64 * 1024 * 1024:
            raise ProviderCallFailed("OpenRouter image bytes were empty or oversized")
        return ProviderSubmission(
            output_url=self.inline_outputs.put(match.group(1), payload)
        )

    def poll(self, provider_job_id: str):
        raise ProviderCallFailed("OpenRouter image generation is synchronous")


@dataclass(slots=True)
class SafeOutputTransport:
    inline_outputs: InlineOutputStore
    client: httpx.Client = field(
        default_factory=lambda: httpx.Client(timeout=120, follow_redirects=False)
    )

    def get(self, url: str) -> TransportResponse:
        inline = self.inline_outputs.pop(url)
        if inline is not None:
            media_type, payload = inline
            return TransportResponse(status=200, media_type=media_type, chunks=(payload,))
        try:
            request = self.client.build_request("GET", url)
            response = self.client.send(request, stream=True)
        except httpx.HTTPError as error:
            raise ProviderCallFailed("provider output download failed") from error

        def chunks():
            try:
                yield from response.iter_bytes()
            finally:
                response.close()

        return TransportResponse(
            status=response.status_code,
            media_type=response.headers.get("content-type", ""),
            chunks=chunks(),
            headers=dict(response.headers),
        )


@dataclass(frozen=True, slots=True)
class LiveProviderRegistry:
    image: OpenRouterImageProvider
    output_transport: SafeOutputTransport
    mode: str = "live"

    def require(self, name: str) -> Any:
        if name == "ftd.image":
            return self.image
        if name == "ftd.output_transport":
            return self.output_transport
        raise ProviderCallFailed(f"provider {name!r} is not configured")

    @classmethod
    def openrouter(cls, api_key: str) -> "LiveProviderRegistry":
        outputs = InlineOutputStore()
        return cls(
            image=OpenRouterImageProvider(api_key=api_key, inline_outputs=outputs),
            output_transport=SafeOutputTransport(inline_outputs=outputs),
        )
