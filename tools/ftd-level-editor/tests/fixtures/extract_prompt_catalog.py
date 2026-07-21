"""One-shot generator for the frozen v1 prompt catalog fixture.

The legacy checkout is accepted only as an explicit input. Target runtime code never
imports or locates it. Run from the Factory2 repository root:

    uv run --project tools/ftd-level-editor python \
      tools/ftd-level-editor/tests/fixtures/extract_prompt_catalog.py \
      --source /path/to/v1/dog_pipeline/utils/prompts.py \
      --output tools/ftd-level-editor/backend/ftd_editor/prompts/catalog.json
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path


NAMES = (
    "MODEL",
    "STYLE",
    "VIEWS",
    "STYLES",
    "SETTINGS",
    "ENTITIES",
    "ENTITY_PROMPT_TEMPLATE",
    "_OLD_PIXEL_ART_ENTITY_PROMPT_TEMPLATE",
    "VARIATION_SYSTEM_PROMPT",
    "LANDSCAPE_PANORAMIC_PREFIX",
)


def extract(source: Path) -> dict[str, object]:
    tree = ast.parse(source.read_text())
    values: dict[str, object] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if isinstance(target, ast.Name) and target.id in NAMES:
            values[target.id] = ast.literal_eval(node.value)
    missing = sorted(set(NAMES) - values.keys())
    if missing:
        raise SystemExit(f"source is missing literal catalog values: {missing}")
    return {name: values[name] for name in NAMES}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = extract(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
