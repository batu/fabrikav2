"""O3/O4/O11 — ONE release transaction.

release(): validate -> project bundle -> allocate monotonic releaseRevision ->
build ManifestV2 (artifactDigest) -> upload assets THEN manifest last ->
read back (revision+digest) -> install local files -> editor state. A failed
readback aborts before any local mutation; every release appends to the
server-side release journal; an open break-glass entry refuses release.
"""
import json

import pytest


class FakeRemote:
    """Injectable uploader capturing order; readback serves what was stored."""

    def __init__(self):
        self.uploads: list[str] = []
        self.store: dict[str, bytes] = {}
        self.corrupt_readback = False

    def upload(self, key: str, data: bytes) -> None:
        self.uploads.append(key)
        self.store[key] = data

    def read(self, key: str) -> bytes | None:
        if self.corrupt_readback and key == "manifest.json":
            return b'{"version":2,"releaseRevision":0}'
        return self.store.get(key)


def _service(tmp_path, remote):
    from levelbuilder.api.release_service import ReleaseService

    return ReleaseService(
        state_dir=tmp_path / "state",
        local_manifest_path=tmp_path / "public" / "levels" / "manifest.json",
        remote=remote,
    )


def _request(level_ids=("level_a", "level_b")):
    return {
        "levelIds": list(level_ids),
        "actor": "human:batu",
        "assets": {"assets/a.webp": b"aaa", "assets/b.webp": b"bbb"},
        "entries": [{"id": lid, "bundled": True} for lid in level_ids],
    }


def test_release_orders_assets_before_manifest_and_installs_after_readback(tmp_path):
    remote = FakeRemote()
    service = _service(tmp_path, remote)
    result = service.release(_request())

    assert remote.uploads[-1] == "manifest.json"          # manifest LAST
    assert set(remote.uploads[:-1]) == {"assets/a.webp", "assets/b.webp"}
    local = json.loads((tmp_path / "public" / "levels" / "manifest.json").read_text())
    remote_manifest = json.loads(remote.store["manifest.json"])
    assert local == remote_manifest                        # byte-identical artifact
    assert local["version"] == 2
    assert local["releaseRevision"] == 1
    assert local["artifactDigest"] == result["artifactDigest"]
    assert [level["id"] for level in local["levels"]] == ["level_a", "level_b"]

    second = service.release(_request(("level_b", "level_a")))
    assert second["releaseRevision"] == 2                  # monotonic, never reused


def test_failed_readback_aborts_before_local_install(tmp_path):
    from levelbuilder.api.release_service import ReleaseReadbackError

    remote = FakeRemote()
    remote.corrupt_readback = True
    service = _service(tmp_path, remote)
    with pytest.raises(ReleaseReadbackError):
        service.release(_request())
    assert not (tmp_path / "public" / "levels" / "manifest.json").exists()


def test_open_break_glass_refuses_release_until_reconciled(tmp_path):
    from levelbuilder.api.release_service import BreakGlassOpenError

    remote = FakeRemote()
    service = _service(tmp_path, remote)
    entry = service.open_break_glass(invariant="manual-r2-write", reason="hotfix", actor="human:batu")
    with pytest.raises(BreakGlassOpenError):
        service.release(_request())
    service.reconcile_break_glass(entry["id"], actor="human:batu")
    assert service.release(_request())["releaseRevision"] == 1
    journal = [json.loads(line) for line in (tmp_path / "state" / "release-journal.jsonl").read_text().splitlines()]
    kinds = [row["kind"] for row in journal]
    assert kinds == ["break-glass-open", "break-glass-reconciled", "release"]
