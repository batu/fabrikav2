import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from levelbuilder.prompts import ENTITIES, SETTINGS, STYLES, VIEWS
from levelbuilder.api import routes
from levelbuilder.api.server import app

DEFAULT_TEST_MODEL = "openai/gpt-image-2"


def _first_key(values: dict[str, object]) -> str:
    return next(iter(values))


def _valid_recipe() -> routes.RecipePromptRequest:
    setting = _first_key(SETTINGS)
    scene = _first_key(SETTINGS[setting]["scenes"])
    return routes.RecipePromptRequest(
        setting=setting,
        scene=scene,
        entity=_first_key(ENTITIES),
        view=_first_key(VIEWS),
        style=_first_key(STYLES),
    )


def test_recipe_prompt_assembly_returns_server_owned_prompt_context() -> None:
    response = routes._assemble_recipe_prompts(_valid_recipe())

    assert "[Purpose]" in response.scenePrompt
    assert "[Scene]" in response.scenePrompt
    assert "[View]" in response.scenePrompt
    assert "[Style]" in response.scenePrompt
    assert "[Scale]" not in response.scenePrompt
    assert "Specific dog breed for this target:" not in response.dogPrompt
    assert response.promptContext["source"] == "server-recipe-prompt-v1"
    assert response.promptContext["breedPolicy"] == "per-dog-generation"
    assert response.promptContext["scale"] == "none"


def test_recipe_prompt_assembly_adds_selected_scale_without_changing_no_scale() -> None:
    recipe = _valid_recipe().model_copy(update={"scale": "close_ad"})

    response = routes._assemble_recipe_prompts(recipe)

    assert "[Scale]" in response.scenePrompt
    assert "larger landmarks and props" in response.scenePrompt
    assert response.promptContext["scale"] == "close_ad"


def test_recipe_prompt_assembly_rejects_invalid_scale() -> None:
    recipe = _valid_recipe().model_copy(update={"scale": "not_a_scale"})

    with pytest.raises(HTTPException) as exc:
        routes._assemble_recipe_prompts(recipe)

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "invalid_recipe"


def test_recipe_prompt_assembly_rejects_invalid_scene() -> None:
    recipe = _valid_recipe().model_copy(update={"scene": "not_a_real_scene"})

    with pytest.raises(HTTPException) as exc:
        routes._assemble_recipe_prompts(recipe)

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "invalid_recipe"


def test_recipe_prompt_assembly_rejects_retired_landscape_mode() -> None:
    recipe = routes.RecipePromptRequest(
        setting=_valid_recipe().setting,
        scene=_valid_recipe().scene,
        entity=_valid_recipe().entity,
        view=_valid_recipe().view,
        style=_valid_recipe().style,
        mode="landscape",
    )

    with pytest.raises(HTTPException) as exc:
        routes._assemble_recipe_prompts(recipe)

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "retired_generation_mode"


def test_create_session_allows_legacy_prompt_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_create_session(session_id: str, **kwargs: object) -> None:
        captured["session_id"] = session_id
        captured.update(kwargs)

    monkeypatch.setattr(routes.S, "create_session", fake_create_session)

    response = routes.create_session(
        routes.CreateSessionRequest(
            scenePrompt="legacy scene prompt",
            dogPrompt="legacy dog prompt",
            style="clean_old_cartoon",
            bgModel=DEFAULT_TEST_MODEL,
            inpaintModel=DEFAULT_TEST_MODEL,
            nDogs=1,
        ),
    )

    assert response["promptContext"]["source"] == "legacy-client-prompts"
    assert response["scenePrompt"] == "legacy scene prompt"
    assert captured["scene_prompt"] == "legacy scene prompt"
    assert captured["dog_prompt"] == "legacy dog prompt"


def test_create_session_rejects_retired_landscape_mode() -> None:
    with pytest.raises(HTTPException) as exc:
        routes.create_session(
            routes.CreateSessionRequest(
                scenePrompt="legacy scene prompt",
                dogPrompt="legacy dog prompt",
                style="clean_old_cartoon",
                bgModel=DEFAULT_TEST_MODEL,
                inpaintModel=DEFAULT_TEST_MODEL,
                nDogs=1,
                mode="landscape",
            ),
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "retired_generation_mode"


def test_create_session_rejects_stale_n_options_field() -> None:
    with pytest.raises(HTTPException) as exc:
        routes.create_session(
            routes.CreateSessionRequest(
                scenePrompt="legacy scene prompt",
                dogPrompt="legacy dog prompt",
                style="clean_old_cartoon",
                bgModel=DEFAULT_TEST_MODEL,
                inpaintModel=DEFAULT_TEST_MODEL,
                nOptions=2,
                nDogs=1,
            ),
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "retired_n_options"


def test_create_session_allows_legacy_single_n_option(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_create_session(session_id: str, **kwargs: object) -> None:
        captured["session_id"] = session_id
        captured.update(kwargs)

    monkeypatch.setattr(routes.S, "create_session", fake_create_session)

    response = routes.create_session(
        routes.CreateSessionRequest(
            scenePrompt="legacy scene prompt",
            dogPrompt="legacy dog prompt",
            style="clean_old_cartoon",
            bgModel=DEFAULT_TEST_MODEL,
            inpaintModel=DEFAULT_TEST_MODEL,
            nOptions=1,
            nDogs=1,
        ),
    )

    assert response["promptContext"]["source"] == "legacy-client-prompts"
    assert captured["scene_prompt"] == "legacy scene prompt"


def test_create_session_rejects_partial_recipe_payload() -> None:
    with pytest.raises(HTTPException) as exc:
        routes.create_session(
            routes.CreateSessionRequest(
                scenePrompt="legacy scene prompt",
                dogPrompt="legacy dog prompt",
                style="clean_old_cartoon",
                bgModel=DEFAULT_TEST_MODEL,
                inpaintModel=DEFAULT_TEST_MODEL,
                nDogs=1,
                setting=_valid_recipe().setting,
            ),
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "invalid_recipe"


def test_scene_variation_api_route_is_retired() -> None:
    response = TestClient(app).post(
        "/api/config/variation",
        json={
            "viewPrompt": "view",
            "stylePrompt": "style",
            "contentPrompt": "content",
        },
    )

    assert response.status_code == 404
