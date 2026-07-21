from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

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

    assert _tree_hash(root) == before
    assert report.source_tree_checksum == f"sha256:{before}"
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
