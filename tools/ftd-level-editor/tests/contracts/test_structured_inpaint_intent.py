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
    resolve_band_prompt,
    resolve_dog_prompt,
    resolve_magenta_prompt,
    resolve_scene_prompt,
)
from ftd_editor.prompts.recipes import build_scene_prompt, get_entity_prompt

from test_paid_job_kinds import run_all, script_happy


def test_intents_resolve_through_the_frozen_catalog() -> None:
    assert resolve_scene_prompt({"scene": "turkey_grand_bazaar_corridor"}) == build_scene_prompt(
        content="turkey_grand_bazaar_corridor"
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
        (resolve_scene_prompt, {"scene": "not-a-catalog-scene"}),
        (
            resolve_scene_prompt,
            {"scene": "turkey_grand_bazaar_corridor", "view": "free text"},
        ),
        (
            resolve_scene_prompt,
            {"scene": "turkey_grand_bazaar_corridor", "style": "free text"},
        ),
        (
            resolve_scene_prompt,
            {"scene": "turkey_grand_bazaar_corridor", "prompt": "smuggled"},
        ),
        (resolve_scene_prompt, "free text"),
        (resolve_dog_prompt, {}),  # missing style
        (resolve_dog_prompt, {"style": ""}),
        (resolve_dog_prompt, {"style": "free text"}),
        (resolve_dog_prompt, {"style": "clean_old_cartoon", "entity": "free text"}),
        (resolve_magenta_prompt, {"style": "clean_old_cartoon", "override": "smuggled"}),
    ],
)
def test_malformed_intents_are_rejected(resolver, intent) -> None:
    with pytest.raises(IntentError):
        resolver(intent)


@pytest.mark.parametrize(
    "key", ["prompt", "dogPrompt", "magentaPromptOverride", "sceneMeta"]
)
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


@pytest.mark.parametrize(
    "kind,inputs",
    [
        (
            "ftd.background_generate",
            {"sceneIntent": {"scene": "turkey_grand_bazaar_corridor"}, "prompt": "mine"},
        ),
        (
            "ftd.crop_inpaint",
            {
                "dogId": "dog-1",
                "hitbox": {"x": 10, "y": 12, "w": 20, "h": 24},
                "dogIntent": {"style": "clean_old_cartoon"},
                "dogPrompt": "mine",
            },
        ),
        (
            "ftd.retry_failed_dogs",
            {
                "dogs": [
                    {
                        "dogId": "dog-1",
                        "hitbox": {"x": 10, "y": 12, "w": 20, "h": 24},
                        "dogIntent": {"style": "clean_old_cartoon"},
                    },
                    {
                        "dogId": "dog-2",
                        "hitbox": {"x": 20, "y": 24, "w": 20, "h": 24},
                        "dogIntent": {"style": "old_pixel_art"},
                        "prompt": "mine",
                    },
                ]
            },
        ),
        (
            "ftd.band_generate",
            {
                "side": "top",
                "nativeWidth": 1000,
                "nativeHeight": 1000,
                "sceneIntent": {"scene": "turkey_grand_bazaar_corridor"},
                "sceneMeta": {"scene_prompt": "mine"},
            },
        ),
        (
            "ftd.sequence_workflow",
            {"scenes": ["turkey_grand_bazaar_corridor"], "prompt": "mine"},
        ),
        (
            "ftd.multi_scene_generate",
            {"scenes": ["turkey_grand_bazaar_corridor"], "prompt": "mine"},
        ),
        (
            "ftd.magenta_inpaint",
            {"dogIntent": {"style": "clean_old_cartoon"}, "magentaPromptOverride": "mine"},
        ),
        (
            "ftd.dog_regenerate",
            {
                "dogId": "dog-1",
                "hitbox": {"x": 10, "y": 12, "w": 20, "h": 24},
                "dogIntent": {"style": "clean_old_cartoon"},
                "prompt": "mine",
            },
        ),
    ],
)
def test_client_prompt_text_fails_closed_before_any_provider_submission(
    paid_env, paid_session, kind: str, inputs: dict
) -> None:
    job = _start(
        paid_env,
        paid_session,
        kind,
        inputs,
    )
    run_all(paid_env.make_worker())
    final = paid_env.env.jobs.get_job(job.id)
    assert final.status == "failed_terminal"
    assert final.error_code == "invalid_inputs"
    assert paid_env.image.submissions == []


@pytest.mark.parametrize(
    "kind,inputs",
    [
        ("ftd.background_generate", {"sceneIntent": {"scene": "free text"}}),
        (
            "ftd.crop_inpaint",
            {
                "dogId": "dog-1",
                "hitbox": {"x": 10, "y": 12, "w": 20, "h": 24},
                "dogIntent": {"style": "free text"},
            },
        ),
    ],
)
def test_unknown_catalog_values_fail_before_provider_submission(
    paid_env, paid_session, kind: str, inputs: dict
) -> None:
    job = _start(paid_env, paid_session, kind, inputs)
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


def test_band_provider_receives_catalog_composed_prompt(paid_env, paid_session) -> None:
    inputs = {
        "side": "top",
        "nativeWidth": 1000,
        "nativeHeight": 1000,
        "sceneIntent": {"scene": "turkey_grand_bazaar_corridor"},
    }
    script_happy(paid_env, "ftd.band_generate")
    _start(paid_env, paid_session, "ftd.band_generate", inputs)
    run_all(paid_env.make_worker())
    (submission,) = paid_env.image.submissions
    assert submission["inputs"] == {
        "side": "top",
        "bandHeight": 594,
        "stripPx": 74,
        "model": "fal-ai/flux-pro/v1/fill",
        "prompt": resolve_band_prompt("top", inputs["sceneIntent"]),
    }


@pytest.mark.parametrize("kind", ["ftd.sequence_workflow", "ftd.multi_scene_generate"])
def test_batch_scene_providers_receive_only_catalog_composed_prompts(
    paid_env, paid_session, kind: str
) -> None:
    script_happy(paid_env, kind)
    scenes = ["turkey_grand_bazaar_corridor", "turkey_mardin_stone_terrace"]
    _start(paid_env, paid_session, kind, {"scenes": scenes})
    run_all(paid_env.make_worker())
    assert [submission["inputs"] for submission in paid_env.image.submissions] == [
        {"scene": scene, "prompt": build_scene_prompt(content=scene)}
        for scene in scenes
    ]
