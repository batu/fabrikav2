"""The outbound provider trust boundary fails closed before any artifact.

Scripted transports only: scheme/host/address/port/userinfo rejection,
redirect and status rejection, streamed byte caps, MIME-versus-decoded
media and dimension validation, and secret isolation through the ledger.
"""

from __future__ import annotations

import inspect

import pytest

from conftest import CANARY_SECRET, make_mp4, make_png
from ftd_editor.generation.boundary import (
    FTD_OUTPUT_POLICIES,
    OutputTransport,
    ProviderOutputRejected,
    TransportResponse,
    fetch_validated_output,
    validate_provider_url,
)
from ftd_editor.generation.paid import ProviderSubmission

IMAGE_POLICY = FTD_OUTPUT_POLICIES["image"]
LAYER_POLICY = FTD_OUTPUT_POLICIES["layer"]


class OneShotTransport:
    def __init__(self, response: TransportResponse) -> None:
        self.response = response
        self.calls: list[str] = []

    def get(self, url: str) -> TransportResponse:
        self.calls.append(url)
        return self.response


@pytest.mark.parametrize(
    "url,code",
    [
        ("http://fal.media/out.png", "output_url_scheme"),
        ("https://evil.example.com/out.png", "output_host_not_allowlisted"),
        ("https://user:secret@fal.media/out.png", "output_url_userinfo"),
        ("https://fal.media:8443/out.png", "output_url_port"),
        ("https://10.0.0.7/out.png", "output_url_private_address"),
        ("https://127.0.0.1/out.png", "output_url_private_address"),
        ("https://169.254.10.10/out.png", "output_url_private_address"),
        ("https://[::1]/out.png", "output_url_private_address"),
        ("https://224.0.0.1/out.png", "output_url_private_address"),
    ],
)
def test_url_validation_rejects(url, code):
    with pytest.raises(ProviderOutputRejected) as failure:
        validate_provider_url(url, IMAGE_POLICY)
    assert failure.value.code == code


def test_redirects_are_rejected_not_followed():
    transport = OneShotTransport(
        TransportResponse(status=302, media_type="", chunks=[], headers={"location": "https://evil"})
    )
    with pytest.raises(ProviderOutputRejected) as failure:
        fetch_validated_output(transport, "https://fal.media/out.png", IMAGE_POLICY)
    assert failure.value.code == "output_redirected"
    assert transport.calls == ["https://fal.media/out.png"]


def test_non_success_status_rejected():
    transport = OneShotTransport(TransportResponse(status=500, media_type="", chunks=[]))
    with pytest.raises(ProviderOutputRejected) as failure:
        fetch_validated_output(transport, "https://fal.media/out.png", IMAGE_POLICY)
    assert failure.value.code == "output_http_status"


def test_oversized_stream_rejected_mid_stream():
    chunk = b"x" * (1024 * 1024)
    chunks_served = []

    def stream():
        for _ in range(80):
            chunks_served.append(1)
            yield chunk

    transport = OneShotTransport(
        TransportResponse(status=200, media_type="image/png", chunks=stream())
    )
    with pytest.raises(ProviderOutputRejected) as failure:
        fetch_validated_output(transport, "https://fal.media/out.png", IMAGE_POLICY)
    assert failure.value.code == "output_too_large"
    # The byte cap aborts the stream; it never drains a hostile response.
    assert len(chunks_served) <= 65


def test_empty_output_rejected():
    transport = OneShotTransport(TransportResponse(status=200, media_type="image/png", chunks=[]))
    with pytest.raises(ProviderOutputRejected) as failure:
        fetch_validated_output(transport, "https://fal.media/out.png", IMAGE_POLICY)
    assert failure.value.code == "output_empty"


@pytest.mark.parametrize(
    "media_type,payload,code",
    [
        ("application/zip", make_png(), "output_media_type"),
        ("image/png", b"GIF89a" + b"\x00" * 40, "output_decode_mismatch"),
        ("image/png", make_png(0, 10), "output_dimensions"),
        ("image/jpeg", make_png(), "output_decode_mismatch"),
        ("text/plain", b"hello", "output_media_type"),
    ],
)
def test_media_validation_rejects(media_type, payload, code):
    transport = OneShotTransport(
        TransportResponse(status=200, media_type=media_type, chunks=[payload])
    )
    with pytest.raises(ProviderOutputRejected) as failure:
        fetch_validated_output(transport, "https://fal.media/out.png", IMAGE_POLICY)
    assert failure.value.code == code


def test_valid_image_and_video_pass():
    image = fetch_validated_output(
        OneShotTransport(TransportResponse(status=200, media_type="image/png", chunks=[make_png(320, 200)])),
        "https://fal.media/out.png",
        IMAGE_POLICY,
    )
    assert (image.width, image.height) == (320, 200)
    video = fetch_validated_output(
        OneShotTransport(TransportResponse(status=200, media_type="video/mp4", chunks=[make_mp4()])),
        "https://media.app.layer.ai/out.mp4",
        LAYER_POLICY,
    )
    assert video.media_type == "video/mp4"


def test_layer_policy_ports_v1_constants():
    assert LAYER_POLICY.allowed_output_hosts == frozenset({"media.app.layer.ai"})
    assert LAYER_POLICY.max_output_bytes == 64 * 1024 * 1024
    assert LAYER_POLICY.poll_deadline_seconds == 360.0


def test_transport_interface_cannot_carry_credentials():
    # Structural secret isolation: an output download has no header channel at
    # all, so no adapter can forward a provider credential to an output host.
    signature = inspect.signature(OutputTransport.get)
    assert list(signature.parameters) == ["self", "url"]


def test_provider_failure_messages_are_redacted_in_ledger(paid_env, paid_session):
    from test_paid_job_kinds import GOOD_INPUTS, start

    paid_env.image.script.append(
        RuntimeError(f"provider blew up with Authorization: Bearer {CANARY_SECRET}")
    )
    job, _ = start(paid_env, paid_session, "ftd.background_generate", "req-secret")
    worker = paid_env.make_worker()
    while worker.run_once():
        pass
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "orphaned_unknown"
    events = paid_env.env.jobs.list_events(job.id)
    for record in [final.error_message or "", str(final.result)] + [
        f"{event.message}{event.data}" for event in events
    ]:
        assert CANARY_SECRET not in record


def test_poll_deadline_parks_job_recoverable(paid_env, paid_session):
    from ftd_editor.generation.paid import ProviderPoll
    from test_paid_job_kinds import start

    paid_env.layer.submit_script.append(ProviderSubmission(provider_job_id="layer-slow"))

    def slow_poll():
        paid_env.env.clock.advance(200.0)
        return ProviderPoll(status="running")

    paid_env.layer.poll_script.extend([slow_poll, slow_poll, slow_poll])
    job, _ = start(paid_env, paid_session, "ftd.sprite_animate", "req-deadline")
    worker = paid_env.make_worker()
    assert worker.run_once()
    parked = paid_env.env.jobs.get_job(job.id)
    # Past the 360s Layer deadline the attempt parks as resumable polling:
    # the paid identity survives and a late result stays recoverable.
    assert parked.status == "polling"
    assert parked.error_code == "provider_poll_deadline"
    assert parked.metadata.get("providerJobId") == "layer-slow"
