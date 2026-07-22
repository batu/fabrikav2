"""U7 legacy identity: stable IDs survive reorder, ambiguity quarantines.

LevelStore is gone; the only legacy authority is the read-only census in
`sessions.legacy_identity`. These fixtures are synthetic, so the checks run
in the default safe suite (the full-corpus census stays behind the
`legacy_census` marker).
"""

from __future__ import annotations

import json
from pathlib import Path

from ftd_editor.sessions.legacy_identity import census_legacy_sessions


def _write_session(
    root: Path,
    session_id: str,
    *,
    dogs: list[dict[str, object]],
    hitboxes: list[dict[str, object]],
) -> None:
    session = root / session_id
    session.mkdir(parents=True)
    (session / "session.json").write_text(json.dumps({"id": session_id, "dogs": dogs}))
    (session / "hitboxes.json").write_text(json.dumps(hitboxes))


def test_stable_identity_survives_dog_reorder(tmp_path: Path) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    hitboxes = [
        {"id": "dog-a", "x": 10, "y": 10, "r": 4},
        {"id": "dog-b", "x": 40, "y": 40, "r": 4},
    ]
    _write_session(
        root,
        "ordered",
        dogs=[
            {"index": 0, "id": "dog-a", "activeVariant": None},
            {"index": 1, "id": "dog-b", "activeVariant": None},
        ],
        hitboxes=hitboxes,
    )
    # Same session content with the dog list order flipped: identity must
    # come from stable IDs, so classification and bindings do not change.
    _write_session(
        root,
        "reordered",
        dogs=[
            {"index": 0, "id": "dog-b", "activeVariant": None},
            {"index": 1, "id": "dog-a", "activeVariant": None},
        ],
        hitboxes=list(reversed(hitboxes)),
    )

    report = census_legacy_sessions(root)
    by_id = {session.session_id: session for session in report.sessions}
    assert by_id["ordered"].classification == "stable"
    assert by_id["reordered"].classification == "stable"
    assert report.unexplained_count == 0


def test_ambiguous_identity_is_quarantined_not_advanced(tmp_path: Path) -> None:
    root = tmp_path / "legacy"
    root.mkdir()
    _write_session(
        root,
        "duplicated",
        dogs=[
            {"index": 0, "id": "dog-a", "activeVariant": None},
            {"index": 1, "id": "dog-a", "activeVariant": None},
        ],
        hitboxes=[{"id": "dog-a", "x": 10, "y": 10, "r": 4}],
    )

    before = sorted(
        (path.relative_to(root).as_posix(), path.read_bytes())
        for path in root.rglob("*")
        if path.is_file()
    )
    report = census_legacy_sessions(root)
    after = sorted(
        (path.relative_to(root).as_posix(), path.read_bytes())
        for path in root.rglob("*")
        if path.is_file()
    )

    assert before == after, "census must be read-only"
    (session,) = report.sessions
    assert session.classification in ("ambiguous", "unsupported")
    assert "duplicate_stable_ids" in session.issue_codes
    assert report.unexplained_count == 0
