"""Intentional guard probes; unexpected attempts elsewhere still fail the session."""
import socket
import subprocess
import sys

import pytest
import conftest


def test_network_guard_records_a_caught_connection_attempt(monkeypatch):
    attempts = []
    monkeypatch.setattr(conftest, "_UNEXPECTED_EXTERNAL_CALLS", attempts)
    with socket.socket() as sock:
        with pytest.raises(RuntimeError, match="prohibit network"):
            sock.connect(("127.0.0.1", 9))
    assert attempts == ["network connection"]


def test_python_subprocess_cannot_escape_the_provider_guard(monkeypatch):
    attempts = []
    monkeypatch.setattr(conftest, "_UNEXPECTED_EXTERNAL_CALLS", attempts)
    with pytest.raises(RuntimeError, match="prohibit external CLIs"):
        subprocess.run([sys.executable, "-c", "raise SystemExit('must never execute')"], check=True)
    assert attempts == ["external subprocess"]
