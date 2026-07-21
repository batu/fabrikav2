from __future__ import annotations

import os
import stat
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

import ftd_editor.sessions.store as session_store_module

from ftd_editor.sessions.model import AuthoringDog
from ftd_editor.sessions.store import (
    SessionAlreadyExists,
    SessionCommitIndeterminate,
    SessionReadError,
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


def test_creation_never_exposes_an_incomplete_final_session_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _store(tmp_path)
    def interrupt_staged_write(target, content, **kwargs):
        assert target.parent.name != "race"
        assert not (store.paths.authoring / "race").exists()
        raise RuntimeError("simulated process interruption before publish")

    with monkeypatch.context() as interruption:
        interruption.setattr(
            session_store_module, "atomic_write_bytes", interrupt_staged_write
        )
        with pytest.raises(RuntimeError, match="simulated process interruption"):
            store.create(_session())

    assert not (store.paths.authoring / "race").exists()
    assert store.create(_session()).session_id == "race"


def test_creation_reports_indeterminate_commit_after_post_rename_fsync_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _store(tmp_path)
    real_fsync = store._fsync_path

    def fail_after_publish(path: Path) -> None:
        if path == store.paths.authoring and (path / "race").exists():
            raise OSError("simulated authoring-directory fsync failure")
        real_fsync(path)

    monkeypatch.setattr(store, "_fsync_path", fail_after_publish)

    with pytest.raises(SessionCommitIndeterminate) as indeterminate:
        store.create(_session())

    assert indeterminate.value.session_id == "race"
    assert store.load("race").session_id == "race"
    with pytest.raises(SessionAlreadyExists):
        store.create(_session())


def test_creation_reports_indeterminate_commit_when_post_rename_reload_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _store(tmp_path)
    real_load = store.load

    def fail_readback(_: str):
        raise SessionReadError("simulated post-rename readback failure")

    with monkeypatch.context() as readback:
        readback.setattr(store, "load", fail_readback)
        with pytest.raises(SessionCommitIndeterminate) as indeterminate:
            store.create(_session())

    assert indeterminate.value.session_id == "race"
    assert real_load("race").session_id == "race"
    with pytest.raises(SessionAlreadyExists):
        store.create(_session())


def test_mutation_reports_indeterminate_commit_after_post_replace_fsync_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _store(tmp_path)
    created = store.create(_session())
    real_fsync = session_store_module.os.fsync
    failed = False

    def fail_first_directory_fsync(descriptor: int) -> None:
        nonlocal failed
        if not failed and stat.S_ISDIR(os.fstat(descriptor).st_mode):
            failed = True
            raise OSError("simulated post-replace directory fsync failure")
        real_fsync(descriptor)

    monkeypatch.setattr(session_store_module.os, "fsync", fail_first_directory_fsync)

    with pytest.raises(SessionCommitIndeterminate):
        store.set_gallery_metadata(
            "race",
            expected_revision=created.revision,
            tags=["committed-before-fsync-failure"],
            archived=None,
        )

    assert failed
    assert store.load("race").session.to_mapping()["tags"] == [
        "committed-before-fsync-failure"
    ]


def test_store_startup_recovers_abandoned_session_creation_stage(tmp_path: Path) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    abandoned = paths.authoring / ".ftd-session-create" / "abandoned"
    abandoned.mkdir(parents=True)
    (abandoned / "session.json").write_text('{"id":"never-published"}')

    SessionStore(paths)

    assert not abandoned.exists()


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


def test_in_place_mutation_callback_is_committed_instead_of_treated_as_noop(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    created = store.create(_session())

    def mutate_in_place(session):
        session.dogs[0].active_variant = 3
        return session

    changed = store.mutate(
        "race",
        expected_revision=created.revision,
        mutation=mutate_in_place,
    )

    assert changed.revision != created.revision
    assert store.load("race").session.to_mapping()["dogs"][0]["activeVariant"] == 3


def test_in_place_append_is_committed_when_source_omitted_defaulted_dogs(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    created = store.create({"id": "omitted-dogs", "future": {"kept": True}})

    def append_dog(session):
        session.dogs.append(AuthoringDog(index=0, id="dog-a"))
        return session

    changed = store.mutate(
        "omitted-dogs",
        expected_revision=created.revision,
        mutation=append_dog,
    )

    assert changed.revision != created.revision
    assert changed.session.to_mapping() == {
        "id": "omitted-dogs",
        "future": {"kept": True},
        "dogs": [{"index": 0, "id": "dog-a"}],
    }
