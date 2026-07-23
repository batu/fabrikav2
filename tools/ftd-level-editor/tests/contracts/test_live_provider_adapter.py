from __future__ import annotations

import base64

import httpx
import pytest

from ftd_editor.generation.boundary import FTD_OUTPUT_POLICIES, fetch_validated_output
from ftd_editor.generation.paid import ProviderCallFailed
from ftd_editor.generation.openrouter import (
    InlineOutputStore,
    OpenRouterImageProvider,
    SafeOutputTransport,
)

from conftest import make_png


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_openrouter_inline_image_passes_the_existing_output_quarantine() -> None:
    payload = make_png(320, 480)
    encoded = base64.b64encode(payload).decode()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://openrouter.ai/api/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer secret"
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "images": [
                                {"image_url": {"url": f"data:image/png;base64,{encoded}"}}
                            ]
                        }
                    }
                ]
            },
        )

    outputs = InlineOutputStore()
    provider = OpenRouterImageProvider(
        api_key="secret",
        inline_outputs=outputs,
        client=_client(handler),
    )
    submission = provider.submit(
        "ftd.background_generate",
        {"prompt": "server-owned prompt"},
        {"model": "google/test-image"},
    )

    validated = fetch_validated_output(
        SafeOutputTransport(inline_outputs=outputs),
        submission.output_url or "",
        FTD_OUTPUT_POLICIES["image"],
    )
    assert validated.payload == payload
    assert (validated.width, validated.height) == (320, 480)


def test_openrouter_rejects_text_only_response_without_exposing_body() -> None:
    provider = OpenRouterImageProvider(
        api_key="secret",
        inline_outputs=InlineOutputStore(),
        client=_client(
            lambda request: httpx.Response(
                200, json={"choices": [{"message": {"content": "no image"}}]}
            )
        ),
    )
    with pytest.raises(ProviderCallFailed, match="did not contain an image"):
        provider.submit(
            "ftd.background_generate",
            {"prompt": "server-owned prompt"},
            {},
        )
