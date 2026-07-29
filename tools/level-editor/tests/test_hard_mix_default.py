"""RED first: the easy/hard mix must default to 0% hard everywhere.

Hard mode camouflages the bird aggressively; as a *default* it produced birds
that read as unfair. The default is now 0 (all easy) and hard is opt-in.
"""

import inspect


def test_api_model_defaults_to_zero_hard():
    from levelbuilder.api.inpaint import CropInpaintJobRequest

    assert CropInpaintJobRequest.model_fields["hardDogPercent"].default == 0


def test_cli_inpaint_defaults_to_zero_hard():
    from levelbuilder.cli.main import build_parser

    parser = build_parser()
    sub = next(a for a in parser._actions if hasattr(a, "choices") and a.choices)
    for verb in ("inpaint", "author"):
        action = next(a for a in sub.choices[verb]._actions if a.dest == "hard_percent")
        assert action.default == 0, f"{verb} still defaults to {action.default}% hard"


def test_ui_client_defaults_to_zero_hard():
    from pathlib import Path

    for rel in ("ui/src/api/editorApi.ts", "ui/src/api/useInpaintStream.ts"):
        source = (Path(__file__).parent.parent / rel).read_text()
        assert "hardDogPercent: number = 30" not in source, f"{rel} still defaults to 30"
