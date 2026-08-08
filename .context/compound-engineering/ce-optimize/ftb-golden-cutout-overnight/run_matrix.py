from __future__ import annotations

import argparse
import copy
import json
import subprocess
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[4]
EDITOR = ROOT / "tools/level-editor"
BASE_CONFIG = EDITOR / "eval/overnight-hillclimb/candidate.json"
HARNESS = EDITOR / "eval/overnight-hillclimb/measure.py"


def merge(target: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            merge(target[key], value)
        else:
            target[key] = value
    return target


def gates(result: dict[str, Any]) -> bool:
    return (
        result["manifest_valid"] == 1
        and result["wrong_neighbor_jumps"] == 0
        and result["duplicate_target_claims"] == 0
        and result["target_identity_errors"] == 0
        and result["keep_iou"] >= 0.975
        and result["correction_iou"] >= 0.700
    )


def append_jsonl(path: Path, value: dict[str, Any]) -> None:
    with path.open("a") as stream:
        stream.write(json.dumps(value, sort_keys=True) + "\n")
        stream.flush()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    arguments = parser.parse_args()
    matrix = json.loads(arguments.matrix.resolve().read_text())
    base = json.loads(BASE_CONFIG.read_text())
    output_root = arguments.out.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    journal = output_root / "results.jsonl"
    completed = {
        row["name"]
        for row in (json.loads(line) for line in journal.read_text().splitlines())
        if row.get("status") == "measured"
    } if journal.exists() else set()

    for variant in matrix:
        name = variant["name"]
        if name in completed:
            continue
        run_dir = output_root / name
        run_dir.mkdir(parents=True, exist_ok=True)
        config = merge(copy.deepcopy(base), variant["patch"])
        config["name"] = name
        config_path = run_dir / "candidate.json"
        result_path = run_dir / "result.json"
        config_path.write_text(json.dumps(config, indent=2, sort_keys=True) + "\n")
        started = time.monotonic()
        try:
            completed_run = subprocess.run(
                ["uv", "run", "python", str(HARNESS), "--config", str(config_path.resolve())],
                cwd=EDITOR,
                check=True,
                capture_output=True,
                text=True,
                timeout=180,
            )
            result = json.loads(completed_run.stdout)
            result_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
            append_jsonl(journal, {
                "name": name,
                "status": "measured",
                "gates_passed": gates(result),
                "objective_loss": result["objective_loss"],
                "placement_balanced_loss": result["placement_balanced_loss"],
                "correction_iou": result["correction_iou"],
                "keep_iou": result["keep_iou"],
                "wrong_neighbor_jumps": result["wrong_neighbor_jumps"],
                "duplicate_target_claims": result["duplicate_target_claims"],
                "target_identity_errors": result["target_identity_errors"],
                "redo_average_precision": result["redo_average_precision"],
                "runtime_seconds": time.monotonic() - started,
            })
        except (subprocess.SubprocessError, json.JSONDecodeError) as error:
            stderr = getattr(error, "stderr", None)
            append_jsonl(journal, {
                "name": name,
                "status": "error",
                "error": str(error),
                "stderr": stderr,
                "runtime_seconds": time.monotonic() - started,
            })


if __name__ == "__main__":
    main()
