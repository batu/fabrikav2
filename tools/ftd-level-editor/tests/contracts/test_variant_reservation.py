from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from ftd_editor.sessions.dogs import DogBundlePayload
from ftd_editor.sessions.store import ReservationRejected, SessionStore
from ftd_editor.settings import WorkspacePaths


def _payload(tag: str) -> DogBundlePayload:
    return DogBundlePayload(
        variant_image=f"variant-{tag}".encode(),
        box={"box": [1, 2, 30, 40], "tag": tag},
        sprite_image=f"sprite-{tag}".encode(),
        sprite_metadata={"image": f"sprite-{tag}.png", "tag": tag},
        session_json={"id": "session-a", "activeTag": tag},
        job_artifact=f"artifact-{tag}".encode(),
        job_artifact_name=f"job-{tag}.bin",
    )


def _assert_complete(path: Path, tag: str, variant_index: int) -> None:
    dog = path / "dogs/dog_00"
    assert (dog / f"variant_{variant_index:03d}.png").read_bytes() == f"variant-{tag}".encode()
    assert json.loads((dog / f"variant_{variant_index:03d}.box.json").read_text())["tag"] == tag
    assert (dog / f"sprite_{variant_index:03d}.png").read_bytes() == f"sprite-{tag}".encode()
    assert json.loads((dog / f"sprite_{variant_index:03d}.json").read_text())["tag"] == tag
    assert json.loads((path / "session.json").read_text())["activeTag"] == tag
    assert (path / f"artifacts/job-{tag}.bin").read_bytes() == f"artifact-{tag}".encode()


@pytest.mark.stress
def test_concurrent_same_dog_publications_allocate_distinct_complete_bundles(
    tmp_path: Path,
) -> None:
    paths = WorkspacePaths.below(tmp_path / "workspace")
    paths.prepare()
    store = SessionStore(paths)
    first_inside = threading.Event()
    release_first = threading.Event()

    def publish(tag: str):
        def build(index: int) -> DogBundlePayload:
            if tag == "one":
                first_inside.set()
                assert release_first.wait(timeout=5)
            return _payload(tag)

        return store.publish_dog_bundle(
            "session-a",
            "dog_00",
            build,
            wait_for_reservation=True,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(publish, "one")
        assert first_inside.wait(timeout=5)
        second = pool.submit(publish, "two")
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
    inside = threading.Event()
    release = threading.Event()

    def first_publish():
        def build(_: int) -> DogBundlePayload:
            inside.set()
            assert release.wait(timeout=5)
            return _payload("one")

        return store.publish_dog_bundle("session-a", "dog_00", build)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(first_publish)
        assert inside.wait(timeout=5)
        rejected = pool.submit(
            store.publish_dog_bundle,
            "session-a",
            "dog_00",
            lambda _: _payload("two"),
        )
        with pytest.raises(ReservationRejected, match="already reserved"):
            rejected.result(timeout=5)
        release.set()
        completed = first.result(timeout=5)

    assert completed.variant_index == 0
    _assert_complete(completed.path, "one", 0)
