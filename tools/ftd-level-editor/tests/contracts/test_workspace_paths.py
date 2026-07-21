from __future__ import annotations

import errno
import stat
from dataclasses import replace
from pathlib import Path

import pytest

from ftd_editor.fs import (
    FilesystemContractError,
    probe_filesystem_contract,
    resolve_confined,
)
from ftd_editor.settings import EditorSettings, SettingsError, WorkspacePaths


def test_workspace_paths_map_every_operational_authority_to_the_injected_root(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "editor")

    assert paths.authoring == paths.root / "authoring"
    assert paths.public == paths.root / "public"
    assert paths.state == paths.root / "state"
    assert paths.artifacts == paths.root / "artifacts"
    assert paths.cache == paths.root / "cache"
    assert paths.locks == paths.root / "locks"
    assert len(set(paths.operational_roots())) == 6


def test_confined_paths_reject_traversal_absolute_paths_and_symlink_escape(
    tmp_path: Path,
) -> None:
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (root / "escape").symlink_to(outside, target_is_directory=True)

    assert resolve_confined(root, "dogs/dog_00/variant_000.png") == (
        root / "dogs/dog_00/variant_000.png"
    )
    for unsafe in ("../outside", "/absolute", "escape/file.json"):
        with pytest.raises(FilesystemContractError, match="confined"):
            resolve_confined(root, unsafe)


def test_production_rejects_any_git_checkout_or_worktree_root(tmp_path: Path) -> None:
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    (checkout / ".git").write_text("gitdir: /tmp/example\n")

    with pytest.raises(SettingsError, match="Git checkout or worktree"):
        EditorSettings.for_production(checkout / "data")


def test_production_rejects_an_operational_root_inside_a_git_checkout(tmp_path: Path) -> None:
    data_root = tmp_path / "production"
    settings = EditorSettings.for_production(data_root)
    checkout = data_root / "authoring-checkout"
    checkout.mkdir(parents=True)
    (checkout / ".git").write_text("gitdir: /tmp/example\n")

    with pytest.raises(SettingsError, match="production roots"):
        settings.with_workspace(replace(settings.workspace, authoring=checkout))


def test_production_rejects_existing_or_late_operational_symlinks(tmp_path: Path) -> None:
    existing_root = tmp_path / "existing"
    existing_root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (existing_root / "authoring").symlink_to(outside, target_is_directory=True)

    with pytest.raises(SettingsError, match="share one data root"):
        EditorSettings.for_production(existing_root)

    late_root = tmp_path / "late"
    settings = EditorSettings.for_production(late_root)
    late_root.mkdir()
    settings.workspace.authoring.symlink_to(outside, target_is_directory=True)

    with pytest.raises(SettingsError, match="changed through a symlink"):
        settings.workspace.approve_filesystems()


def test_filesystem_probe_checks_locking_rename_and_durable_fsync(
    tmp_path: Path,
) -> None:
    report = probe_filesystem_contract(tmp_path / "approved")

    assert report.locking is True
    assert report.atomic_replace is True
    assert report.file_fsync is True
    assert report.directory_fsync is True


def test_filesystem_probe_fails_closed_when_directory_fsync_is_unsupported(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ftd_editor.fs as filesystem

    real_fsync = filesystem.os.fsync

    def reject_directory_fsync(fd: int) -> None:
        if stat.S_ISDIR(filesystem.os.fstat(fd).st_mode):
            raise OSError(errno.EINVAL, "directory fsync unsupported")
        real_fsync(fd)

    monkeypatch.setattr(filesystem.os, "fsync", reject_directory_fsync)

    with pytest.raises(FilesystemContractError, match="directory fsync"):
        probe_filesystem_contract(tmp_path / "unsupported")


def test_filesystem_probe_fails_closed_when_exclusive_locking_is_broken(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ftd_editor.fs as filesystem

    monkeypatch.setattr(filesystem.fcntl, "flock", lambda *_: None)
    root = tmp_path / "unsupported"

    with pytest.raises(FilesystemContractError, match="two exclusive owners"):
        probe_filesystem_contract(root)

    assert not list(root.glob(".ftd-fs-probe-*"))


def test_filesystem_probe_fails_closed_when_atomic_replace_is_unsupported(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ftd_editor.fs as filesystem

    def reject_replace(_: Path, __: Path) -> None:
        raise OSError(errno.EIO, "replace unsupported")

    monkeypatch.setattr(filesystem.os, "replace", reject_replace)
    root = tmp_path / "unsupported"

    with pytest.raises(FilesystemContractError, match="semantics probe"):
        probe_filesystem_contract(root)

    assert not list(root.glob(".ftd-fs-probe-*"))


def test_filesystem_probe_fails_closed_when_file_fsync_is_unsupported(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ftd_editor.fs as filesystem

    real_fsync = filesystem.os.fsync

    def reject_file_fsync(fd: int) -> None:
        if stat.S_ISREG(filesystem.os.fstat(fd).st_mode):
            raise OSError(errno.EINVAL, "file fsync unsupported")
        real_fsync(fd)

    monkeypatch.setattr(filesystem.os, "fsync", reject_file_fsync)
    root = tmp_path / "unsupported"

    with pytest.raises(FilesystemContractError, match="file fsync"):
        probe_filesystem_contract(root)

    assert not list(root.glob(".ftd-fs-probe-*"))
