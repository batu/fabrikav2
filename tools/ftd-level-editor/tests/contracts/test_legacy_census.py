from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

import ftd_editor.sessions.legacy_identity as legacy_identity_module
from ftd_editor.sessions.legacy_identity import census_legacy_sessions


def _tree_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _write_session(
    root: Path,
    session_id: str,
    *,
    dogs: list[dict[str, object]],
    hitboxes: list[dict[str, object]],
    centers: list[tuple[int, int]] = (),
    backgrounds: list[dict[str, object]] | None = None,
) -> Path:
    session = root / session_id
    session.mkdir(parents=True)
    payload: dict[str, object] = {"id": session_id, "dogs": dogs}
    if backgrounds is not None:
        payload["backgrounds"] = backgrounds
    (session / "session.json").write_text(json.dumps(payload))
    (session / "hitboxes.json").write_text(json.dumps(hitboxes))
    for index, center in enumerate(centers):
        dog = session / "dogs" / f"dog_{index:02d}"
        dog.mkdir(parents=True)
        (dog / "variant_000.png").write_bytes(b"not-decoded-by-census")
        x, y = center
        (dog / "variant_000.box.json").write_text(
            json.dumps({"box": [x - 2, y - 2, x + 2, y + 2]})
        )
    return session


@pytest.mark.legacy_census
def test_full_census_is_read_only_checksummed_and_classifies_every_shape(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    _write_session(
        root,
        "stable",
        dogs=[{"index": 0, "id": "dog-stable", "activeVariant": 0}],
        hitboxes=[{"id": "dog-stable", "x": 10, "y": 10, "r": 4}],
        centers=[(10, 10)],
        backgrounds=[{"index": 0, "file": "bg_00.png"}],
    )
    (root / "stable" / "bg_00.png").write_bytes(b"background")
    _write_session(
        root,
        "rebindable",
        dogs=[{"index": 0, "activeVariant": 0}],
        hitboxes=[{"x": 20, "y": 20, "r": 4}],
        centers=[(20, 20)],
    )
    _write_session(
        root,
        "ambiguous",
        dogs=[{"index": 0, "activeVariant": 0}],
        hitboxes=[{"x": 8, "y": 10}, {"x": 12, "y": 10}],
        centers=[(10, 10)],
    )
    unsupported = root / "unsupported"
    unsupported.mkdir()
    (unsupported / "session.json").write_text("[]")
    before = _tree_hash(root)

    report = census_legacy_sessions(root, max_bind_distance=50)
    repeated = census_legacy_sessions(root, max_bind_distance=50)

    assert _tree_hash(root) == before
    assert report.source_tree_checksum.startswith("sha256:")
    assert repeated.source_tree_checksum == report.source_tree_checksum
    assert repeated.report_checksum == report.report_checksum
    assert report.report_checksum.startswith("sha256:")
    assert {item.session_id: item.classification for item in report.sessions} == {
        "ambiguous": "ambiguous",
        "rebindable": "rebindable",
        "stable": "stable",
        "unsupported": "unsupported",
    }
    assert report.unexplained_count == 0


@pytest.mark.legacy_census
def test_missing_or_symlinked_referenced_artifact_is_unsupported(tmp_path: Path) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = _write_session(
        root,
        "unsafe",
        dogs=[{"index": 0, "id": "dog-a", "activeVariant": 0}],
        hitboxes=[{"id": "dog-a", "x": 10, "y": 10}],
    )
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"outside")
    dog_dir = session / "dogs" / "dog_00"
    dog_dir.mkdir(parents=True)
    (dog_dir / "variant_000.png").symlink_to(outside)
    (dog_dir / "variant_000.box.json").write_text(json.dumps({"box": [8, 8, 12, 12]}))

    report = census_legacy_sessions(root)

    assert report.sessions[0].classification == "unsupported"
    assert "unsafe_artifact" in report.sessions[0].issue_codes


