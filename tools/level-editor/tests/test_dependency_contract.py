"""The pinned provider-free gate retains the editor's cost attribution contract."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "editor_dependency_correction",
    Path(__file__).parents[1] / "scripts" / "prepare-dependency.py",
)
correction = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(correction)


def test_exact_dependency_delta_is_idempotent_and_rejects_drift():
    from merceka_core import costs

    patched = Path(costs.__file__).read_bytes()
    assert hashlib.sha256(patched).hexdigest() == correction.AFTER_SHA256
    assert correction.corrected_source(patched) == patched
    original = patched.decode().replace(correction.CONTEXT_VAR, "").replace(correction.ATTRIBUTION, "")
    original = original.replace(
        '    ambient = _attribution_var.get()\n    merged = {**(ambient or {}), **(meta or {})}\n    if merged:\n      row["meta"] = merged',
        '    if meta:\n      row["meta"] = meta',
    ).encode()
    assert hashlib.sha256(original).hexdigest() == correction.BEFORE_SHA256
    assert correction.corrected_source(original) == patched
    with pytest.raises(RuntimeError, match="drifted"):
        correction.corrected_source(original + b"# unknown change\n")


def test_attribution_records_nested_context_and_resets_after_failure(tmp_path, monkeypatch):
    from merceka_core import costs

    ledger = tmp_path / "costs.jsonl"
    monkeypatch.setenv("MERCEKA_COST_LEDGER", str(ledger))
    with pytest.raises(ValueError):
        with costs.attribution({"sessionId": "fixture", "operation": "parent"}):
            with costs.attribution({"birdId": "b1"}):
                costs.record(source="fixture", model="fixture", usage={}, usd=0, meta={"operation": "child"})
                raise ValueError("fixture")
    costs.record(source="fixture", model="fixture", usage={}, usd=0)
    rows = [json.loads(line) for line in ledger.read_text().splitlines()]
    assert rows[0]["meta"] == {"sessionId": "fixture", "birdId": "b1", "operation": "child"}
    assert "meta" not in rows[1]
