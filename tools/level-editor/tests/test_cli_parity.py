"""AE3: every wizard-reachable operation has a mapped CLI verb, and every
mapped verb exists in the parser. The inventory is hand-curated (the parity
claim); this test guards drift in both directions."""

from levelbuilder.cli.main import WIZARD_OPERATIONS, build_parser


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
        "get-session", "list-sessions", "prompt-library",
    }
    missing = required - set(WIZARD_OPERATIONS)
    assert not missing, f"wizard operations missing from inventory: {missing}"
