"""P2d.2/P2d.3: every candidate level carries its experiment manifest —
human label, recipe revision+hash, seed, model, source revision — and its
MEASURED cost (merceka ledger rows tagged with the session; never
estimated)."""
import json


def test_manifest_records_and_reads_back(isolated_session):
    from levelbuilder.api import experiment_manifest as E
    from levelbuilder.recipe import DEFAULT_RECIPE, recipe_hash

    isolated_session.create_session(
        "exp_level", scene_prompt="s", dog_prompt="d", style="clean_old_cartoon",
        model="m", n_options=1, n_dogs=1,
    )
    written = E.record_generation(
        "exp_level", label="magenta-default-A", recipe=DEFAULT_RECIPE,
        seed=1234, model="google/gemini-2.5-flash-image",
        source_revision="sha256:" + "a" * 64,
    )
    manifest = E.read_manifest("exp_level")
    assert manifest["label"] == "magenta-default-A"
    assert manifest["recipeHash"] == recipe_hash(DEFAULT_RECIPE)
    assert manifest["seed"] == 1234
    assert manifest["sourceRevision"] == written["sourceRevision"]
    assert manifest["schemaVersion"] == 1


def test_measured_cost_sums_only_this_sessions_tagged_rows(tmp_path, monkeypatch):
    from levelbuilder.api import experiment_manifest as E

    ledger = tmp_path / "ledger.jsonl"
    rows = [
        {"ts": "t", "source": "s", "model": "m", "usage": {}, "usd": 0.10,
         "meta": {"sessionId": "exp_level", "operation": "dog_regen"}},
        {"ts": "t", "source": "s", "model": "m", "usage": {}, "usd": 0.25,
         "meta": {"sessionId": "exp_level", "operation": "cutout_extraction"}},
        {"ts": "t", "source": "s", "model": "m", "usage": {}, "usd": 9.99,
         "meta": {"sessionId": "other_level"}},
        {"ts": "t", "source": "s", "model": "m", "usage": {}, "usd": 5.00},
    ]
    ledger.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    monkeypatch.setenv("MERCEKA_COST_LEDGER", str(ledger))
    cost = E.measured_cost("exp_level")
    assert cost["totalUsd"] == 0.35
    assert cost["byOperation"] == {"dog_regen": 0.10, "cutout_extraction": 0.25}
    assert cost["measured"] is True
