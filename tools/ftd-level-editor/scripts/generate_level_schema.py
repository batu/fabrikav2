#!/usr/bin/env python3
"""Write or check the generated Find the Dog runtime level types."""

from __future__ import annotations

import argparse
from pathlib import Path

from ftd_editor.publishing.level_schema import generate_level_typescript


ROOT = Path(__file__).resolve().parents[3]
TARGET = ROOT / "games/find_the_dog/src/data/generated/levelFile.ts"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = generate_level_typescript()
    if args.check:
        if not TARGET.exists() or TARGET.read_text() != expected:
            print(f"generated level types are stale: {TARGET}")
            return 1
        print(f"generated level types are current: {TARGET}")
        return 0
    TARGET.write_text(expected)
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
