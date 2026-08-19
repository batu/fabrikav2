#!/usr/bin/env python3
"""Atomically merge protected key/value updates into a mode-local env file."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import stat
import tempfile


ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def absolute_without_resolving(path: Path) -> Path:
    expanded = path.expanduser()
    return expanded if expanded.is_absolute() else Path.cwd() / expanded


def reject_symlink_path(path: Path) -> None:
    current = Path(path.anchor)
    for component in path.parts[1:]:
        current /= component
        if current.is_symlink():
            raise SystemExit(f"protected path must not traverse symlinks: {path.name}")
        if not current.exists():
            break


def protected_regular_file(path: Path, *, allow_missing: bool = False) -> None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        if allow_missing:
            return
        raise SystemExit(f"required protected file is missing: {path.name}") from None
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise SystemExit(f"protected path must be a regular non-symlink file: {path.name}")
    if info.st_uid != os.getuid():
        raise SystemExit(f"protected file must be owned by the current user: {path.name}")
    if info.st_mode & 0o077:
        raise SystemExit(f"protected file must use owner-only permissions: {path.name}")


def load_updates(path: Path) -> dict[str, str]:
    protected_regular_file(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"could not read protected updates: {type(error).__name__}") from None
    if not isinstance(payload, dict) or not payload:
        raise SystemExit("protected updates must be a nonempty JSON object")

    updates: dict[str, str] = {}
    for key, value in payload.items():
        if not isinstance(key, str) or not ENV_KEY.fullmatch(key):
            raise SystemExit("protected updates contain an invalid environment key")
        if not isinstance(value, str) or not value or "\n" in value or "\r" in value:
            raise SystemExit(f"protected update must be a nonempty single-line string: {key}")
        updates[key] = value
    return updates


def merge_lines(original: str, updates: dict[str, str]) -> str:
    seen: set[str] = set()
    output: list[str] = []
    for line in original.splitlines():
        candidate = line.split("=", 1)[0].strip() if "=" in line else ""
        if candidate in updates:
            if candidate not in seen:
                output.append(f"{candidate}={updates[candidate]}")
                seen.add(candidate)
            continue
        output.append(line)
    for key, value in updates.items():
        if key not in seen:
            output.append(f"{key}={value}")
    return "\n".join(output) + "\n"


def write_atomic(target: Path, content: str) -> None:
    reject_symlink_path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    protected_regular_file(target, allow_missing=True)

    descriptor, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        os.chmod(target, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--updates-file", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    target = absolute_without_resolving(args.target)
    updates_file = absolute_without_resolving(args.updates_file)
    reject_symlink_path(updates_file)
    updates = load_updates(updates_file)
    original = target.read_text(encoding="utf-8") if target.exists() else ""
    write_atomic(target, merge_lines(original, updates))
    protected_regular_file(target)
    print(json.dumps({"ok": True, "updated_keys": sorted(updates), "mode": "0600"}))


if __name__ == "__main__":
    main()
