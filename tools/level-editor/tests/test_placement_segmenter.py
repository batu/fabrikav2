import io
import json

import pytest

from levelbuilder.api import placement_segmenter
from levelbuilder.api.placement_segmenter import Sam3Process, SegmenterUnavailable


def _worker(monkeypatch, *, wrong_id=False, timeout=False):
    class Process:
        def __init__(self):
            self.stdin = io.StringIO()
            self.stdout = self
            self.closed = False
            self.started = False
            self.returncode = None

        def readline(self):
            if not self.started:
                self.started = True
                return json.dumps({"model": "SAM3", "checkpointSha256": "test"}) + "\n"
            request = json.loads(self.stdin.getvalue().splitlines()[-1])
            return (
                json.dumps(
                    {
                        "requestId": "wrong" if wrong_id else request["requestId"],
                        "shape": [1, 2, 2],
                    }
                )
                + "\n"
            )

        def wait(self, timeout=None):
            self.returncode = 0
            return 0

        def poll(self):
            return self.returncode

        def close(self):
            self.closed = True

    process = Process()
    monkeypatch.setattr(
        placement_segmenter.subprocess, "Popen", lambda *args, **kwargs: process
    )
    monkeypatch.setattr(
        placement_segmenter.select,
        "select",
        lambda *args: (
            ([], [], []) if timeout and process.started else ([process], [], [])
        ),
    )
    return "fake-worker"


def test_rejects_response_for_another_request(monkeypatch):
    command = _worker(monkeypatch, wrong_id=True)
    with Sam3Process(command) as worker:
        with pytest.raises(SegmenterUnavailable, match="does not match"):
            worker.predict({"image_png_b64": "test"})
        with pytest.raises(SegmenterUnavailable, match="unusable"):
            worker.predict({"image_png_b64": "next"})
        assert worker.process.poll() is not None


def test_timeout_cannot_assign_late_mask_to_next_bird(monkeypatch):
    command = _worker(monkeypatch, timeout=True)
    with Sam3Process(command) as worker:
        worker.response_timeout = 0.01
        with pytest.raises(SegmenterUnavailable, match="timed out"):
            worker.predict({"image_png_b64": "first"})
        with pytest.raises(SegmenterUnavailable, match="unusable"):
            worker.predict({"image_png_b64": "second"})
        assert worker.process.poll() is not None


def test_matching_response_is_returned_without_transport_metadata(monkeypatch):
    command = _worker(monkeypatch)
    with Sam3Process(command) as worker:
        assert worker.predict({}) == {"shape": [1, 2, 2]}
