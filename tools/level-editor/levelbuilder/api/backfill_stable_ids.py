"""A1 stable-id backfill — stamp a stable per-dog ``id`` into existing sessions.

Plan: docs/plans/2026-06-05-002-feat-ftd-a1-stable-dog-id-verified-spec.md.

Stamps ``id = uuid5(NS, f"{session_id}:dog_{index:02d}")`` (the exact canonical
formula, imported from ``canonical_migration``) into ``session.json`` dogs[] and
``hitboxes.json`` for sessions whose folder<->hitbox geometric binding is
trustworthy. Reuses ``canonical_migration.prepare_migration_session`` for the
rebind + verification, but writes ``session.json`` — it never builds the dormant
LevelStore.

The gate quarantines ONLY on identity-relevant issue codes or a binding
permutation. ``missing_sprite_metadata`` / ``composite_parity_mismatch`` are
completeness/paint issues that do NOT affect identity, so sessions flagged only
with those are stamped (empirically 52 of the 60-session corpus). Quarantined
sessions are left byte-untouched.

Path-based: operates on an arbitrary ``levels_root`` (the real corpus lives in the
main checkout, not the worktree's LEVELS_DIR). Dry-run by default; ``--apply`` writes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from levelbuilder.api import canonical_migration as cm

# Issue codes meaning the folder<->hitbox binding (identity) is untrustworthy.
# These are the EXACT strings emitted by canonical_migration._issue(...) — a typo
# here silently disarms a gate arm (a stamp would then assign a wrong id), so
# test_gate_codes_are_real_emitted_codes pins them against the live emitter.
# NOT included (completeness/paint — identity is still sound, so STAMP):
# missing_sprite_metadata, composite_parity_mismatch.
IDENTITY_UNSAFE_CODES: frozenset[str] = frozenset({
    "orphan_folders",            # a painted folder has no hitbox (deletion shift)
    "unbound_loaded_folders",    # a loaded folder could not bind
    "over_threshold",            # a binding exceeds max_bind_distance (unreliable match)
    "low_confidence_bindings",   # ambiguous nearest-hitbox
    "tied_nearest_hitboxes",     # a folder is equidistant to 2 hitboxes
    "duplicate_bound_folders",   # two folders bound to one hitbox
    "duplicate_bound_hitboxes",  # two hitboxes bound to one folder
    "duplicate_stable_ids",      # id collision
    "missing_dimensions",        # projection failed → cannot verify the binding
})

# Matches the committed-run convention; empirically quarantines exactly the 3
# deletion-shifted sessions + japan_morning_market_dog_60c2 (low_confidence).
DEFAULT_MAX_BIND_DISTANCE = 20.0

# Files the backfill intentionally writes — excluded from the originals-preserved
# immutability guard (which otherwise must catch any mutation of source crops/
# boxes/color.png/bg_*.png).
_WRITTEN_FILES: frozenset[str] = frozenset({"session.json", "hitboxes.json"})


def stable_dog_id(session_id: str, dog_index: int) -> str:
    """The canonical stable id for a dog, byte-identical to a LevelStore projection."""
    return cm._stable_uuid(session_id, cm._public_dog_id(dog_index))


@dataclass(frozen=True)
class SessionVerdict:
    session_id: str
    action: str  # "stamp" | "quarantine" | "skip_already_stamped" | "skip_empty"
    reason: str
    stamped_dogs: int = 0
    issue_codes: list[str] = field(default_factory=list)


@dataclass
class BackfillReport:
    apply: bool
    max_bind_distance: float
    stamped: list[SessionVerdict] = field(default_factory=list)
    quarantined: list[SessionVerdict] = field(default_factory=list)
    skipped: list[SessionVerdict] = field(default_factory=list)
    errored: list[tuple[str, str]] = field(default_factory=list)

    def add(self, verdict: SessionVerdict) -> None:
        bucket = {
            "stamp": self.stamped,
            "quarantine": self.quarantined,
        }.get(verdict.action, self.skipped)
        bucket.append(verdict)


def _binding_is_identity(prepared: cm.PreparedMigrationSession) -> bool:
    """True iff every geometric binding maps folder index == hitbox index.

    A permuted binding (the deletion-shift signature) means a positional id stamp
    would assign the wrong identity, so it must quarantine even if the issue set
    is otherwise clean. The permutation guard is independent of orphan_folders.
    """
    return all(b.dog_index == b.hitbox_index for b in prepared.rebind.bindings)


def _identity_unsafe_codes(prepared: cm.PreparedMigrationSession) -> list[str]:
    return sorted({issue.code for issue in prepared.issues if issue.code in IDENTITY_UNSAFE_CODES})


def _all_stamped(session_dir: Path) -> bool:
    """Idempotency: a session is fully stamped iff every dogs[] entry AND every
    hitbox carries a non-empty ``id``. A partial/mismatched stamp returns False so
    it surfaces (and re-classifies), never a silent overwrite."""
    raw = cm.read_session_json(session_dir)
    dogs = raw.get("dogs") or []
    hitboxes = cm.read_hitboxes(session_dir)
    if not dogs and not hitboxes:
        return False
    dogs_ok = bool(dogs) and all(isinstance(d, dict) and d.get("id") for d in dogs)
    hb_ok = bool(hitboxes) and all(isinstance(h, dict) and h.get("id") for h in hitboxes)
    return dogs_ok and hb_ok


def classify_session(
    session_dir: Path,
    *,
    max_bind_distance: float = DEFAULT_MAX_BIND_DISTANCE,
) -> tuple[cm.PreparedMigrationSession | None, str, str, list[str]]:
    """Return (prepared, action, reason, identity_unsafe_codes).

    action ∈ {stamp, quarantine, skip_already_stamped, skip_empty}.
    """
    if _all_stamped(session_dir):
        return None, "skip_already_stamped", "every dogs[]/hitbox already has an id", []
    prepared = cm.prepare_migration_session(
        session_dir=session_dir, max_bind_distance=max_bind_distance,
    )
    if not prepared.rebind.bindings and not cm.read_hitboxes(session_dir):
        return prepared, "skip_empty", "no hitboxes / no dogs to stamp", []
    unsafe = _identity_unsafe_codes(prepared)
    if unsafe:
        return prepared, "quarantine", f"identity-unsafe issues: {unsafe}", unsafe
    if not _binding_is_identity(prepared):
        return prepared, "quarantine", "binding permuted (folder index != hitbox index)", []
    return prepared, "stamp", "clean identity binding", []


def _atomic_write_json(path: Path, data: object) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w") as handle:
            json.dump(data, handle, indent=2)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _checksum_excluding_written(session_dir: Path) -> dict[str, str]:
    """Checksum the session tree, dropping the files the backfill intends to write,
    so the immutability guard catches mutation of any OTHER (source) file."""
    return {
        rel: digest
        for rel, digest in cm.checksum_tree(session_dir).items()
        if rel not in _WRITTEN_FILES
    }


def stamp_session(session_dir: Path) -> int:
    """Stamp stable ids into session.json dogs[] + hitboxes.json. Returns dogs stamped.

    Asserts no source asset (variant PNGs, *.box.json, color.png, bg_*.png) is
    mutated — only session.json + hitboxes.json change. Stamps by INDEX, which is
    safe ONLY because the caller has verified an identity binding (no permutation,
    no identity-unsafe issues) for this session.
    """
    session_id = session_dir.name
    before = _checksum_excluding_written(session_dir)

    raw = cm.read_session_json(session_dir)
    dogs = raw.get("dogs") or []
    for dog in dogs:
        if isinstance(dog, dict) and "index" in dog and not dog.get("id"):
            dog["id"] = stable_dog_id(session_id, int(dog["index"]))

    hitboxes = cm.read_hitboxes(session_dir)
    for index, hitbox in enumerate(hitboxes):
        if isinstance(hitbox, dict) and not hitbox.get("id"):
            hitbox["id"] = stable_dog_id(session_id, index)

    _atomic_write_json(session_dir / "session.json", raw)
    if hitboxes:
        _atomic_write_json(session_dir / "hitboxes.json", hitboxes)

    after = _checksum_excluding_written(session_dir)
    if before != after:
        changed = sorted(set(before) | set(after))
        mutated = [c for c in changed if before.get(c) != after.get(c)]
        raise RuntimeError(
            f"backfill mutated source assets in {session_id} (must only touch "
            f"session.json/hitboxes.json): {mutated}"
        )
    return sum(1 for d in dogs if isinstance(d, dict) and d.get("id"))


def run_backfill(
    levels_root: Path,
    *,
    apply: bool,
    max_bind_distance: float = DEFAULT_MAX_BIND_DISTANCE,
    quarantine_root: Path | None = None,
    archive_root: Path | None = None,
) -> BackfillReport:
    """Classify every session under ``levels_root``; stamp the trustworthy ones
    (when ``apply``), quarantine the identity-unsafe ones (never touched)."""
    report = BackfillReport(apply=apply, max_bind_distance=max_bind_distance)
    session_dirs = sorted(
        p for p in levels_root.iterdir() if p.is_dir() and not p.name.startswith(".")
    )

    if apply and archive_root is not None:
        # One pre-write immutability archive snapshot of the whole corpus.
        cm.write_pre_migration_archive_snapshot(levels_root, archive_root)

    for session_dir in session_dirs:
        session_id = session_dir.name
        try:
            prepared, action, reason, codes = classify_session(
                session_dir, max_bind_distance=max_bind_distance,
            )
        except Exception as exc:  # noqa: BLE001 — surface a session error without aborting the run
            report.errored.append((session_id, f"{type(exc).__name__}: {exc}"))
            continue

        if action == "stamp":
            stamped = stamp_session(session_dir) if apply else len(prepared.rebind.bindings)
            report.add(SessionVerdict(session_id, "stamp", reason, stamped_dogs=stamped))
        elif action == "quarantine":
            if apply and quarantine_root is not None and prepared is not None:
                cm.write_quarantine_artifact(
                    quarantine_root=quarantine_root,
                    session_dir=session_dir,
                    prepared=prepared,
                )
            report.add(SessionVerdict(session_id, "quarantine", reason, issue_codes=codes))
        else:
            report.add(SessionVerdict(session_id, action, reason))

    return report


def _print_report(report: BackfillReport) -> None:
    mode = "APPLIED" if report.apply else "DRY-RUN (no writes)"
    print(f"[backfill-stable-ids] {mode} @ max_bind_distance={report.max_bind_distance}")
    print(f"  stampable: {len(report.stamped)}  quarantine: {len(report.quarantined)}  "
          f"skipped: {len(report.skipped)}  errored: {len(report.errored)}")
    for v in report.quarantined:
        print(f"  QUARANTINE {v.session_id}: {v.reason}")
    for v in report.skipped:
        print(f"  SKIP       {v.session_id}: {v.reason}")
    for session_id, err in report.errored:
        print(f"  ERROR      {session_id}: {err}")
    total_dogs = sum(v.stamped_dogs for v in report.stamped)
    verb = "stamped" if report.apply else "would stamp"
    print(f"  {verb} {len(report.stamped)} session(s), {total_dogs} dog id(s)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill stable per-dog ids into existing sessions (A1).")
    parser.add_argument("--levels-root", type=Path, required=True,
                        help="Root dir containing session subdirs (e.g. the main checkout's levelbuilder/levels).")
    parser.add_argument("--apply", action="store_true",
                        help="Perform the stamps. Without this flag, dry-run (no writes).")
    parser.add_argument("--max-bind-distance", type=float, default=DEFAULT_MAX_BIND_DISTANCE)
    parser.add_argument("--quarantine-root", type=Path, default=None,
                        help="Where to write quarantine artifacts (only on --apply).")
    parser.add_argument("--archive-root", type=Path, default=None,
                        help="Where to write the pre-migration immutability snapshot (only on --apply).")
    args = parser.parse_args(argv)

    if args.apply and (args.quarantine_root is None or args.archive_root is None):
        parser.error("--apply requires --quarantine-root and --archive-root (safety artifacts).")

    report = run_backfill(
        args.levels_root,
        apply=args.apply,
        max_bind_distance=args.max_bind_distance,
        quarantine_root=args.quarantine_root,
        archive_root=args.archive_root,
    )
    _print_report(report)
    return 1 if report.errored else 0


if __name__ == "__main__":
    sys.exit(main())
