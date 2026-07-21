"""Regenerate the pinned OpenAPI document and derived TypeScript wire types."""

from __future__ import annotations

import sys
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOL_ROOT / "backend"))

from ftd_editor.contracts import generated_typescript_bytes, openapi_bytes  # noqa: E402


def main() -> None:
    (TOOL_ROOT / "openapi.json").write_bytes(openapi_bytes())
    generated = TOOL_ROOT / "ui" / "src" / "api" / "generated.ts"
    generated.parent.mkdir(parents=True, exist_ok=True)
    generated.write_bytes(generated_typescript_bytes())
    print(f"wrote {TOOL_ROOT / 'openapi.json'}")
    print(f"wrote {generated}")


if __name__ == "__main__":
    main()
