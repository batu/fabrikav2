from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from conftest import CANARY_SECRET, seed_publishing_catalog
from ftd_editor.approvals import ApprovalStore, expected_acknowledgement
from ftd_editor.jobs.store import JobStore
from ftd_editor.publishing.sequence import PublishingService, ScriptedPublisher


def setup(tmp_path, publisher, *, before_finalize=None):
    jobs = JobStore(tmp_path / "state", sanitize=lambda text: text.replace(CANARY_SECRET, "[REDACTED]"))
    approvals = ApprovalStore(jobs)
    public_root = tmp_path / "public"
    seed_publishing_catalog(public_root)
    service = PublishingService(
        public_root=public_root,
        state_root=tmp_path / "publishing-state",
        approvals=approvals,
        publisher=publisher,
        before_finalize=before_finalize,
    )
    candidate = service.prepare(
        sequence_version="seq-1",
        level_ids=("starter", "later"),
        catalog_revision="catalog-1",
        changelog="Ship safely",
        actor="human:batu",
        source_revision="remote-0",
    )
    grant = approvals.mint(
        actor="human:batu",
        action_kind="publish_sequence",
        request_binding=candidate.digest,
        source_revision=candidate.source_revision,
        acknowledgement=expected_acknowledgement("publish_sequence", candidate.digest),
    )
    return service, approvals, candidate, grant


def test_timeout_remains_reconciling_and_restart_uses_exact_readback_without_republish(tmp_path) -> None:
    publisher = ScriptedPublisher(outcomes=["timeout"], readbacks=[None])
    service, approvals, candidate, grant = setup(tmp_path, publisher)
    saga = service.activate(
        candidate.candidate_id, grant.grant_id, "publish-seq-1", remote=True
    )
    assert saga.status == "reconciling"
    assert publisher.publish_calls == 1
    assert service.snapshot().selected is None

    restarted = PublishingService(
        public_root=tmp_path / "public",
        state_root=tmp_path / "publishing-state",
        approvals=approvals,
        publisher=publisher,
    )
    still_pending = restarted.reconcile(saga.saga_id)
    assert still_pending.status == "reconciling"
    assert publisher.publish_calls == 1

    later = restarted.prepare(
        sequence_version="seq-2",
        level_ids=("starter", "later"),
        catalog_revision="catalog-1",
        changelog="Do not race ambiguity",
        actor="human:batu",
        source_revision="remote-0",
    )
    later_grant = approvals.mint(
        actor=later.actor,
        action_kind="publish_sequence",
        request_binding=later.digest,
        source_revision=later.source_revision,
        acknowledgement=expected_acknowledgement("publish_sequence", later.digest),
    )
    with pytest.raises(ValueError, match="reconciliation"):
        restarted.activate(
            later.candidate_id, later_grant.grant_id, "publish-seq-2", remote=True
        )
    assert publisher.publish_calls == 1

    publisher.readbacks.append(publisher.record_for(candidate))
    succeeded = restarted.reconcile(saga.saga_id)
    assert succeeded.status == "succeeded"
    assert publisher.publish_calls == 1
    assert restarted.snapshot().selected.sequence_version == "seq-1"


def test_remote_success_then_local_finalize_crash_recovers_by_readback(tmp_path) -> None:
    crash = {"armed": True}

    def before_finalize():
        if crash["armed"]:
            crash["armed"] = False
            raise OSError("simulated local finalize crash")

    publisher = ScriptedPublisher(outcomes=["success"])
    service, approvals, candidate, grant = setup(
        tmp_path, publisher, before_finalize=before_finalize
    )
    with pytest.raises(OSError, match="finalize crash"):
        service.activate(
            candidate.candidate_id, grant.grant_id, "publish-crash", remote=True
        )
    saga = service.snapshot().sagas[-1]
    assert saga.status == "remote_committed"
    assert service.snapshot().selected is None

    publisher.readbacks.append(publisher.record_for(candidate))
    restarted = PublishingService(
        public_root=tmp_path / "public",
        state_root=tmp_path / "publishing-state",
        approvals=approvals,
        publisher=publisher,
    )
    assert restarted.reconcile(saga.saga_id).status == "succeeded"
    assert publisher.publish_calls == 1


def test_stale_remote_base_does_not_select(tmp_path) -> None:
    publisher = ScriptedPublisher(remote_revision="remote-newer")
    service, _, candidate, grant = setup(tmp_path, publisher)
    with pytest.raises(RuntimeError):
        service.activate(
            candidate.candidate_id, grant.grant_id, "publish-stale", remote=True
        )
    assert service.snapshot().selected is None


