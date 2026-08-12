"""P2d.1 slice: one versioned recipe object describing the CURRENT default
lane without changing it. Deterministic serialization + hash; sessions
without a recipe resolve to the recorded canonical default; UI and CLI
resolve byte-identical effective recipes; dry-run prints a semantic diff and
writes nothing."""
import json

import pytest


def test_default_recipe_is_versioned_and_hash_stable():
    from levelbuilder.recipe import DEFAULT_RECIPE, recipe_hash, serialize_recipe

    assert DEFAULT_RECIPE["schemaVersion"] == 1
    first = serialize_recipe(DEFAULT_RECIPE)
    second = serialize_recipe(json.loads(first))
    assert first == second
    assert recipe_hash(DEFAULT_RECIPE) == recipe_hash(json.loads(first))
    for field in ("models", "dimensions", "placement", "inpaint", "cutout", "export",
                  "variantSlots", "difficultyMix", "birdCount", "paintSize"):
        assert field in DEFAULT_RECIPE, field


def test_sessions_without_recipe_resolve_to_default():
    from levelbuilder.recipe import DEFAULT_RECIPE, recipe_hash, resolve_recipe

    resolved = resolve_recipe(None)
    assert recipe_hash(resolved) == recipe_hash(DEFAULT_RECIPE)

    overridden = resolve_recipe({"recipe": {"birdCount": {"count": 20}}})
    assert overridden["birdCount"]["count"] == 20
    assert overridden["models"] == DEFAULT_RECIPE["models"]
    assert recipe_hash(overridden) != recipe_hash(DEFAULT_RECIPE)


def test_unknown_fields_and_bad_versions_are_loud():
    from levelbuilder.recipe import RecipeError, resolve_recipe

    with pytest.raises(RecipeError, match="unknown recipe field"):
        resolve_recipe({"recipe": {"sprocket": 1}})
    with pytest.raises(RecipeError, match="schemaVersion"):
        resolve_recipe({"recipe": {"schemaVersion": 99}})


def test_dry_run_diff_is_semantic_and_readonly():
    from levelbuilder.recipe import DEFAULT_RECIPE, recipe_diff, resolve_recipe

    changed = resolve_recipe({"recipe": {"birdCount": {"count": 20}}})
    diff = recipe_diff(DEFAULT_RECIPE, changed)
    assert diff == {"birdCount.count": {"from": DEFAULT_RECIPE["birdCount"]["count"], "to": 20}}
    assert recipe_diff(DEFAULT_RECIPE, DEFAULT_RECIPE) == {}


def test_api_and_cli_resolve_byte_identical_recipes(app_client, isolated_session):
    from levelbuilder.recipe import recipe_hash, resolve_recipe
    from levelbuilder.api import session as S

    isolated_session.create_session(
        "recipe_parity", scene_prompt="s", dog_prompt="d", style="clean_old_cartoon",
        model="m", n_options=1, n_dogs=1,
    )
    response = app_client.get("/api/sessions/recipe_parity/recipe")
    assert response.status_code == 200
    body = response.json()
    cli_resolved = resolve_recipe(S.load_session_raw("recipe_parity"))
    assert body["recipe"] == cli_resolved
    assert body["recipeHash"] == recipe_hash(cli_resolved)
    assert body["diffVsDefault"] == {}
