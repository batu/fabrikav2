from __future__ import annotations

from pathlib import Path

import pytest

import ftd_editor.sessions.store as session_store_module
from ftd_editor.sessions.store import (
    SessionNotFound,
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
    original_atomic_write = session_store_module.atomic_write_bytes

    def inject_drift(target, content, *, staging_dir=None, before_replace=None):
        def drift_then_check() -> None:
            external.write_bytes(b"late direct drift")
            assert before_replace is not None
            before_replace()

        return original_atomic_write(
            target,
            content,
            staging_dir=staging_dir,
            before_replace=drift_then_check,
        )

    monkeypatch.setattr(session_store_module, "atomic_write_bytes", inject_drift)

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