def test_secret_bearing_failure_does_not_select_or_leak(tmp_path) -> None:
    publisher = ScriptedPublisher(
        outcomes=[f"error:{CANARY_SECRET}"],
    )
    service, _, candidate, grant = setup(tmp_path, publisher)
    saga = service.activate(
        candidate.candidate_id, grant.grant_id, "publish-ambiguous", remote=True
    )
    assert saga.status == "reconciling"
    snapshot_bytes = (tmp_path / "publishing-state").read_bytes() if (tmp_path / "publishing-state").is_file() else b"".join(
        path.read_bytes() for path in (tmp_path / "publishing-state").rglob("*") if path.is_file()
    )
    assert CANARY_SECRET.encode() not in snapshot_bytes
    assert service.snapshot().selected is None


def test_request_replay_returns_existing_ambiguous_saga_without_republishing(tmp_path) -> None:
    publisher = ScriptedPublisher(outcomes=["timeout"])
    service, _, candidate, grant = setup(tmp_path, publisher)
    first = service.activate(candidate.candidate_id, grant.grant_id, "stable-request", remote=True)
    replay = service.activate(candidate.candidate_id, grant.grant_id, "stable-request", remote=True)
    assert replay == first
    assert replay.status == "reconciling"
    assert publisher.publish_calls == 1


def test_pending_remote_and_local_finalizing_are_restart_recoverable(tmp_path) -> None:
    publisher = ScriptedPublisher(readbacks=[None])
    service, approvals, candidate, _ = setup(tmp_path, publisher)
    pending = service._new_saga(
        candidate,
        request_id="pending-restart",
        action="publish",
        remote=True,
        base_revision=candidate.source_revision,
    )
    assert service.reconcile(pending.saga_id).status == "reconciling"

    pending_path = service._saga_path(pending.saga_id)
    pending_path.unlink()
    local = service._new_saga(
        candidate,
        request_id="local-restart",
        action="publish",
        remote=False,
        base_revision=candidate.source_revision,
    )
    restarted = PublishingService(
        public_root=tmp_path / "public",
        state_root=tmp_path / "publishing-state",
        approvals=approvals,
    )
    assert restarted.reconcile(local.saga_id).status == "succeeded"


def test_activation_revalidates_candidate_against_current_catalog(tmp_path) -> None:
    publisher = ScriptedPublisher()
    service, _, candidate, grant = setup(tmp_path, publisher)
    catalog_path = tmp_path / "public" / "levels" / "catalog-manifest.json"
    catalog = json.loads(catalog_path.read_text())
    catalog["levels"][1]["listable"] = False
    catalog["levels"][1]["tombstonedAt"] = "2026-07-22T00:00:00Z"
    catalog_path.write_text(json.dumps(catalog))
    with pytest.raises(ValueError, match="unavailable"):
        service.activate(candidate.candidate_id, grant.grant_id, "stale-preview", remote=True)
    assert publisher.publish_calls == 0


def test_concurrent_starts_reserve_exactly_one_remote_publication(tmp_path) -> None:
    entered = threading.Event()
    release = threading.Event()

    class BlockingPublisher(ScriptedPublisher):
        def publish(self, candidate):
            entered.set()
            assert release.wait(timeout=2)
            return super().publish(candidate)

    publisher = BlockingPublisher()
    service, approvals, candidate, grant = setup(tmp_path, publisher)
    second = service.prepare(
        sequence_version="seq-2",
        level_ids=("starter", "later"),
        catalog_revision="catalog-1",
        changelog="Competing publication",
        actor="human:batu",
        source_revision="remote-0",
    )
    second_grant = approvals.mint(
        actor=second.actor,
        action_kind="publish_sequence",
        request_binding=second.digest,
        source_revision=second.source_revision,
        acknowledgement=expected_acknowledgement("publish_sequence", second.digest),
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        winner = pool.submit(
            service.activate,
            candidate.candidate_id,
            grant.grant_id,
            "concurrent-winner",
            remote=True,
        )
        assert entered.wait(timeout=2)
        with pytest.raises(ValueError, match="requires reconciliation"):
            service.activate(
                second.candidate_id,
                second_grant.grant_id,
                "concurrent-loser",
                remote=True,
            )
        release.set()
        assert winner.result(timeout=2).status == "succeeded"
    assert publisher.publish_calls == 1
