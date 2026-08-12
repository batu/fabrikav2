"""P1.7 — the artifact DAG, tonight's slice: schema + derived pending state.

The dependency graph (background → scene → hitboxes → crops → cutouts →
export) exists here as one table and ONE derivation: pending_obligations
computes, purely from a canonical snapshot, everything that must happen
before the level may approve/export. No stored duplicate of this state
exists — staleness is derived, never cached (Zen: derived, not authored).

Paid auto-run obligation execution is deliberately NOT here; it lands with
the durable job-store work (P2c). Tonight the DAG only knows, blocks, and
reports.
"""
from __future__ import annotations

from typing import Any

# Ordered artifact chain; edges are implicit between neighbors. Kept as data
# so the obligation table (plan: "the table IS the workflow") extends without
# new control flow.
ARTIFACT_CHAIN: tuple[str, ...] = (
    "background",
    "scene",
    "hitboxes",
    "crops",
    "cutouts",
    "export",
)

REVIEW_KINDS: tuple[str, ...] = ("hitboxes", "finalCutouts")


def pending_obligations(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Everything the level still owes before approval/export, derived from
    the snapshot alone. Ordering follows ARTIFACT_CHAIN."""
    obligations: list[dict[str, Any]] = []

    for bird in snapshot.get("birds", []):
        sprite = bird.get("sprite") or {}
        if not isinstance(sprite.get("asset"), dict):
            obligations.append({
                "obligation": "extract",
                "birdId": bird.get("birdId"),
                "reason": "bird has no cutout sprite",
            })

    reviews = snapshot.get("reviews") or {}
    for kind in REVIEW_KINDS:
        if kind not in reviews:
            history = (snapshot.get("operational") or {}).get("reviewHistory") or []
            invalidated = [
                entry for entry in history
                if isinstance(entry, dict) and entry.get("kind") == kind
            ]
            obligations.append({
                "obligation": f"review:{kind}",
                "reason": (
                    "review invalidated by "
                    + ",".join(sorted({
                        c for entry in invalidated
                        for c in (entry.get("invalidatedBy") or [])
                    }))
                    if invalidated else "never reviewed"
                ),
            })
    return obligations
