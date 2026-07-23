"""Real-data rehearsal helpers that never mutate the v1 source authority."""

import shutil
from pathlib import Path

from .cutover import CutoverError, inventory_tree

_RUNNABLE_LEDGERS = frozenset({"jobs.sqlite", "jobs.sqlite-shm", "jobs.sqlite-wal"})


def initialize_clone(source: Path, root: Path) -> None:
    source = source.expanduser().resolve()
    root = root.expanduser().resolve()
    authoring = root / "authoring"
    if authoring.exists():
        return
    root.mkdir(parents=True, exist_ok=True)
    before = inventory_tree(source)
    try:
        shutil.copytree(
            source,
            authoring,
            ignore=lambda _directory, names: sorted(_RUNNABLE_LEDGERS.intersection(names)),
        )
    except Exception:
        shutil.rmtree(authoring, ignore_errors=True)
        raise
    after = inventory_tree(source)
    if before.checksum != after.checksum:
        shutil.rmtree(authoring, ignore_errors=True)
        raise CutoverError("v1 authoring changed during rehearsal snapshot; retry the clone")
