"""Regenerate the pinned OpenAPI document and derived TypeScript wire types."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOL_ROOT / "backend"))

from ftd_editor.contracts import (  # noqa: E402
    generated_typescript_bytes,
    openapi_bytes,
    openapi_document,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    openapi_target = TOOL_ROOT / "openapi.json"
    generated = TOOL_ROOT / "ui" / "src" / "api" / "generated.ts"
    document = openapi_document()
    expected_openapi = openapi_bytes(document)
    expected_typescript = generated_typescript_bytes(document)
    if args.check:
        stale = [
            path
            for path, expected in (
                (openapi_target, expected_openapi),
                (generated, expected_typescript),
            )
            if not path.exists() or path.read_bytes() != expected
        ]
        if stale:
            raise SystemExit("contract drift: " + ", ".join(str(path) for path in stale))
        print("OpenAPI and generated editor types are current")
        return
    openapi_target.write_bytes(expected_openapi)
    generated.parent.mkdir(parents=True, exist_ok=True)
    generated.write_bytes(expected_typescript)
    print(f"wrote {openapi_target}")
    print(f"wrote {generated}")


if __name__ == "__main__":
    main()
