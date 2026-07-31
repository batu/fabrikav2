import json

import pytest
from PIL import Image

from levelbuilder.api.sprite_judge import (
    PROMPT_TEMPLATE,
    SUBJECT_RULE,
    CodexExecJudge,
    JudgeCase,
    JudgeError,
    JudgeVerdict,
    _last_codex_message,
    build_judge_panel,
    make_backend,
    parse_verdict_json,
)


def _case(with_context=True):
    sprite = Image.new("RGBA", (60, 40), (200, 40, 40, 255))
    ctx = Image.new("RGB", (100, 100), (100, 150, 100)) if with_context else None
    return JudgeCase(dog_id="dog_00", sprite=sprite, painted_crop=ctx, clean_crop=ctx)


def test_prompt_carries_subject_rule_verbatim():
    # Guard (mirrors test_no_dog_in_bird_prompts): the product rule for what a
    # pickup sprite is must reach every backend prompt.
    assert SUBJECT_RULE in PROMPT_TEMPLATE
    assert "holding, wearing, or using" in SUBJECT_RULE
    assert "BACKGROUND" in SUBJECT_RULE


def test_panel_contains_three_sections_with_context():
    panel = build_judge_panel(_case())
    assert panel.width > 3 * 60
    assert panel.height == 512 + 24


def test_panel_reduced_input_sprite_only():
    panel = build_judge_panel(_case(with_context=False))
    assert panel.width > 0  # sprite-only panel still builds


def test_parse_verdict_json_happy_path():
    data = parse_verdict_json('noise {"subject": 0.9, "completeness": 0.8, "evidence": "ok"} tail')
    assert data["subject"] == 0.9
    assert data["completeness"] == 0.8


def test_parse_verdict_rejects_out_of_range():
    with pytest.raises(JudgeError):
        parse_verdict_json('{"subject": 3.0, "completeness": 0.5}')


def test_parse_verdict_rejects_missing_fields():
    with pytest.raises(JudgeError):
        parse_verdict_json("no json here")


def test_last_codex_message_extracts_final_text():
    stdout = "\n".join([
        json.dumps({"item": {"type": "reasoning", "text": "thinking"}}),
        json.dumps({"item": {"type": "agent_message", "text": '{"subject":0.1,"completeness":0.2,"evidence":"barrel"}'}}),
    ])
    assert "barrel" in _last_codex_message(stdout)


def test_codex_missing_cli_returns_structured_failure(monkeypatch):
    judge = CodexExecJudge()
    monkeypatch.setenv("PATH", "/nonexistent")
    verdict = judge.judge(_case())
    assert isinstance(verdict, JudgeVerdict)
    assert verdict.ok is False
    assert "not found" in verdict.error


def test_make_backend_unknown_name():
    with pytest.raises(JudgeError):
        make_backend("nope")


def test_stub_backend_contract():
    class Stub:
        name = "stub"

        def judge(self, case):
            return JudgeVerdict(case.dog_id, 1.0, 1.0, "clean bird", "stub")

    verdict = Stub().judge(_case())
    payload = verdict.to_dict()
    assert payload["dogId"] == "dog_00"
    assert payload["ok"] is True
