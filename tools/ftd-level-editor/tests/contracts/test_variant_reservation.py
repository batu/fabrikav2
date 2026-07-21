from __future__ import annotations

import json
import threading
from collections.abc import Iterator, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

import pytest

from ftd_editor.fs import FilesystemContractError
from ftd_editor.sessions.dogs import DogBundlePayload
from ftd_editor.sessions.store import (
    ReservationRejected,
    SessionNotFound,
    SessionRevisionConflict,
    SessionStore,
)
from ftd_editor.settings import WorkspacePaths


def _payload(tag: str, variant_index: int = 0) -> DogBundlePayload:
    return DogBundlePayload(
        variant_image=f"variant-{tag}".encode(),
        box={"box": [1, 2, 30, 40], "tag": tag},
        sprite_image=f"sprite-{tag}".encode(),
        sprite_metadata={"image": f"sprite-{tag}.png", "tag": tag},
        session_json={
            "id": "session-a",
            "dogs": [
                {"index": 0, "id": "dog_00", "activeVariant": variant_index}
            ],
        },
        job_artifact=f"artifact-{tag}".encode(),
        job_artifact_name=f"job-{tag}.bin",
    )


def _assert_complete(path: Path, tag: str, variant_index: int) -> None:
    dog = path / "dogs/dog_00"
    assert (dog / f"variant_{variant_index:03d}.png").read_bytes() == f"variant-{tag}".encode()
    assert json.loads((dog / f"variant_{variant_index:03d}.box.json").read_text())["tag"] == tag
    assert (dog / f"sprite_{variant_index:03d}.png").read_bytes() == f"sprite-{tag}".encode()
    assert json.loads((dog / f"sprite_{variant_index:03d}.json").read_text())["tag"] == tag
    assert json.loads((path / "session.json").read_text())["dogs"][0][
        "activeVariant"
    ] == variant_index
    assert (path / f"artifacts/job-{tag}.bin").read_bytes() == f"artifact-{tag}".encode()


@pytest.mark.stress
def test_concurrent_same_dog_publications_allocate_distinct_complete_bundles(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {"id": "session-a", "dogs": [{"index": 0, "id": "dog_00"}]}
    )
    first_inside = threading.Event()
    release_first = threading.Event()
    second_started = threading.Event()
    second_finished = threading.Event()

    def publish(tag: str):
        def build(index: int) -> DogBundlePayload:
            if tag == "one":
                first_inside.set()
                assert release_first.wait(timeout=5)
            return _payload(tag, index)

        return store.publish_dog_bundle(
            "session-a",
            "dog_00",
            build,
            expected_revision=source.revision,
            wait_for_reservation=True,
        )

    def publish_second():
        second_started.set()
        try:
            return publish("two")
        finally:
            second_finished.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(publish, "one")
        assert first_inside.wait(timeout=5)
        second = pool.submit(publish_second)
        assert second_started.wait(timeout=5)
        assert not second_finished.wait(timeout=0.1)
        release_first.set()
        results = [first.result(timeout=5), second.result(timeout=5)]

    assert sorted(result.variant_index for result in results) == [0, 1]
    for result, tag in zip(results, ("one", "two"), strict=True):
        _assert_complete(result.path, tag, result.variant_index)


