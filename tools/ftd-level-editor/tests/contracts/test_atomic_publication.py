from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from ftd_editor.bundles import ManifestSetPayload, PublicPackagePayload, SessionEditPayload
from ftd_editor.fs import (
    AtomicBundleStore,
    FilesystemContractError,
    RawBundle,
    atomic_write_bytes,
    atomic_write_image,
    atomic_write_json,
    ensure_durable_directory,
)


def test_atomic_bytes_and_json_replace_complete_files_and_match_legacy_bytes(
    tmp_path: Path,
) -> None:
    binary = tmp_path / "asset.bin"
    metadata = tmp_path / "session.json"

    atomic_write_bytes(binary, b"new-bytes")
    atomic_write_json(metadata, {"id": "fixture", "activeVariant": 0})

    assert binary.read_bytes() == b"new-bytes"
    assert metadata.read_bytes() == (
        b'{\n  "id": "fixture",\n  "activeVariant": 0\n}'
    )
    assert hashlib.sha256(metadata.read_bytes()).hexdigest() == (
        "2740e7c205ac66ed90c1bde7c6b13d3121d53df67b24aa8f8d45356b8b52f8e7"
    )


def test_atomic_write_keeps_old_bytes_when_pre_replace_hook_terminates(
    tmp_path: Path,
) -> None:
    target = tmp_path / "current.json"
    target.write_bytes(b"old")

    with pytest.raises(RuntimeError, match="terminate"):
        atomic_write_bytes(
            target,
            b"new",
            before_replace=lambda: (_ for _ in ()).throw(RuntimeError("terminate")),
        )

    assert target.read_bytes() == b"old"
    assert not list(tmp_path.glob(".current.json.*.tmp"))


def test_atomic_write_rejects_cross_filesystem_staging(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ftd_editor.fs as filesystem

    target = tmp_path / "target" / "file.bin"
    staging = tmp_path / "staging"
    real_device_id = filesystem._device_id

    def different_devices(path: Path) -> int:
        if Path(path).resolve() == staging.resolve():
            return 999999
        return real_device_id(path)

    monkeypatch.setattr(filesystem, "_device_id", different_devices)

    with pytest.raises(FilesystemContractError, match="same filesystem"):
        atomic_write_bytes(target, b"payload", staging_dir=staging)


def test_atomic_write_rejects_a_symlink_destination(tmp_path: Path) -> None:
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"old")
    target = tmp_path / "target.bin"
    target.symlink_to(outside)

    with pytest.raises(FilesystemContractError, match="cannot be a symlink"):
        atomic_write_bytes(target, b"new")

    assert outside.read_bytes() == b"old"


def test_atomic_write_rejects_a_symlinked_parent(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    linked_parent = tmp_path / "linked"
    linked_parent.symlink_to(outside, target_is_directory=True)

    with pytest.raises(FilesystemContractError, match="symlink"):
        atomic_write_bytes(linked_parent / "file.bin", b"new")

    assert not (outside / "file.bin").exists()


def test_durable_directory_fsyncs_every_new_parent_entry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ftd_editor.fs as filesystem

    real_fsync_directory = filesystem._fsync_directory
    fsynced: list[Path] = []

    def record_fsync(path: Path) -> None:
        fsynced.append(Path(path))
        real_fsync_directory(path)

    monkeypatch.setattr(filesystem, "_fsync_directory", record_fsync)
    first = tmp_path / "first"
    second = first / "second"
    destination = second / "third"

    assert ensure_durable_directory(destination) == destination

    assert fsynced == [first, tmp_path, second, first, destination, second]


def test_atomic_image_uses_a_sibling_then_publishes_complete_bytes(tmp_path: Path) -> None:
    target = tmp_path / "variant_000.png"

    class ScriptedImage:
        def save(self, path: Path, *, format: str) -> None:
            assert format == "PNG"
            Path(path).write_bytes(b"\x89PNG\r\n\x1a\nfixture")

    atomic_write_image(target, ScriptedImage(), image_format="PNG")

    assert target.read_bytes() == b"\x89PNG\r\n\x1a\nfixture"


def test_raw_bundle_rejects_duplicate_or_escaping_members() -> None:
    with pytest.raises(FilesystemContractError, match="duplicate"):
        RawBundle.from_bytes(
            kind="session-edit",
            members=(("session.json", b"one"), ("session.json", b"two")),
        )

    with pytest.raises(FilesystemContractError, match="confined"):
        RawBundle.from_bytes(kind="session-edit", members=(("../escape", b"bad"),))


def test_selected_bundle_rejects_an_undeclared_symlink(tmp_path: Path) -> None:
    store = AtomicBundleStore(tmp_path / "store")
    published = store.publish(
        "public/current",
        RawBundle.from_bytes(kind="public-package", members=(("level.json", b"{}"),)),
    )
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"outside")
    (published.path / "undeclared.bin").symlink_to(outside)

    with pytest.raises(FilesystemContractError, match="unsafe symlink"):
        store.resolve("public/current")


def test_ftd_raw_bundle_membership_is_explicit_without_typed_session_defaults() -> None:
    session = SessionEditPayload(
        session_json=b'{"activeVariant":null}',
        files={"hitboxes.json": b"[]", "color.png": b"color"},
    ).as_bundle()
    package = PublicPackagePayload(
        level_json=b'{"id":"level-a"}',
        color_png=b"color",
        assets={"bg_00.png": b"background"},
    ).as_bundle()
    manifests = ManifestSetPayload(
        bundled_manifest=b"bundled",
        catalog_manifest=b"catalog",
        levels_index=b"legacy-index",
        catalog_snapshots=(("catalog-000001.json", b"snapshot"),),
    ).as_bundle()

    assert [member.relative_path for member in session.members] == [
        "session.json",
        "hitboxes.json",
        "color.png",
    ]
    assert [member.relative_path for member in package.members] == [
        "level.json",
        "color.png",
        "bg_00.png",
    ]
    assert [member.relative_path for member in manifests.members] == [
        "bundled-manifest.json",
        "catalog-manifest.json",
        "levels-index.json",
        "catalog-snapshots/catalog-000001.json",
    ]
    assert session.members[0].content == b'{"activeVariant":null}'
