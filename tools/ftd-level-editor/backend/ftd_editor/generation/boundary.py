"""Outbound provider trust boundary for FTD paid generation.

Ports the hardened Layer.ai discipline from the v1 editor
(`layer_provider.py`: HTTPS-only fixed host allowlists, no redirect
following, streamed byte caps, MIME-versus-decoded-media validation) and
extends it to every provider surface, including the fal/OpenAI/OpenRouter
paths that never had it in v1. Every provider output passes through
`fetch_validated_output` before any artifact registration; a violation
fails closed with no partial artifact.

The transport is injected (scripted in tests, fail-closed otherwise) and
never receives provider credentials: output downloads are unauthenticated
by contract, so a hostile redirect target can never observe a secret.
"""

from __future__ import annotations

import ipaddress
import struct
from dataclasses import dataclass, field
from typing import Iterable, Mapping, Protocol
from urllib.parse import urlsplit


class ProviderOutputRejected(RuntimeError):
    """A provider output failed the trust boundary before registration."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class OutputPolicy:
    """One provider surface's fixed output-download contract."""

    provider: str
    allowed_output_hosts: frozenset[str]
    max_output_bytes: int
    poll_deadline_seconds: float
    allowed_media_types: frozenset[str]


# Exact v1 Layer constants (layer_provider.py:16-20) plus the allowlists the
# fal/OpenAI paths were missing entirely in v1, whose shared image client
# downloaded any https URL with redirects followed and no byte cap.
FTD_OUTPUT_POLICIES: Mapping[str, OutputPolicy] = {
    "layer": OutputPolicy(
        provider="layer",
        allowed_output_hosts=frozenset({"media.app.layer.ai"}),
        max_output_bytes=64 * 1024 * 1024,
        poll_deadline_seconds=360.0,
        allowed_media_types=frozenset(
            {"image/png", "image/webp", "image/gif", "video/mp4", "video/webm"}
        ),
    ),
    "image": OutputPolicy(
        provider="image",
        allowed_output_hosts=frozenset(
            {
                "fal.run",
                "fal.media",
                "v3.fal.media",
                "api.openai.com",
                "oaidalleapiprodscus.blob.core.windows.net",
                "openrouter.ai",
            }
        ),
        max_output_bytes=64 * 1024 * 1024,
        poll_deadline_seconds=360.0,
        allowed_media_types=frozenset({"image/png", "image/jpeg", "image/webp"}),
    ),
}


@dataclass(frozen=True, slots=True)
class TransportResponse:
    status: int
    media_type: str
    chunks: Iterable[bytes]
    headers: Mapping[str, str] = field(default_factory=dict)


class OutputTransport(Protocol):
    """One unauthenticated GET; implementations must not follow redirects."""

    def get(self, url: str) -> TransportResponse: ...


def validate_provider_url(url: str, policy: OutputPolicy) -> str:
    """HTTPS-only, allowlisted-host, no-credential, no-private-address URLs."""

    parts = urlsplit(url)
    if parts.scheme != "https":
        raise ProviderOutputRejected(
            "output_url_scheme", f"provider output URL must be https, got {parts.scheme!r}"
        )
    if parts.username is not None or parts.password is not None:
        raise ProviderOutputRejected(
            "output_url_userinfo", "provider output URL must not embed credentials"
        )
    host = parts.hostname or ""
    if parts.port not in (None, 443):
        raise ProviderOutputRejected(
            "output_url_port", "provider output URL must use the default https port"
        )
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    ):
        raise ProviderOutputRejected(
            "output_url_private_address",
            "provider output URL resolves to a private, loopback, or link-local address",
        )
    if host not in policy.allowed_output_hosts:
        raise ProviderOutputRejected(
            "output_host_not_allowlisted",
            f"host {host!r} is not in the {policy.provider} output allowlist",
        )
    return url


# -- decoded-media validation (stdlib header decoding; no imaging dependency) --


