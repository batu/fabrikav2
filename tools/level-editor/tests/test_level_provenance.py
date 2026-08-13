"""Provenance rides IN level.json (operator request 2026-08-13): setting,
scene, recipe axes, models, tags, and the exact prompts — so a level's
identity survives authoring-session deletion (the greenhouse/bakery class:
shipped packages whose session was deleted kept only an id string)."""
import json


def test_build_level_dict_embeds_provenance(monkeypatch, tmp_path):
    from levelbuilder.api import session as S

    monkeypatch.setattr(S, "load_session_raw", lambda _sid: {
        "setting": "uk", "scene": "uk_oxford_college_quad", "entity": "bird",
        "style": "clean_old_cartoon", "scene_prompt": "THE SCENE PROMPT",
        "dog_prompt": "THE ENTITY PROMPT", "bg_model": "google/x",
        "inpaint_model": "google/y", "tags": ["gen:google/x"],
    })
    level = S.build_level_dict("sid_x", [{"x": 1, "y": 2, "r": 3}], width=10, height=10)
    prov = level["provenance"]
    assert prov["setting"] == "uk" and prov["scene"] == "uk_oxford_college_quad"
    assert prov["scenePrompt"] == "THE SCENE PROMPT"
    assert prov["entityPrompt"] == "THE ENTITY PROMPT"
    assert prov["bgModel"] == "google/x" and prov["inpaintModel"] == "google/y"
    assert prov["tags"] == ["gen:google/x"]


def test_build_level_dict_survives_missing_session(monkeypatch):
    from levelbuilder.api import session as S

    monkeypatch.setattr(S, "load_session_raw", lambda _sid: None)
    level = S.build_level_dict("sid_x", [{"x": 1, "y": 2, "r": 3}], width=10, height=10)
    assert "provenance" not in level  # never fabricate; absent beats wrong