@pytest.mark.legacy_census
def test_invalid_stable_dog_index_is_classified_without_aborting_corpus(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    _write_session(
        root,
        "broken-index",
        dogs=[{"id": "dog-a", "activeVariant": None}],
        hitboxes=[{"id": "dog-a", "x": 10, "y": 10}],
    )
    _write_session(
        root,
        "valid",
        dogs=[{"index": 0, "id": "dog-b", "activeVariant": None}],
        hitboxes=[{"id": "dog-b", "x": 20, "y": 20}],
    )

    report = census_legacy_sessions(root)

    by_id = {session.session_id: session for session in report.sessions}
    assert by_id["broken-index"].classification == "unsupported"
    assert "unsupported_dog_index" in by_id["broken-index"].issue_codes
    assert by_id["valid"].classification == "stable"
    assert report.unexplained_count == 0


@pytest.mark.legacy_census
def test_malformed_session_still_reports_dog_folder_inventory(tmp_path: Path) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = root / "malformed-inventory"
    live = session / "dogs" / "dog_00"
    tombstone = session / "dogs" / "deleted_dog_01.deadbeef"
    live.mkdir(parents=True)
    tombstone.mkdir()
    (session / "session.json").write_text("[]")
    (session / "hitboxes.json").write_text("[]")

    report = census_legacy_sessions(root)

    item = report.sessions[0]
    assert item.classification == "unsupported"
    assert item.live_dog_folders == ("dog_00",)
    assert item.tombstone_dog_folders == ("deleted_dog_01.deadbeef",)


@pytest.mark.legacy_census
def test_unrecognized_dog_directory_is_not_reported_as_a_tombstone(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = _write_session(
        root,
        "unexpected-folder",
        dogs=[{"index": 0, "id": "dog-a", "activeVariant": 0}],
        hitboxes=[{"id": "dog-a", "x": 10, "y": 10}],
        centers=[(10, 10)],
    )
    (session / "dogs" / "cache").mkdir()

    report = census_legacy_sessions(root)

    item = report.sessions[0]
    assert item.classification == "unsupported"
    assert item.tombstone_dog_folders == ()
    assert "unexpected_dog_folder" in item.issue_codes


@pytest.mark.legacy_census
def test_incomplete_and_symlinked_session_directories_are_explicitly_classified(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    (root / "missing-session-json").mkdir()
    outside = tmp_path / "outside-session"
    outside.mkdir()
    (outside / "session.json").write_text('{"id":"outside"}')
    symlinked = root / "symlinked-session"
    symlinked.symlink_to(outside, target_is_directory=True)
    original_exists = Path.exists

    def reject_target_stat(path: Path) -> bool:
        if path == symlinked:
            raise AssertionError("top-level session symlink target must not be statted")
        return original_exists(path)

    monkeypatch.setattr(Path, "exists", reject_target_stat)

    report = census_legacy_sessions(root)

    assert {
        session.session_id: session.classification for session in report.sessions
    } == {
        "missing-session-json": "unsupported",
        "symlinked-session": "unsupported",
    }
    assert report.unexplained_count == 0


@pytest.mark.legacy_census
def test_rebind_uses_global_minimum_cost_instead_of_greedy_folder_order(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    _write_session(
        root,
        "global-minimum",
        dogs=[
            {"index": 0, "activeVariant": 0},
            {"index": 1, "activeVariant": 0},
        ],
        hitboxes=[{"x": 0, "y": 0}, {"x": 20, "y": 0}],
        centers=[(9, 0), (-10, 0)],
    )

    report = census_legacy_sessions(root, max_bind_distance=100)

    assert report.sessions[0].classification == "ambiguous"
    assert report.sessions[0].bindings == ((0, 1), (1, 0))
    assert "positional_permutation" in report.sessions[0].issue_codes


@pytest.mark.legacy_census
def test_default_rebind_threshold_matches_legacy_identity_gate(tmp_path: Path) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    _write_session(
        root,
        "over-threshold",
        dogs=[{"index": 0, "activeVariant": 0}],
        hitboxes=[{"x": 0, "y": 0}],
        centers=[(21, 0)],
    )

    report = census_legacy_sessions(root)

    assert report.sessions[0].classification == "ambiguous"
    assert "unbound_dog" in report.sessions[0].issue_codes


@pytest.mark.legacy_census
def test_non_finite_hitbox_coordinates_are_unsupported(tmp_path: Path) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    _write_session(
        root,
        "non-finite",
        dogs=[{"index": 0, "activeVariant": 0}],
        hitboxes=[{"x": "nan", "y": 0}],
        centers=[(0, 0)],
    )

    report = census_legacy_sessions(root)

    assert report.sessions[0].classification == "unsupported"
    assert "unsupported_hitbox" in report.sessions[0].issue_codes


@pytest.mark.legacy_census
@pytest.mark.parametrize(
    "box_payload",
    ['{"box":["NaN",0,2,2]}', '{"box":[0,0,"Infinity",2]}'],
)
def test_non_finite_variant_box_is_classified_without_hanging_census(
    tmp_path: Path,
    box_payload: str,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = _write_session(
        root,
        "non-finite-box",
        dogs=[{"index": 0, "activeVariant": 0}],
        hitboxes=[{"x": 0, "y": 0}],
        centers=[(0, 0)],
    )
    (session / "dogs" / "dog_00" / "variant_000.box.json").write_text(box_payload)

    report = census_legacy_sessions(root)

    assert report.sessions[0].classification == "unsupported"
    assert "invalid_variant_box" in report.sessions[0].issue_codes


@pytest.mark.legacy_census
def test_census_inventories_live_tombstone_fallback_and_permuted_bindings(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = _write_session(
        root,
        "inventory",
        dogs=[
            {"index": 0, "activeVariant": 1},
            {"index": 1, "activeVariant": 0},
        ],
        hitboxes=[{"x": 0, "y": 0}, {"x": 20, "y": 0}],
        centers=[(20, 0), (0, 0)],
    )
    (session / "dogs" / "deleted_dog_02.deadbeef").mkdir()

    report = census_legacy_sessions(root, max_bind_distance=100)

    item = report.sessions[0]
    assert item.live_dog_folders == ("dog_00", "dog_01")
    assert item.tombstone_dog_folders == ("deleted_dog_02.deadbeef",)
    assert item.bindings == ((0, 1), (1, 0))
    assert item.binding_provenance[0].box_source == "fallback_variant_000"
    assert "fallback_variant_box" in item.issue_codes
    assert "positional_permutation" in item.issue_codes
    assert item.classification == "ambiguous"


@pytest.mark.legacy_census
def test_census_records_first_available_and_unavailable_folder_provenance(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = _write_session(
        root,
        "fallbacks",
        dogs=[
            {"index": 0, "activeVariant": 7},
            {"index": 1, "activeVariant": 7},
        ],
        hitboxes=[{"x": 10, "y": 10}, {"x": 20, "y": 20}],
    )
    first = session / "dogs" / "dog_00"
    first.mkdir(parents=True)
    (first / "variant_003.png").write_bytes(b"variant-three")
    (first / "variant_003.box.json").write_text('{"box":[8,8,12,12]}')
    (session / "dogs" / "dog_01").mkdir()

    report = census_legacy_sessions(root)

    provenance = {item.dog_index: item for item in report.sessions[0].binding_provenance}
    assert provenance[0].variant_index == 3
    assert provenance[0].box_source == "fallback_first_available"
    assert provenance[1].variant_index == -1
    assert provenance[1].box_source == "unavailable"
    assert "fallback_variant_box" in report.sessions[0].issue_codes
    assert "missing_artifact" in report.sessions[0].issue_codes


@pytest.mark.legacy_census
def test_census_quarantines_folders_that_normalize_to_the_same_dog_index(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = _write_session(
        root,
        "duplicate-folders",
        dogs=[{"index": 0, "id": "dog-a", "activeVariant": 0}],
        hitboxes=[{"id": "dog-a", "x": 10, "y": 10}],
        centers=[(10, 10)],
    )
    duplicate = session / "dogs" / "dog_0"
    duplicate.mkdir()
    (duplicate / "variant_000.png").write_bytes(b"duplicate")
    (duplicate / "variant_000.box.json").write_text('{"box":[8,8,12,12]}')

    report = census_legacy_sessions(root)

    item = report.sessions[0]
    assert item.classification == "ambiguous"
    assert "ambiguous_identity" in item.issue_codes
    assert [source.folder_name for source in item.binding_provenance] == [
        "dog_0",
        "dog_00",
    ]


@pytest.mark.legacy_census
def test_census_classifies_dangling_entries_and_session_id_mismatch(
    tmp_path: Path,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = _write_session(
        root,
        "folder-id",
        dogs=[{"index": 0, "id": "dog-a", "activeVariant": 0}],
        hitboxes=[{"id": "dog-a", "x": 10, "y": 10}],
    )
    (session / "session.json").write_text(
        json.dumps(
            {
                "id": "payload-id",
                "dogs": [{"index": 0, "id": "dog-a", "activeVariant": 0}],
            }
        )
    )
    outside = tmp_path / "outside-dog"
    outside.mkdir()
    (session / "dogs").mkdir()
    (session / "dogs" / "dog_00").symlink_to(outside, target_is_directory=True)
    (root / "dangling-session").symlink_to(tmp_path / "missing-session")

    report = census_legacy_sessions(root)

    by_id = {item.session_id: item for item in report.sessions}
    assert "session_id_mismatch" in by_id["folder-id"].issue_codes
    assert "unsafe_dog_folder" in by_id["folder-id"].issue_codes
    assert by_id["folder-id"].classification == "unsupported"
    assert by_id["dangling-session"].classification == "unsupported"
    assert "unsafe_session_entry" in by_id["dangling-session"].issue_codes


@pytest.mark.legacy_census
def test_artifact_symlink_swap_cannot_escape_session_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    session = _write_session(
        root,
        "swap",
        dogs=[{"index": 0, "id": "dog-a", "activeVariant": 0}],
        hitboxes=[{"id": "dog-a", "x": 10, "y": 10}],
        centers=[(10, 10)],
    )
    artifact = session / "dogs" / "dog_00" / "variant_000.png"
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"outside-secret")
    original_open = legacy_identity_module.os.open
    original_read = legacy_identity_module.os.read
    outside_metadata = outside.stat()
    artifact_open_count = 0

    def swap_before_open(path, flags, mode=0o777, *, dir_fd=None):
        nonlocal artifact_open_count
        if path == "variant_000.png" and dir_fd is not None:
            artifact_open_count += 1
        if path == "variant_000.png" and artifact_open_count == 2:
            artifact.unlink()
            artifact.symlink_to(outside)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    def reject_outside_read(descriptor: int, size: int) -> bytes:
        metadata = os.fstat(descriptor)
        assert (metadata.st_dev, metadata.st_ino) != (
            outside_metadata.st_dev,
            outside_metadata.st_ino,
        )
        return original_read(descriptor, size)

    monkeypatch.setattr(legacy_identity_module.os, "open", swap_before_open)
    monkeypatch.setattr(legacy_identity_module.os, "read", reject_outside_read)

    with pytest.raises(RuntimeError, match="source corpus"):
        census_legacy_sessions(root)

    assert outside.read_bytes() == b"outside-secret"


@pytest.mark.legacy_census
def test_source_checksum_frames_partitions_empty_and_special_entries(
    tmp_path: Path,
) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    (first / "a").write_bytes(b"Xfile\0b\0Y")
    (second / "a").write_bytes(b"X")
    (second / "b").write_bytes(b"Y")

    first_report = census_legacy_sessions(first)
    second_report = census_legacy_sessions(second)
    assert first_report.source_tree_checksum != second_report.source_tree_checksum

    (first / "empty").mkdir()
    with_empty = census_legacy_sessions(first)
    assert with_empty.source_tree_checksum != first_report.source_tree_checksum

    os.mkfifo(first / "operator.fifo")
    with_fifo = census_legacy_sessions(first)
    assert with_fifo.source_tree_checksum != with_empty.source_tree_checksum
