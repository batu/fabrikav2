"""Adapter for an existing GPU environment's SAM3 JSON-lines worker."""

import json
import select
import shlex
import subprocess
import uuid
from contextlib import suppress


class SegmenterUnavailable(RuntimeError):
    """Fatal transport failure; a response must never be reassigned to another image."""


class Sam3Process:
    def __init__(self, command: str, response_timeout: float = 120):
        self.response_timeout = response_timeout
        self.failed = False
        self.process = subprocess.Popen(
            shlex.split(command),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            self.identity = self._read()
            if self.identity.get("model") != "SAM3" or not self.identity.get(
                "checkpointSha256"
            ):
                raise ValueError("SAM3 worker did not identify its checkpoint")
        except Exception:
            self.close()
            raise

    def _read(self):
        if not select.select([self.process.stdout], [], [], self.response_timeout)[0]:
            raise SegmenterUnavailable("GPU subject worker timed out")
        line = self.process.stdout.readline()
        if not line:
            raise SegmenterUnavailable("GPU subject worker exited before responding")
        result = json.loads(line)
        if not isinstance(result, dict):
            raise SegmenterUnavailable(
                "GPU subject worker returned a non-object response"
            )
        return result

    def predict(self, request: dict) -> dict:
        if self.failed:
            raise SegmenterUnavailable("GPU subject worker is unusable")
        request_id = uuid.uuid4().hex
        try:
            self.process.stdin.write(
                json.dumps({**request, "requestId": request_id}) + "\n"
            )
            self.process.stdin.flush()
            result = self._read()
            if result.pop("requestId", None) != request_id:
                raise SegmenterUnavailable("GPU response does not match its request")
        except (OSError, ValueError, SegmenterUnavailable) as error:
            self.failed = True
            self.close()
            raise SegmenterUnavailable(str(error)) from error
        if "error" in result:
            raise RuntimeError(result["error"])
        return result

    def close(self):
        if self.process.stdin and not self.process.stdin.closed:
            with suppress(OSError):
                self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.process.stdout:
            self.process.stdout.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
