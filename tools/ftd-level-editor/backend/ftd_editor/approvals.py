"""Single-use, expiring Approval Grants for protected FTD actions."""

from __future__ import annotations

import secrets
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from .jobs.store import JobStore, utc_now_iso


class GrantRejected(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(f"approval grant rejected: {reason}")
        self.reason = reason


@dataclass(frozen=True, slots=True)
class ApprovalGrant:
    grant_id: str
    actor: str
    action_kind: str
    request_binding: str
    source_revision: str
    expires_at: str
    minted_at: str


def expected_acknowledgement(action_kind: str, request_binding: str) -> str:
    return f"I approve {action_kind} for {request_binding}"


class ApprovalStore:
    """Mints and atomically consumes grants inside the durable job ledger."""

    def __init__(
        self,
        jobs: JobStore,
        *,
        now: Callable[[], str] = utc_now_iso,
    ) -> None:
        self._jobs = jobs
        self._now = now

    def mint(
        self,
        *,
        actor: str,
        action_kind: str,
        request_binding: str,
        source_revision: str,
        acknowledgement: str,
        ttl_seconds: float = 600.0,
    ) -> ApprovalGrant:
        """Mint one grant; the caller must supply the exact acknowledgement text.

        This gate is deliberate-intent acknowledgement, not proof of a human:
        the acknowledgement is derivable, so any credentialed caller that
        explicitly names the protected action and binding can mint. A genuinely
        human gate requires a distinct approval credential on the human-facing
        surface, owned by a later unit.
        """

        if acknowledgement != expected_acknowledgement(action_kind, request_binding):
            raise GrantRejected("acknowledgement text does not match the protected action")
        if not actor:
            raise GrantRejected("actor is required")
        minted_at = self._now()
        expires_at = (
            datetime.fromisoformat(minted_at) + timedelta(seconds=ttl_seconds)
        ).isoformat()
        grant_id = f"grant-{secrets.token_urlsafe(24)}"
        with self._jobs.transaction() as conn:
            conn.execute(
                """
                INSERT INTO approval_grants (
                    grant_id, actor, action_kind, request_binding, source_revision,
                    acknowledgement, expires_at, minted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    grant_id,
                    actor,
                    action_kind,
                    request_binding,
                    source_revision,
                    acknowledgement,
                    expires_at,
                    minted_at,
                ),
            )
        return ApprovalGrant(
            grant_id=grant_id,
            actor=actor,
            action_kind=action_kind,
            request_binding=request_binding,
            source_revision=source_revision,
            expires_at=expires_at,
            minted_at=minted_at,
        )

    def consume_locked(
        self,
        conn: sqlite3.Connection,
        *,
        grant_id: str,
        actor: str,
        action_kind: str,
        request_binding: str,
        source_revision: str,
    ) -> dict[str, Any]:
        """Atomically consume one grant inside an open ledger transaction."""

        row = conn.execute(
            "SELECT * FROM approval_grants WHERE grant_id = ?", (grant_id,)
        ).fetchone()
        if row is None:
            raise GrantRejected("unknown grant")
        if row["consumed_at"] is not None:
            raise GrantRejected("grant was already consumed")
        if row["actor"] != actor:
            raise GrantRejected("grant is bound to a different actor")
        if row["action_kind"] != action_kind:
            raise GrantRejected("grant is bound to a different protected action")
        if row["request_binding"] != request_binding:
            raise GrantRejected("grant is bound to a different request or digest")
        if row["source_revision"] != source_revision:
            raise GrantRejected("grant is bound to a different source revision")
        now = self._now()
        if datetime.fromisoformat(now) >= datetime.fromisoformat(str(row["expires_at"])):
            raise GrantRejected("grant has expired")
        updated = conn.execute(
            "UPDATE approval_grants SET consumed_at = ? WHERE grant_id = ? AND consumed_at IS NULL",
            (now, grant_id),
        )
        if updated.rowcount != 1:
            raise GrantRejected("grant was already consumed")
        return {"grantId": grant_id, "actor": actor, "consumedAt": now}

    def consumer(
        self,
        *,
        grant_id: str,
        actor: str,
        action_kind: str,
        request_binding: str,
        source_revision: str,
    ) -> Callable[[sqlite3.Connection], dict[str, Any]]:
        def consume(conn: sqlite3.Connection) -> dict[str, Any]:
            return self.consume_locked(
                conn,
                grant_id=grant_id,
                actor=actor,
                action_kind=action_kind,
                request_binding=request_binding,
                source_revision=source_revision,
            )

        return consume
