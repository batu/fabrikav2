"""P2b.4 — one lifecycle state machine (derived slice).

`draft → needs-review → approved → lineup → published`, plus `archived`.
The state is DERIVED from the flags the system already stores — consumers
read one state instead of re-interpreting flag combinations, and
`lifecycle_violations` names every illegal combination so the reconciliation
panel can show them instead of the gallery silently disagreeing with itself
(the 2026-08-07 "archived but still lined up" class).
"""
from __future__ import annotations

from typing import Any

STATES = ("draft", "needs-review", "approved", "lineup", "published", "archived")


def derive_lifecycle_state(flags: dict[str, Any]) -> str:
    if flags.get("archived") is True:
        return "archived"
    approved = bool(flags.get("hitboxesBlessed")) and bool(flags.get("cutoutsFinalBlessed"))
    if approved and flags.get("catalogUploaded") and flags.get("catalogListable"):
        return "published"
    if approved and flags.get("inLineup"):
        return "lineup"
    if approved:
        return "approved"
    if flags.get("hitboxesBlessed"):
        return "needs-review"
    return "draft"


def lifecycle_violations(flags: dict[str, Any]) -> list[str]:
    """Illegal flag combinations, named for the reconciliation surface."""
    violations: list[str] = []
    approved = bool(flags.get("hitboxesBlessed")) and bool(flags.get("cutoutsFinalBlessed"))
    if flags.get("archived") and flags.get("inLineup"):
        violations.append("archived session is still in the lineup (archive must un-lineup atomically)")
    if flags.get("catalogListable") and not approved:
        violations.append("published/listable without current hitbox+cutout approval")
    if flags.get("inLineup") and not approved and not flags.get("archived"):
        violations.append("in the lineup without current approval")
    return violations
