"""P2b.4 slice: ONE derived lifecycle state per session
(draft -> needs-review -> approved -> lineup -> published, + archived) with
illegal-combination detection — flags stop being read individually by
consumers, and archiving a session atomically removes it from the draft
lineup."""
import pytest


def test_lifecycle_derivation_ladder():
    from levelbuilder.api.lifecycle import derive_lifecycle_state

    base = {"archived": False, "hitboxesBlessed": False, "cutoutsFinalBlessed": False,
            "catalogUploaded": False, "inLineup": False, "catalogListable": False}
    assert derive_lifecycle_state(base) == "draft"
    assert derive_lifecycle_state({**base, "hitboxesBlessed": True}) == "needs-review"
    approved = {**base, "hitboxesBlessed": True, "cutoutsFinalBlessed": True}
    assert derive_lifecycle_state(approved) == "approved"
    assert derive_lifecycle_state({**approved, "inLineup": True}) == "lineup"
    assert derive_lifecycle_state({**approved, "inLineup": True, "catalogUploaded": True,
                                   "catalogListable": True}) == "published"
    assert derive_lifecycle_state({**approved, "archived": True}) == "archived"


def test_illegal_combinations_are_named():
    from levelbuilder.api.lifecycle import lifecycle_violations

    # Archived but still in the lineup: the exact 08-07 class.
    violations = lifecycle_violations({
        "archived": True, "inLineup": True, "hitboxesBlessed": True,
        "cutoutsFinalBlessed": True, "catalogUploaded": False, "catalogListable": False,
    })
    assert any("archived" in v and "lineup" in v for v in violations)
    # Published without approval: impossible state, must be named.
    violations = lifecycle_violations({
        "archived": False, "inLineup": True, "hitboxesBlessed": False,
        "cutoutsFinalBlessed": False, "catalogUploaded": True, "catalogListable": True,
    })
    assert violations


def test_archiving_removes_session_from_draft_lineup(isolated_session, monkeypatch, tmp_path):
    """P2b.4 operative rule: archive atomically un-lineups the whole session
    ('archive should automatically unline up', 2026-08-07)."""
    import json as _json

    from levelbuilder.api import session as S
    from levelbuilder.api import sequence_workflow as W

    isolated_session.create_session(
        "lifecycle_arch", scene_prompt="s", dog_prompt="d", style="clean_old_cartoon",
        model="m", n_options=1, n_dogs=1,
    )
    calls = {}
    monkeypatch.setattr(S, "_remove_from_sequence_draft",
                        lambda session_id: calls.setdefault("removed", session_id), raising=False)
    S.set_archived("lifecycle_arch", True)
    assert calls.get("removed") == "lifecycle_arch"
