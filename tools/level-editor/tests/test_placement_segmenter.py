import io
import json
import os
import threading
import time
from types import SimpleNamespace

import pytest
from levelbuilder.api import placement_segmenter
from levelbuilder.api.placement_segmenter import Sam3Process, SegmenterUnavailable


def test_partial_response_cannot_outlive_deadline():
    read_fd, write_fd = os.pipe()

    def respond():
        with os.fdopen(write_fd, "wb", buffering=0) as stream:
            stream.write(b'{')
            time.sleep(0.5)
            try:
                stream.write(b'"model":"SAM3","checkpointSha256":"test"}\n')
            except BrokenPipeError:
                pass

    thread = threading.Thread(target=respond)
    thread.start()
    try:
        with os.fdopen(read_fd, "rb", buffering=0) as stream:
            worker = Sam3Process.__new__(Sam3Process)
            worker.process = SimpleNamespace(stdout=stream)
            worker.response_timeout = 0.2
            worker._response_buffer = b""
            with pytest.raises(SegmenterUnavailable, match="timed out"):
                worker._read()
    finally:
        thread.join()


def test_coalesced_responses_preserve_buffered_next_line():
    read_fd, write_fd = os.pipe()
    with os.fdopen(write_fd, "wb", buffering=0) as writer:
        writer.write(b'{"first":1}\n{"second":2}\n')
    with os.fdopen(read_fd, "rb", buffering=0) as stream:
        worker = Sam3Process.__new__(Sam3Process)
        worker.process = SimpleNamespace(stdout=stream)
        worker.response_timeout = 0.2
        worker._response_buffer = b""
        assert worker._read() == {"first": 1}
        assert worker._read() == {"second": 2}


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

        def fileno(self):
            return 42

        def wait(self, timeout=None):
            self.returncode = 0
            return 0

        def poll(self):
            return self.returncode

        def close(self):
            self.closed = True

    process = Process()
    monkeypatch.setattr(placement_segmenter.os, "read", lambda *_args: process.readline().encode())
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
