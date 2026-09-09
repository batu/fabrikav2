"""verify-cutouts VLM stage: tolerate concatenated/chatty JSON output."""
import pytest


def test_first_object_wins_over_trailing_data():
    from levelbuilder.cutout_verify import parse_first_json_object

    text = 'Sure: {"birds": [{"id": 0, "verdict": "ship"}]}{"birds": []} trailing'
    assert parse_first_json_object(text) == {"birds": [{"id": 0, "verdict": "ship"}]}


def test_no_object_raises():
    from levelbuilder.cutout_verify import parse_first_json_object

    with pytest.raises(ValueError):
        parse_first_json_object("no json here")


def test_empty_model_content_raises_value_error(monkeypatch, tmp_path):
    from levelbuilder import cutout_verify

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": None}, "finish_reason": "length"}], "usage": {}}

    import httpx
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    monkeypatch.setenv("OPENROUTER_API_KEY", "x")
    sheet = tmp_path / "s.png"
    sheet.write_bytes(b"\x89PNG\r\n\x1a\n")
    with pytest.raises(ValueError):
        cutout_verify.vlm_review_sheet(sheet)
