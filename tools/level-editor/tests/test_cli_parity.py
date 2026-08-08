"""AE3: every wizard-reachable operation has a mapped CLI verb, and every
mapped verb exists in the parser. The inventory is hand-curated (the parity
claim); this test guards drift in both directions."""

import argparse

from levelbuilder.cli.main import (
    WIZARD_OPERATIONS,
    build_parser,
    cmd_place_sprite,
    cmd_sprite_candidates,
)


def _parser_verbs() -> set[str]:
    parser = build_parser()
    sub = next(a for a in parser._actions if hasattr(a, "choices") and a.choices)
    return set(sub.choices)


def test_every_operation_has_a_real_verb() -> None:
    verbs = _parser_verbs()
    unmapped = {op: verb for op, verb in WIZARD_OPERATIONS.items() if verb not in verbs}
    assert not unmapped, f"operations mapped to nonexistent verbs: {unmapped}"


def test_core_wizard_operations_are_covered() -> None:
    # The five-step wizard flow, gallery, and export must all be present.
    required = {
        "create-session", "background-generation-job", "select-background",
        "upscale-background-job", "auto-hitboxes", "save-hitboxes",
        "inpaint-job", "single-dog-regenerate", "sequence-start-job",
        "selected-cutout-extraction", "selected-cutout-regeneration",
        "list-sprite-candidates", "manual-sprite-placement",
        "get-session", "list-sessions", "prompt-library",
    }
    missing = required - set(WIZARD_OPERATIONS)
    assert not missing, f"wizard operations missing from inventory: {missing}"


class _Client:
    def __init__(self) -> None:
        self.calls = []

    def get(self, path):
        self.calls.append(("GET", path, None))
        return {"candidates": []}

    def request(self, method, path, *, json=None):
        self.calls.append((method, path, json))
        return {"ok": True, "spriteBox": json["spriteBox"]}


def test_sprite_candidate_cli_uses_shared_api(capsys) -> None:
    client = _Client()
    cmd_sprite_candidates(client, argparse.Namespace(session_id="level-a", json=True))
    cmd_place_sprite(client, argparse.Namespace(
        session_id="level-a",
        candidate_id="dog_03:sprite_000",
        box=[10, 20, 70, 90],
        flip_x=True,
        flip_y=None,
        json=True,
    ))

    assert client.calls == [
        ("GET", "/api/sessions/level-a/sprite-candidates", None),
        ("PUT", "/api/sessions/level-a/sprite-candidates/dog_03:sprite_000/placement", {
            "spriteBox": [10, 20, 70, 90], "flipX": True, "flipY": None,
        }),
    ]
    assert '"ok": true' in capsys.readouterr().out
