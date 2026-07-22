from __future__ import annotations

import hashlib

import pytest

from conftest import seed_publishing_catalog
from ftd_editor.approvals import ApprovalStore, expected_acknowledgement
from ftd_editor.jobs.store import JobStore
from ftd_editor.publishing.export import stage_package
from ftd_editor.publishing.sequence import (
    PublishingService,
    RemotePublicationDisabled,
    ScriptedPublisher,
)

def service(tmp_path, *, publisher=None, before_finalize=None):
    jobs = JobStore(tmp_path / "state")
    approvals = ApprovalStore(jobs)
    public_root = tmp_path / "public"
    seed_publishing_catalog(public_root)
    publishing = PublishingService(
        public_root=public_root,
        state_root=tmp_path / "publishing-state",
        approvals=approvals,
        publisher=publisher,
        before_finalize=before_finalize,
    )
    return publishing, approvals


def preview(publishing, version="seq-1"):
    return publishing.prepare(
        sequence_version=version,
        level_ids=("starter", "later"),
        catalog_revision="catalog-1",
        changelog=f"Activate {version}",
        actor="human:batu",
        source_revision="catalog-1",
    )


def grant(approvals, candidate, action="publish_sequence"):
    return approvals.mint(
        actor="human:batu",
        action_kind=action,
        request_binding=candidate.digest,
        source_revision=candidate.source_revision,
        acknowledgement=expected_acknowledgement(action, candidate.digest),
    )


def test_local_or_remote_failure_before_selection_preserves_current_selection(tmp_path) -> None:
    publisher = ScriptedPublisher(outcomes=["reject"])
    publishing, approvals = service(tmp_path, publisher=publisher)
    first = preview(publishing, "seq-0")
    publishing.activate(first.candidate_id, grant(approvals, first).grant_id, remote=False)
    selected_before = publishing.snapshot().selected

    second = preview(publishing, "seq-1")
    with pytest.raises(RuntimeError, match="rejected"):
        publishing.activate(second.candidate_id, grant(approvals, second).grant_id, remote=True)
    assert publishing.snapshot().selected == selected_before


def test_rollback_selects_retained_immutable_candidate_without_rewriting_it(tmp_path) -> None:
    publishing, approvals = service(tmp_path)
    old = preview(publishing, "seq-0")
    publishing.activate(old.candidate_id, grant(approvals, old).grant_id, remote=False)
    old_bytes = publishing.candidate_path(old.candidate_id).read_bytes()

    current = preview(publishing, "seq-1")
    publishing.activate(current.candidate_id, grant(approvals, current).grant_id, remote=False)
    rollback_grant = grant(approvals, old, action="rollback_sequence")
    result = publishing.rollback(old.candidate_id, rollback_grant.grant_id, remote=False)

    assert result.status == "succeeded"
    assert publishing.snapshot().selected.sequence_version == "seq-0"
    assert publishing.candidate_path(old.candidate_id).read_bytes() == old_bytes


def test_remote_publication_fails_closed_without_authenticated_configuration(tmp_path) -> None:
    publishing, approvals = service(tmp_path)
    candidate = preview(publishing)
    with pytest.raises(RemotePublicationDisabled):
        publishing.activate(
            candidate.candidate_id,
            grant(approvals, candidate).grant_id,
            remote=True,
        )
    assert publishing.snapshot().selected is None


def test_candidate_digest_is_canonical_and_changelog_bound(tmp_path) -> None:
    publishing, _ = service(tmp_path)
    candidate = preview(publishing)
    on_disk = publishing.candidate_path(candidate.candidate_id).read_bytes()
    assert candidate.digest == hashlib.sha256(on_disk).hexdigest()
    changed = publishing.prepare(
        sequence_version="seq-1",
        level_ids=("starter", "later"),
        catalog_revision="catalog-1",
        changelog="Different operator intent",
        actor="human:batu",
        source_revision="catalog-1",
    )
    assert changed.digest != candidate.digest


def test_preview_requires_a_valid_catalog_and_rejects_path_shaped_versions(tmp_path) -> None:
    jobs = JobStore(tmp_path / "missing-state")
    missing_catalog = PublishingService(
        public_root=tmp_path / "missing-public",
        state_root=tmp_path / "missing-publishing",
        approvals=ApprovalStore(jobs),
    )
    with pytest.raises(ValueError, match="catalog manifest"):
        preview(missing_catalog)

    publishing, _ = service(tmp_path / "safe")
    with pytest.raises(ValueError, match="sequence version"):
        preview(publishing, "../escape")


def test_package_export_validates_assets_and_reuses_only_identical_immutable_content(
    tmp_path,
) -> None:
    source = tmp_path / "source"
    sprite = source / "dogs" / "dog_00" / "sprite_000.png"
    sprite.parent.mkdir(parents=True)
    (source / "color.webp").write_bytes(b"color")
    sprite.write_bytes(b"sprite")
    (source / "level.json").write_text(
        """{
  "id": "level-01",
  "name": "Level 01",
  "width": 100,
  "height": 200,
  "colorImage": "color.webp",
  "dogs": [{
    "id": "dog_00", "x": 50, "y": 100, "r": 10,
    "sprite": {
      "image": "levels/level-01/dogs/dog_00/sprite_000.png",
      "x": 40, "y": 90, "width": 20, "height": 20,
      "cleanup": {"x": 40, "y": 90, "width": 20, "height": 20}
    }
  }]
}"""
    )

    first = stage_package(source, tmp_path / "packages")
    second = stage_package(source, tmp_path / "packages")
    assert first.package_id == second.package_id
    assert first.path == second.path
    assert (first.path / "package-manifest.json").is_file()

    sprite.unlink()
    with pytest.raises(ValueError, match="missing required asset"):
        stage_package(source, tmp_path / "other-packages")
