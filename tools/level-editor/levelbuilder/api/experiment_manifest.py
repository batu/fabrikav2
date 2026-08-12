"""P2d.2/P2d.3 — experiment manifest + measured cost.

Every candidate level records WHAT it is (human label, recipe revision+hash,
seed, model, source revision) at generation time, and its cost is MEASURED
from merceka ledger rows tagged with the session (the attribution context) —
never estimated from price sheets. Retires tag-as-provenance
('poststretch', 'deepdive') and the "for the love of god write what I am
looking at" class.
"""
from __future__ import annotations

import json
import time
from typing import Any

from ..recipe import recipe_hash


def _manifest_path(session_id: str):
    from . import session as S

    return S.session_dir(session_id) / "experiment.json"


def record_generation(
    session_id: str,
    *,
    label: str,
    recipe: dict[str, Any],
    seed: int | None,
    model: str,
    source_revision: str | None,
) -> dict[str, Any]:
    manifest = {
        "schemaVersion": 1,
        "label": label,
        "recipeName": recipe.get("name"),
        "recipeHash": recipe_hash(recipe),
        "seed": seed,
        "model": model,
        "sourceRevision": source_revision,
        "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path = _manifest_path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(path)
    return manifest


def read_manifest(session_id: str) -> dict[str, Any] | None:
    path = _manifest_path(session_id)
    if not path.is_file():
        return None
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise ValueError(f"experiment manifest has unsupported shape: {path}")
    return data


def measured_cost(session_id: str) -> dict[str, Any]:
    """Sum the merceka ledger rows tagged with this session. Measured only:
    untagged rows are never guessed into a session."""
    from merceka_core.costs import ledger_path

    total = 0.0
    by_operation: dict[str, float] = {}
    rows = 0
    path = ledger_path()
    if path.is_file():
        for line in path.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            meta = row.get("meta") or {}
            if meta.get("sessionId") != session_id:
                continue
            usd = float(row.get("usd") or 0.0)
            total += usd
            rows += 1
            operation = str(meta.get("operation") or "unattributed")
            by_operation[operation] = round(by_operation.get(operation, 0.0) + usd, 6)
    return {
        "totalUsd": round(total, 6),
        "byOperation": by_operation,
        "rows": rows,
        "measured": True,
    }
