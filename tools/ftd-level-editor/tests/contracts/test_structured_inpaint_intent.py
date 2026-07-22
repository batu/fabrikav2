"""U7 structured server-owned prompt/inpaint intents.

The server is the only prompt composition authority: structured intents
resolve deterministically through the frozen prompt catalog, client-composed
prompt text is rejected before any provider submission, and the scripted
provider observes exactly the server-composed prompt.
"""

from __future__ import annotations

import pytest

from ftd_editor.jobs.actions import StartJobRequest
from ftd_editor.prompts.intents import (
    IntentError,
    forbid_client_prompt_keys,
    magenta_prompt,
    resolve_dog_prompt,
    resolve_magenta_prompt,
    resolve_scene_prompt,
)
from ftd_editor.prompts.recipes import build_scene_prompt, get_entity_prompt

from test_paid_job_kinds import run_all, script_happy


def test_intents_resolve_through_the_frozen_catalog() -> None:
    assert resolve_scene_prompt({"scene": "istanbul_market"}) == build_scene_prompt(
        content="istanbul_market"
    )
    assert resolve_dog_prompt({"style": "old_pixel_art"}) == get_entity_prompt(
        "old_pixel_art", "dog"
    )
    assert resolve_magenta_prompt({"style": "clean_old_cartoon"}) == magenta_prompt(
        get_entity_prompt("clean_old_cartoon", "dog")
    )


@pytest.mark.parametrize(
    "resolver,intent",
    [
        (resolve_scene_prompt, {"view": "isometric"}),  # missing scene
        (resolve_scene_prompt, {"scene": "x", "prompt": "smuggled"}),
        (resolve_scene_prompt, "free text"),
        (resolve_dog_prompt, {}),  # missing style
        (resolve_dog_prompt, {"style": ""}),
        (resolve_magenta_prompt, {"style": "x", "override": "smuggled"}),
    ],
)
def test_malformed_intents_are_rejected(resolver, intent) -> None:
    with pytest.raises(IntentError):
        resolver(intent)


@pytest.mark.parametrize("key", ["prompt", "dogPrompt", "magentaPromptOverride"])
def test_client_composed_prompt_keys_are_rejected(key) -> None:
    with pytest.raises(IntentError):
        forbid_client_prompt_keys({key: "client text"})


def _start(paid, session, kind: str, inputs: dict):
    body = StartJobRequest(
        requestId=f"req-intent-{kind}",
        sessionId=session.session_id,
        revision=session.revision,
        inputs=inputs,
    )
    job, _created = paid.service.start(kind, body)
    return job


def test_client_prompt_text_fails_closed_before_any_provider_submission(
    paid_env, paid_session
) -> None:
    job = _start(
        paid_env,
        paid_session,
        "ftd.magenta_inpaint",
        {"dogIntent": {"style": "clean_old_cartoon"}, "magentaPromptOverride": "mine"},
    )
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "failed_terminal"
    assert final.error_code == "invalid_inputs"
    assert paid_env.image.submissions == []


def test_provider_receives_only_the_server_composed_magenta_prompt(
    paid_env, paid_session
) -> None:
    script_happy(paid_env, "ftd.magenta_inpaint")
    _start(
        paid_env,
        paid_session,
        "ftd.magenta_inpaint",
        {"dogIntent": {"style": "clean_old_cartoon"}},
    )
    run_all(paid_env.make_worker())
    (submission,) = paid_env.image.submissions
    expected = magenta_prompt(get_entity_prompt("clean_old_cartoon", "dog"))
    assert submission["inputs"]["prompt"] == expected
