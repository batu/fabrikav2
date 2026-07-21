from __future__ import annotations

import json
from pathlib import Path

import pytest

from ftd_editor.fs import AtomicBundleStore, BundlePhase, RawBundle


class SimulatedCrash(BaseException):
    pass


def _crash_after(expected: BundlePhase):
    def inject(reached: BundlePhase) -> None:
        if reached == expected:
            raise SimulatedCrash(reached)

    return inject


def _bundle(version: str) -> RawBundle:
    return RawBundle.from_bytes(
        kind="manifest-set",
        members=(
            ("package/color.png", f"image-{version}".encode()),
            ("package/level.json", json.dumps({"version": version}).encode()),
            ("manifest.json", json.dumps({"selected": version}).encode()),
        ),
        metadata={"version": version},
    )


def _publish_initial(store: AtomicBundleStore) -> Path:
    store.publish("public/current", _bundle("old"), bundle_id="old")
    return store.resolve("public/current")


@pytest.mark.parametrize(
    ("phase", "expected"),
    (
        ("staged", "old"),
        ("candidate_installed", "old"),
        ("selector_swapped", "old"),
        ("committed", "new"),
    ),
)
def test_startup_reconciles_deterministic_termination_at_every_install_phase(
    tmp_path: Path,
    phase: BundlePhase,
    expected: str,
) -> None:
    store = AtomicBundleStore(tmp_path / phase)
    old_path = _publish_initial(store)

    with pytest.raises(SimulatedCrash, match=phase):
        store.publish(
            "public/current",
            _bundle("new"),
            bundle_id="new",
            after_phase=_crash_after(phase),
        )

    assert old_path.exists(), "the prior immutable revision is never deleted"
    AtomicBundleStore(tmp_path / phase).recover()
    selected = AtomicBundleStore(tmp_path / phase).resolve("public/current")
    assert json.loads((selected / "manifest.json").read_text())["selected"] == expected


def test_manifest_selection_failure_retains_prior_complete_selection(tmp_path: Path) -> None:
    store = AtomicBundleStore(tmp_path / "store")
    _publish_initial(store)

    with pytest.raises(SimulatedCrash):
        store.publish(
            "public/current",
            _bundle("candidate"),
            bundle_id="candidate",
            after_phase=_crash_after("candidate_installed"),
        )

    selected = store.resolve("public/current")
    assert json.loads((selected / "manifest.json").read_text())["selected"] == "old"
    store.recover()
    assert not (store.bundles_dir / "candidate").exists()


def test_recovery_cleans_stale_staging_without_deleting_committed_bundle(
    tmp_path: Path,
) -> None:
    store = AtomicBundleStore(tmp_path / "store")
    committed = _publish_initial(store)
    stale = store.staging_dir / "abandoned"
    stale.mkdir(parents=True)
    (stale / "partial").write_bytes(b"partial")

    store.recover()

    assert committed.exists()
    assert not stale.exists()


def test_corrupt_recovery_record_fails_closed_without_deleting_bundles(
    tmp_path: Path,
) -> None:
    store = AtomicBundleStore(tmp_path / "store")
    committed = _publish_initial(store)
    store.records_dir.mkdir(parents=True, exist_ok=True)
    (store.records_dir / "corrupt.json").write_text("not-json")

    with pytest.raises(ValueError, match="recovery record"):
        store.recover()

    assert committed.exists()
