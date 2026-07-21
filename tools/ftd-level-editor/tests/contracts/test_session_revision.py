from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from ftd_editor.sessions.store import (
    SessionAlreadyExists,
    SessionRevisionConflict,
    SessionStore,
)
from ftd_editor.settings import WorkspacePaths


def _store(tmp_path: Path) -> SessionStore:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    return SessionStore(paths)


def _session() -> dict[str, object]:
    return {
        "id": "race",
        "dogs": [
            {"index": 0, "id": "dog-a", "activeVariant": None, "unknown": "kept"}
        ],
        "future": {"nested": True},
    }


def test_new_session_requires_destination_absence_and_returns_initial_revision(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)

    created = store.create(_session())

    assert created.session_id == "race"
    assert created.revision.startswith("sha256:")
    with pytest.raises(SessionAlreadyExists):
        store.create(_session())


def test_two_stale_writers_produce_one_success_and_current_snapshot_conflict(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    original = store.create(_session())

    winner = store.set_dog_active_variant(
        "race", "dog-a", 0, expected_revision=original.revision
    )
    with pytest.raises(SessionRevisionConflict) as rejected:
        store.set_dog_active_variant(
            "race", "dog-a", None, expected_revision=original.revision
        )

    assert winner.revision != original.revision
    assert rejected.value.current.revision == winner.revision
    assert rejected.value.current.session.to_mapping()["dogs"][0]["activeVariant"] == 0
    assert rejected.value.current.session.to_mapping()["future"] == {"nested": True}


def test_concurrent_creation_has_exactly_one_winner(tmp_path: Path) -> None:
    store = _store(tmp_path)

    def create() -> str:
        try:
            return store.create(_session()).revision
        except SessionAlreadyExists:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: create(), range(2)))

    assert outcomes.count("conflict") == 1
    assert sum(value.startswith("sha256:") for value in outcomes) == 1


def test_stale_long_result_keeps_artifact_and_withholds_apply(tmp_path: Path) -> None:
    store = _store(tmp_path)
    original = store.create(_session())
    artifact = store.paths.artifacts / "paid-result.png"
    artifact.write_bytes(b"paid result")
    store.set_dog_active_variant("race", "dog-a", 0, expected_revision=original.revision)

    with pytest.raises(SessionRevisionConflict):
        store.set_dog_active_variant(
            "race", "dog-a", 1, expected_revision=original.revision
        )

    assert artifact.read_bytes() == b"paid result"
    assert store.load("race").session.to_mapping()["dogs"][0]["activeVariant"] == 0


def test_same_explicit_value_is_noop_but_missing_to_null_is_a_mutation(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    created = store.create(
        {"id": "sentinels", "dogs": [{"index": 0, "id": "dog-a"}]}
    )

    added_null = store.set_dog_active_variant(
        "sentinels",
        "dog-a",
        None,
        expected_revision=created.revision,
    )
    unchanged = store.set_dog_active_variant(
        "sentinels",
        "dog-a",
        None,
        expected_revision=added_null.revision,
    )

    assert added_null.revision != created.revision
    assert unchanged.revision == added_null.revision
    assert "activeVariant" in unchanged.session.to_mapping()["dogs"][0]