def _png_dimensions(payload: bytes) -> tuple[int, int] | None:
    if len(payload) < 24 or payload[:8] != b"\x89PNG\r\n\x1a\n" or payload[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", payload[16:24])
    return width, height


def _gif_dimensions(payload: bytes) -> tuple[int, int] | None:
    if len(payload) < 10 or payload[:6] not in (b"GIF87a", b"GIF89a"):
        return None
    width, height = struct.unpack("<HH", payload[6:10])
    return width, height


def _jpeg_dimensions(payload: bytes) -> tuple[int, int] | None:
    if len(payload) < 4 or payload[:2] != b"\xff\xd8":
        return None
    offset = 2
    while offset + 9 < len(payload):
        if payload[offset] != 0xFF:
            return None
        marker = payload[offset + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            offset += 2
            continue
        length = struct.unpack(">H", payload[offset + 2 : offset + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if offset + 9 > len(payload):
                return None
            height, width = struct.unpack(">HH", payload[offset + 5 : offset + 9])
            return width, height
        offset += 2 + length
    return None


def _webp_dimensions(payload: bytes) -> tuple[int, int] | None:
    if len(payload) < 30 or payload[:4] != b"RIFF" or payload[8:12] != b"WEBP":
        return None
    chunk = payload[12:16]
    if chunk == b"VP8X":
        width = int.from_bytes(payload[24:27], "little") + 1
        height = int.from_bytes(payload[27:30], "little") + 1
        return width, height
    if chunk == b"VP8L":
        bits = int.from_bytes(payload[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8 ":
        width, height = struct.unpack("<HH", payload[26:30])
        return width & 0x3FFF, height & 0x3FFF
    return None


_IMAGE_DECODERS = {
    "image/png": _png_dimensions,
    "image/gif": _gif_dimensions,
    "image/jpeg": _jpeg_dimensions,
    "image/webp": _webp_dimensions,
}

_VIDEO_MAGIC = {
    "video/mp4": lambda payload: len(payload) > 12 and payload[4:8] == b"ftyp",
    "video/webm": lambda payload: payload.startswith(b"\x1a\x45\xdf\xa3"),
}


@dataclass(frozen=True, slots=True)
class ValidatedOutput:
    """Quarantine-passed provider bytes; the only input artifact registration accepts."""

    payload: bytes
    media_type: str
    width: int | None
    height: int | None


def validate_decoded_media(payload: bytes, media_type: str, policy: OutputPolicy) -> ValidatedOutput:
    if media_type not in policy.allowed_media_types:
        raise ProviderOutputRejected(
            "output_media_type", f"media type {media_type!r} is not allowed for {policy.provider}"
        )
    decoder = _IMAGE_DECODERS.get(media_type)
    if decoder is not None:
        dimensions = decoder(payload)
        if dimensions is None:
            raise ProviderOutputRejected(
                "output_decode_mismatch",
                f"payload does not decode as the declared {media_type!r}",
            )
        width, height = dimensions
        if width <= 0 or height <= 0 or width > 32768 or height > 32768:
            raise ProviderOutputRejected(
                "output_dimensions", f"decoded dimensions {width}x{height} are invalid"
            )
        return ValidatedOutput(payload=payload, media_type=media_type, width=width, height=height)
    magic = _VIDEO_MAGIC.get(media_type)
    if magic is None or not magic(payload):
        raise ProviderOutputRejected(
            "output_decode_mismatch", f"payload does not match the declared {media_type!r}"
        )
    return ValidatedOutput(payload=payload, media_type=media_type, width=None, height=None)


def fetch_validated_output(
    transport: OutputTransport, url: str, policy: OutputPolicy
) -> ValidatedOutput:
    """One bounded, unauthenticated, redirect-rejecting, validated download."""

    validate_provider_url(url, policy)
    response = transport.get(url)
    if 300 <= response.status < 400:
        raise ProviderOutputRejected(
            "output_redirected", "provider output URL redirected unexpectedly"
        )
    if response.status != 200:
        raise ProviderOutputRejected(
            "output_http_status", f"provider output download returned {response.status}"
        )
    received = bytearray()
    for chunk in response.chunks:
        received.extend(chunk)
        if len(received) > policy.max_output_bytes:
            raise ProviderOutputRejected(
                "output_too_large",
                f"provider output exceeded {policy.max_output_bytes} bytes",
            )
    if not received:
        raise ProviderOutputRejected("output_empty", "provider output was empty")
    media_type = (response.media_type or "").split(";")[0].strip().lower()
    return validate_decoded_media(bytes(received), media_type, policy)
