from __future__ import annotations

from dataclasses import dataclass

from ftd_editor.jobs.worker import SingleOwnerWorkerLoop


@dataclass
class StubWorker:
    acquired: bool = False
    released: bool = False
    runs: int = 0

    def acquire_ownership(self) -> bool:
        self.acquired = True
        return True

    def release_ownership(self) -> None:
        self.released = True

    def run_once(self) -> bool:
        self.runs += 1
        return False

    def step(self) -> bool:
        return self.run_once()


def test_single_owner_loop_acquires_runs_and_releases() -> None:
    worker = StubWorker()
    loop = SingleOwnerWorkerLoop(worker=worker, poll_seconds=0.001)  # type: ignore[arg-type]
    loop.start()
    loop.stop()
    assert worker.acquired
    assert worker.runs >= 1
    assert worker.released
