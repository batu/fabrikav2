from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from ftd_editor.sessions.model import AuthoringSession
from ftd_editor.sessions.store import SessionRevisionConflict, SessionStore
from ftd_editor.settings import WorkspacePaths


@pytest.mark.parametrize(
    "raw",
    [
        b'{\n  "id": "old",\n  "unknown": {"nested": [1, null, {"future": true}]},\n  "dogs": [{"index": 0, "activeVariant": null}]\n}\n',
        b'{"id":"missing-dogs","futureField":"kept"}',
        b'{"id":"zero","dogs":[{"index":0,"id":"dog-a","activeVariant":0,"futureDog":{"x":1}}]}',
    ],
)
def test_tolerant_model_noop_roundtrip_is_byte_identical(raw: bytes) -> None:
    session = AuthoringSession.from_bytes(raw)

    assert session.to_bytes() == raw
    assert session.to_mapping()["id"] in {"old", "missing-dogs", "zero"}


def test_model_preserves_missing_versus_null_and_null_versus_zero() -> None:
    missing = AuthoringSession.from_mapping({"id": "missing", "dogs": [{"index": 0}]})
    null = AuthoringSession.from_mapping(
        {"id": "null", "dogs": [{"index": 0, "activeVariant": None}]}
    )
    zero = AuthoringSession.from_mapping(
        {"id": "zero", "dogs": [{"index": 0, "activeVariant": 0}]}
    )

    assert "activeVariant" not in missing.to_mapping()["dogs"][0]
    assert null.to_mapping()["dogs"][0]["activeVariant"] is None
    assert zero.to_mapping()["dogs"][0]["activeVariant"] == 0


def test_in_place_explicit_defaults_are_distinct_from_omitted_fields() -> None:
    missing_variant = AuthoringSession.from_mapping(
        {"id": "variant", "dogs": [{"index": 0}]}
    )
    missing_variant.dogs[0].active_variant = None
    missing_dogs = AuthoringSession.from_mapping({"id": "dogs"})
    missing_dogs.dogs = []

    assert missing_variant.to_mapping()["dogs"][0]["activeVariant"] is None
    assert missing_dogs.to_mapping() == {"id": "dogs", "dogs": []}


def test_model_preserves_coercible_legacy_known_fields_without_retyping() -> None:
    raw = b'{"id":"coercible","dogs":[{"index":"0","id":"dog-a","activeVariant":"0","status":"done"}]}'

    session = AuthoringSession.from_bytes(raw)

    assert session.to_mapping()["dogs"][0] == {
        "index": "0",
        "id": "dog-a",
        "activeVariant": "0",
        "status": "done",
    }
    assert session.to_bytes() == raw


def test_model_rejects_non_object_root_without_repairing_it() -> None:
    with pytest.raises(ValidationError):
        AuthoringSession.from_bytes(b"[]")


def test_store_noop_save_preserves_original_bytes_and_revision(tmp_path: Path) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    raw = b'{\n  "id": "exact",\n  "dogs": [{"index": 0, "activeVariant": null}],\n  "future": 7\n}\n'
    session_dir = paths.authoring / "exact"
    session_dir.mkdir()
    (session_dir / "session.json").write_bytes(raw)

    before = store.load("exact")
    after = store.save("exact", before.session, expected_revision=before.revision)

    assert (session_dir / "session.json").read_bytes() == raw
    assert after.revision == before.revision
    assert json.loads(after.session.to_bytes())["future"] == 7


def test_unrelated_mutation_preserves_coercible_legacy_field_bytes_semantics(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    raw = b'{"id":"coercible-edit","dogs":[{"index":"0","id":"dog-a","activeVariant":"0"}],"tags":[]}'
    session_dir = paths.authoring / "coercible-edit"
    session_dir.mkdir()
    (session_dir / "session.json").write_bytes(raw)

    before = store.load("coercible-edit")
    after = store.set_gallery_metadata(
        "coercible-edit",
        expected_revision=before.revision,
        tags=["reviewed"],
        archived=None,
    )

    dog = after.session.to_mapping()["dogs"][0]
    assert dog["index"] == "0"
    assert dog["activeVariant"] == "0"


def test_public_save_path_rejects_a_stale_revision(tmp_path: Path) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    original = store.create(
        {"id": "save-race", "dogs": [{"index": 0, "id": "dog-a"}]}
    )
    winner = store.set_dog_active_variant(
        "save-race", "dog-a", 0, expected_revision=original.revision
    )

    with pytest.raises(SessionRevisionConflict) as conflict:
        store.save(
            "save-race",
            original.session,
            expected_revision=original.revision,
        )

    assert conflict.value.current.revision == winner.revision
