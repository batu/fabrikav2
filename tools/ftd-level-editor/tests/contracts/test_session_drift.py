from __future__ import annotations

from pathlib import Path

import pytest

from ftd_editor.sessions.store import SessionRevisionConflict, SessionStore
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
