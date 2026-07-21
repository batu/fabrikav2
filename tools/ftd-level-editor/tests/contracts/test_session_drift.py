from __future__ import annotations

import errno
import os
from pathlib import Path

import pytest

import ftd_editor.sessions.store as session_store_module
from ftd_editor.sessions.store import (
    SessionNotFound,
    SessionReadError,
    SessionRevisionConflict,
    SessionStore,
)
from ftd_editor.settings import WorkspacePaths


def test_unrelated_direct_filesystem_drift_invalidates_revision_without_overwrite(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    original = store.create(
        {"id": "drift", "dogs": [{"index": 0, "id": "dog-a", "activeVariant": None}]}
    )
    direct = paths.authoring / "drift" / "operator-note.txt"
    direct.write_bytes(b"created outside SessionStore")

    observed = store.load("drift")
    assert observed.revision != original.revision
    with pytest.raises(SessionRevisionConflict) as conflict:
        store.set_dog_active_variant(
            "drift", "dog-a", 0, expected_revision=original.revision
        )

    assert conflict.value.current.revision == observed.revision
    assert direct.read_bytes() == b"created outside SessionStore"
    assert store.load("drift").session.to_mapping()["dogs"][0]["activeVariant"] is None


def test_drift_immediately_before_replace_is_detected_without_overwrite(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    original = store.create(
        {"id": "late-drift", "dogs": [{"index": 0, "id": "dog-a"}]}
    )
    external = paths.authoring / "late-drift" / "operator-note.txt"
    original_atomic_write = SessionStore._atomic_write_session

    def inject_drift(self, directory_fd, content, *, before_replace):
        def drift_then_check() -> None:
            external.write_bytes(b"late direct drift")
            before_replace()

        return original_atomic_write(
            self,
            directory_fd,
            content,
            before_replace=drift_then_check,
        )

    monkeypatch.setattr(SessionStore, "_atomic_write_session", inject_drift)

    with pytest.raises(SessionRevisionConflict):
        store.set_dog_active_variant(
            "late-drift", "dog-a", 0, expected_revision=original.revision
        )

    assert external.read_bytes() == b"late direct drift"
    assert "activeVariant" not in store.load("late-drift").session.to_mapping()["dogs"][0]


def test_symlinked_session_directory_cannot_escape_authoring_root(tmp_path: Path) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "session.json").write_text('{"id":"escaped","dogs":[]}')
    (paths.authoring / "escaped").symlink_to(outside, target_is_directory=True)

    with pytest.raises(SessionNotFound):
        SessionStore(paths).load("escaped")


def test_session_directory_swap_during_open_cannot_read_or_write_outside_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    store.create({"id": "swap", "dogs": []})
    outside = tmp_path / "outside"
    outside.mkdir()
    outside_session = outside / "session.json"
    outside_session.write_text('{"id":"swap","outside":true}')
    original_open = session_store_module.os.open
    swapped = False

    def swap_before_session_open(path, flags, mode=0o777, *, dir_fd=None):
        nonlocal swapped
        if path == "session.json" and dir_fd is not None and not swapped:
            swapped = True
            original = paths.authoring / "swap"
            original.rename(paths.authoring / "swap-detached")
            original.symlink_to(outside, target_is_directory=True)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(session_store_module.os, "open", swap_before_session_open)

    with pytest.raises(SessionNotFound):
        store.load("swap")

    assert outside_session.read_text() == '{"id":"swap","outside":true}'


def test_session_directory_swap_before_replace_cannot_write_outside_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    created = store.create({"id": "swap-write", "dogs": []})
    outside = tmp_path / "outside-write"
    outside.mkdir()
    outside_session = outside / "session.json"
    outside_session.write_text('{"id":"swap-write","outside":true}')
    original_atomic_write = SessionStore._atomic_write_session

    def swap_before_replace(self, directory_fd, content, *, before_replace):
        original = paths.authoring / "swap-write"
        original.rename(paths.authoring / "swap-write-detached")
        original.symlink_to(outside, target_is_directory=True)
        return original_atomic_write(
            self,
            directory_fd,
            content,
            before_replace=before_replace,
        )

    monkeypatch.setattr(SessionStore, "_atomic_write_session", swap_before_replace)

    with pytest.raises(SessionNotFound):
        store.set_gallery_metadata(
            "swap-write",
            expected_revision=created.revision,
            tags=["must-not-escape"],
            archived=None,
        )

    assert outside_session.read_text() == '{"id":"swap-write","outside":true}'


def test_tree_revision_frames_content_and_tracks_empty_and_special_entries(
    tmp_path: Path,
) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    (first / "a").write_bytes(b"Xfile\0b\0Y")
    (second / "a").write_bytes(b"X")
    (second / "b").write_bytes(b"Y")

    first_revision, _ = SessionStore._tree_revision(first)
    second_revision, _ = SessionStore._tree_revision(second)
    assert first_revision != second_revision

    empty = first / "empty"
    empty.mkdir()
    with_empty, _ = SessionStore._tree_revision(first)
    assert with_empty != first_revision

    (first / "linked").symlink_to(second / "a")
    with_symlink, _ = SessionStore._tree_revision(first)
    assert with_symlink != with_empty

    fifo = first / "operator.fifo"
    os.mkfifo(fifo)
    with_fifo, _ = SessionStore._tree_revision(first)
    assert with_fifo != with_symlink


def test_transient_session_read_failure_is_not_reported_as_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    store.create({"id": "io-failure", "dogs": []})
    original_open = session_store_module.os.open

    def fail_session_json(path, flags, mode=0o777, *, dir_fd=None):
        if path == "session.json" and dir_fd is not None:
            raise OSError(errno.EIO, "simulated I/O failure")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(session_store_module.os, "open", fail_session_json)

    with pytest.raises(SessionReadError) as failure:
        store.load("io-failure")

    assert isinstance(failure.value.__cause__, OSError)
    assert failure.value.__cause__.errno == errno.EIO


def test_transient_final_link_check_failure_is_not_reported_as_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    store.create({"id": "io-link", "dogs": []})
    original_stat = session_store_module.os.stat
    checks = 0

    def fail_final_check(path, *args, **kwargs):
        nonlocal checks
        if path == "io-link" and kwargs.get("dir_fd") is not None:
            checks += 1
            if checks == 2:
                raise OSError(errno.EIO, "simulated link-check I/O failure")
        return original_stat(path, *args, **kwargs)

    monkeypatch.setattr(session_store_module.os, "stat", fail_final_check)

    with pytest.raises(SessionReadError) as failure:
        store.load("io-link")

    assert isinstance(failure.value.__cause__, OSError)
    assert failure.value.__cause__.errno == errno.EIO


def test_post_replace_link_check_failure_is_indeterminate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    created = store.create({"id": "post-replace", "dogs": []})
    original_assert = SessionStore._assert_session_link
    checks = 0

    def fail_after_replace(authoring_fd, session_id, opened):
        nonlocal checks
        checks += 1
        if checks == 3:
            error = OSError(errno.EIO, "simulated post-replace I/O failure")
            raise SessionReadError("could not verify published session") from error
        original_assert(authoring_fd, session_id, opened)

    monkeypatch.setattr(
        SessionStore,
        "_assert_session_link",
        staticmethod(fail_after_replace),
    )

    with pytest.raises(session_store_module.SessionCommitIndeterminate) as failure:
        store.set_gallery_metadata(
            "post-replace",
            expected_revision=created.revision,
            tags=["committed"],
            archived=None,
        )

    assert isinstance(failure.value.__cause__, SessionReadError)
    assert isinstance(failure.value.__cause__.__cause__, OSError)
    monkeypatch.setattr(
        SessionStore,
        "_assert_session_link",
        staticmethod(original_assert),
    )
    assert store.load("post-replace").session.to_mapping()["tags"] == ["committed"]


def test_load_retries_when_session_file_inode_changes_during_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    store.create({"id": "inode-retry", "dogs": [], "generation": 0})
    session_path = paths.authoring / "inode-retry" / "session.json"
    original_open = session_store_module.os.open
    swapped = False

    def swap_once(path, flags, mode=0o777, *, dir_fd=None):
        nonlocal swapped
        if path == "session.json" and dir_fd is not None and not swapped:
            swapped = True
            replacement = session_path.with_suffix(".replacement")
            replacement.write_text(
                '{"id":"inode-retry","dogs":[],"generation":1}'
            )
            os.replace(replacement, session_path)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(session_store_module.os, "open", swap_once)

    loaded = store.load("inode-retry")

    assert swapped
    assert loaded.session.to_mapping()["generation"] == 1


def test_continuous_session_file_inode_changes_are_typed_retriable_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    store.create({"id": "inode-churn", "dogs": []})
    session_path = paths.authoring / "inode-churn" / "session.json"
    original_open = session_store_module.os.open
    generation = 0

    def churn(path, flags, mode=0o777, *, dir_fd=None):
        nonlocal generation
        if path == "session.json" and dir_fd is not None:
            generation += 1
            replacement = session_path.with_suffix(f".replacement-{generation}")
            replacement.write_text(
                f'{{"id":"inode-churn","dogs":[],"generation":{generation}}}'
            )
            os.replace(replacement, session_path)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(session_store_module.os, "open", churn)

    with pytest.raises(SessionReadError, match="changed continuously"):
        store.load("inode-churn")