@pytest.mark.stress
def test_concurrent_same_dog_can_reject_one_reservation_explicitly(tmp_path: Path) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {"id": "session-a", "dogs": [{"index": 0, "id": "dog_00"}]}
    )
    inside = threading.Event()
    release = threading.Event()

    def first_publish():
        def build(index: int) -> DogBundlePayload:
            inside.set()
            assert release.wait(timeout=5)
            return _payload("one", index)

        return store.publish_dog_bundle(
            "session-a",
            "dog_00",
            build,
            expected_revision=source.revision,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(first_publish)
        assert inside.wait(timeout=5)
        rejected = pool.submit(
            store.publish_dog_bundle,
            "session-a",
            "dog_00",
            lambda index: _payload("two", index),
            expected_revision=source.revision,
        )
        with pytest.raises(ReservationRejected, match="already reserved"):
            rejected.result(timeout=5)
        release.set()
        completed = first.result(timeout=5)

    assert completed.variant_index == 0
    _assert_complete(completed.path, "one", 0)


def test_session_store_approves_filesystem_before_recovery(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    staging = paths.authoring / ".ftd-session-bundles" / ".staging" / "active"
    staging.mkdir(parents=True)
    sentinel = staging / "partial.bin"
    sentinel.write_bytes(b"keep")

    def reject_filesystem(_: WorkspacePaths) -> None:
        raise FilesystemContractError("unsupported filesystem")

    monkeypatch.setattr(WorkspacePaths, "approve_filesystems", reject_filesystem)

    with pytest.raises(FilesystemContractError, match="unsupported filesystem"):
        SessionStore(paths)

    assert sentinel.read_bytes() == b"keep"


def test_dog_bundle_rejects_missing_session_and_nonmember_before_build(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {"id": "session-a", "dogs": [{"index": 0, "id": "dog_00"}]}
    )
    built: list[int] = []

    with pytest.raises(SessionNotFound):
        store.publish_dog_bundle(
            "missing",
            "dog_00",
            lambda index: built.append(index) or _payload("missing"),
            expected_revision=source.revision,
        )
    with pytest.raises(LookupError, match="stable dog id"):
        store.publish_dog_bundle(
            "session-a",
            "dog_99",
            lambda index: built.append(index) or _payload("nonmember"),
            expected_revision=source.revision,
        )

    assert built == []


def test_dog_bundle_rechecks_source_revision_before_selecting_payload(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {"id": "session-a", "dogs": [{"index": 0, "id": "dog_00"}]}
    )

    def build(_: int) -> DogBundlePayload:
        store.set_gallery_metadata(
            "session-a",
            expected_revision=source.revision,
            tags=["changed-during-build"],
            archived=None,
        )
        return _payload("stale")

    with pytest.raises(SessionRevisionConflict):
        store.publish_dog_bundle(
            "session-a",
            "dog_00",
            build,
            expected_revision=source.revision,
        )

    with pytest.raises(FileNotFoundError):
        store.bundles.resolve_manifest("sessions/session-a/dogs/dog_00/current")


@pytest.mark.parametrize(
    ("builder", "error", "message"),
    [
        (lambda: object(), TypeError, "must return DogBundlePayload"),
        (
            lambda: replace(
                _payload("wrong-session"),
                session_json={
                    "id": "other",
                    "dogs": [{"index": 0, "id": "dog_00", "activeVariant": 0}],
                },
            ),
            ValueError,
            "wrong session id",
        ),
        (
            lambda: replace(
                _payload("missing-dog"),
                session_json={"id": "session-a", "dogs": []},
            ),
            LookupError,
            "did not resolve uniquely",
        ),
        (
            lambda: replace(
                _payload("duplicate-dog"),
                session_json={
                    "id": "session-a",
                    "dogs": [
                        {"index": 0, "id": "dog_00"},
                        {"index": 1, "id": "dog_00", "activeVariant": 0},
                    ],
                },
            ),
            LookupError,
            "did not resolve uniquely",
        ),
    ],
)
def test_dog_bundle_rejects_invalid_builder_payload_without_selecting_it(
    tmp_path: Path,
    builder,
    error: type[Exception],
    message: str,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {"id": "session-a", "dogs": [{"index": 0, "id": "dog_00"}]}
    )

    with pytest.raises(error, match=message):
        store.publish_dog_bundle(
            "session-a",
            "dog_00",
            lambda _: builder(),
            expected_revision=source.revision,
        )

    with pytest.raises(FileNotFoundError):
        store.bundles.resolve_manifest("sessions/session-a/dogs/dog_00/current")


def test_dog_bundle_payload_must_select_the_allocated_variant(tmp_path: Path) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {"id": "session-a", "dogs": [{"index": 0, "id": "dog_00"}]}
    )

    with pytest.raises(ValueError, match="select its allocated variant"):
        store.publish_dog_bundle(
            "session-a",
            "dog_00",
            lambda _: replace(
                _payload("mismatch"),
                session_json={
                    "id": "session-a",
                    "dogs": [
                        {"index": 0, "id": "dog_00", "activeVariant": 1}
                    ],
                },
            ),
            expected_revision=source.revision,
        )

    with pytest.raises(FileNotFoundError):
        store.bundles.resolve_manifest("sessions/session-a/dogs/dog_00/current")


def test_dog_bundle_payload_must_preserve_unrelated_source_fields(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {
            "id": "session-a",
            "dogs": [{"index": 0, "id": "dog_00", "futureDog": "kept"}],
            "futureSession": {"kept": True},
        }
    )

    with pytest.raises(ValueError, match="must preserve the source session"):
        store.publish_dog_bundle(
            "session-a",
            "dog_00",
            lambda index: _payload("lossy", index),
            expected_revision=source.revision,
        )

    with pytest.raises(FileNotFoundError):
        store.bundles.resolve_manifest("sessions/session-a/dogs/dog_00/current")


def test_dog_bundle_publishes_the_exact_session_snapshot_it_validated(
    tmp_path: Path,
) -> None:
    class StatefulSessionMapping(Mapping[str, object]):
        def __init__(self) -> None:
            self.iterations = 0

        def _value(self) -> dict[str, object]:
            value: dict[str, object] = {
                "id": "session-a",
                "dogs": [
                    {"index": 0, "id": "dog_00", "activeVariant": 0}
                ],
            }
            if self.iterations > 1:
                value["changedAfterValidation"] = True
            return value

        def __getitem__(self, key: str) -> object:
            return self._value()[key]

        def __iter__(self) -> Iterator[str]:
            self.iterations += 1
            return iter(self._value())

        def __len__(self) -> int:
            return len(self._value())

    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {"id": "session-a", "dogs": [{"index": 0, "id": "dog_00"}]}
    )
    stateful = StatefulSessionMapping()

    published = store.publish_dog_bundle(
        "session-a",
        "dog_00",
        lambda _: replace(_payload("stateful"), session_json=stateful),
        expected_revision=source.revision,
    )

    assert stateful.iterations == 1
    assert json.loads((published.path / "session.json").read_bytes()) == {
        "id": "session-a",
        "dogs": [{"index": 0, "id": "dog_00", "activeVariant": 0}],
    }


def test_waiting_dog_bundle_rechecks_revision_before_running_builder(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    source = store.create(
        {"id": "session-a", "dogs": [{"index": 0, "id": "dog_00"}]}
    )
    started = threading.Event()
    built: list[int] = []

    def publish() -> None:
        started.set()
        store.publish_dog_bundle(
            "session-a",
            "dog_00",
            lambda index: built.append(index) or _payload("stale", index),
            expected_revision=source.revision,
            wait_for_reservation=True,
        )

    with ThreadPoolExecutor(max_workers=1) as pool:
        with store.reserve_dog("session-a", "dog_00"):
            result = pool.submit(publish)
            assert started.wait(timeout=5)
            store.set_gallery_metadata(
                "session-a",
                expected_revision=source.revision,
                tags=["changed-while-queued"],
                archived=None,
            )
        with pytest.raises(SessionRevisionConflict):
            result.result(timeout=5)
    assert built == []
