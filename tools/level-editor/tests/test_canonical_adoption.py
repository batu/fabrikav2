"""BUG-3 fix: sessions adopt the canonical store at the paint boundary
instead of waiting for a manual corpus migration.

`adopt_canonical_if_ready` wraps the single-level migration plan/apply:
- MIGRATION_REQUIRED + plan says migrate  -> applied, level becomes canonical;
- plan says quarantine                    -> applied (loud state, no silent gap);
- any other plan action                   -> no-op (level not ready yet);
- already VALID_CURRENT                   -> no-op, never re-applies.
"""
from types import SimpleNamespace


def _wire(monkeypatch, *, state, plan_action, applied):
    from levelbuilder.api import session as S

    monkeypatch.setattr(
        S, "read_canonical_session",
        lambda _sid: SimpleNamespace(state=state, snapshot=None, pointer=None),
    )
    monkeypatch.setattr(
        "levelbuilder.api.corpus_migration.plan_legacy_level",
        lambda session_dir, public_dir, archived: SimpleNamespace(
            level_id="x", action=plan_action, issues=()),
    )
    monkeypatch.setattr(
        "levelbuilder.api.corpus_migration.apply_level_plan",
        lambda plan, session_dir, journal_root: applied.append(plan.action) or {"action": plan.action},
    )


def test_migrate_ready_session_is_adopted(monkeypatch, tmp_path):
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    applied: list[str] = []
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    _wire(monkeypatch, state=CanonicalReadState.MIGRATION_REQUIRED,
          plan_action="migrate", applied=applied)
    result = S.adopt_canonical_if_ready("some_session")
    assert applied == ["migrate"]
    assert result == "migrate"


def test_quarantine_plan_is_applied_loudly(monkeypatch, tmp_path):
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    applied: list[str] = []
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    _wire(monkeypatch, state=CanonicalReadState.MIGRATION_REQUIRED,
          plan_action="quarantine", applied=applied)
    assert S.adopt_canonical_if_ready("some_session") == "quarantine"
    assert applied == ["quarantine"]


def test_not_ready_plan_is_skipped(monkeypatch, tmp_path):
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    applied: list[str] = []
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    _wire(monkeypatch, state=CanonicalReadState.MIGRATION_REQUIRED,
          plan_action="needs_paint", applied=applied)
    assert S.adopt_canonical_if_ready("some_session") is None
    assert applied == []


def test_valid_current_session_is_never_reapplied(monkeypatch, tmp_path):
    from levelbuilder.api import session as S
    from levelbuilder.api.canonical_bird_contract import CanonicalReadState

    applied: list[str] = []
    monkeypatch.setattr(S, "session_dir", lambda _sid: tmp_path)
    _wire(monkeypatch, state=CanonicalReadState.VALID_CURRENT,
          plan_action="migrate", applied=applied)
    assert S.adopt_canonical_if_ready("some_session") is None
    assert applied == []
