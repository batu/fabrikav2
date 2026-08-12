"""Rollback converter (merge-review F3).

Post-merge code may commit snapshots containing PRE-EXTRACTION birds
(hitbox-only, no sprite/generation/cleanup — the CL-3 add lane). The
pre-merge validator requires all three, so rolling the code back would
classify such sessions as quarantined_integrity. Running this script BEFORE a
rollback deletes those draft birds through the geometry service (one CAS
commit per session, R6-style itemized output), restoring old-validator
compatibility. Draft birds are hitbox-only sketches; losing them on rollback
is the explicit, accepted cost.

Usage: uv run python scripts/rollback_spriteless_birds.py [--apply]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="delete draft birds (default: report only)")
    args = parser.parse_args()

    from levelbuilder.api import session as S
    from levelbuilder.api.geometry_service import mutate_geometry

    affected = 0
    for session_dir in sorted(S.LEVELS_DIR.iterdir()):
        if not session_dir.is_dir():
            continue
        current = S.read_canonical_session(session_dir.name)
        if current.snapshot is None:
            continue
        drafts = [b["birdId"] for b in current.snapshot["birds"] if not (b.get("sprite") or {}).get("asset")]
        if not drafts:
            continue
        affected += 1
        print(f"{session_dir.name}: {len(drafts)} draft bird(s): {drafts}")
        if args.apply:
            mutate_geometry(
                session_dir.name,
                "delete",
                bird_ids=drafts,
                expected_content_revision=current.pointer.content_revision,
                actor="human:rollback-converter",
            )
            print(f"{session_dir.name}: deleted")
    print(f"{affected} session(s) with draft birds{' (deleted)' if args.apply else ' (dry run — use --apply)'}")


if __name__ == "__main__":
    main()
