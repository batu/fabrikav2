from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import FastAPI

from ftd_editor.security import SecretRedactionFilter

from conftest import CANARY_SECRET


def test_composition_secrets_are_not_represented_or_serializable(app_components) -> None:
    rendered = repr(app_components.redactor.secrets)
    assert CANARY_SECRET not in rendered
    assert "<redacted>" in rendered


def test_recursive_persistence_sanitizer_removes_canaries_and_credentials(
    app_components,
) -> None:
    payload = {
        "error": f"provider rejected {CANARY_SECRET}",
        "headers": {"Authorization": "Bearer abc123-secret"},
        "metadata": ["x-api-key: another-secret", Path("levels/safe.png")],
    }
    sanitized = app_components.redactor.sanitize(payload)
    encoded = json.dumps(sanitized)

    assert CANARY_SECRET not in encoded
    assert "abc123-secret" not in encoded
    assert "another-secret" not in encoded
    assert "levels/safe.png" in encoded


def test_representative_api_failure_is_redacted(
    app: FastAPI,
    client,
    authorized_headers: dict[str, str],
) -> None:
    @app.get("/api/_fixture/fail")
    def fail() -> None:
        raise RuntimeError(f"provider failed with token={CANARY_SECRET}")

    response = client.get("/api/_fixture/fail", headers=authorized_headers)

    assert response.status_code == 500
    assert CANARY_SECRET not in response.text
    assert "<redacted>" in response.text


def test_logging_filter_redacts_canary(caplog, app_components) -> None:
    logger = logging.getLogger("ftd-editor-redaction-test")
    redaction_filter = SecretRedactionFilter(app_components.redactor)
    logger.addFilter(redaction_filter)
    try:
        with caplog.at_level(logging.ERROR, logger=logger.name):
            logger.error("provider failure: %s", CANARY_SECRET)
    finally:
        logger.removeFilter(redaction_filter)

    assert CANARY_SECRET not in caplog.text
    assert "<redacted>" in caplog.text


def test_evidence_directory_scan_detects_no_secret_after_sanitized_writes(
    tmp_path: Path,
    app_components,
) -> None:
    paths = [
        tmp_path / "events.json",
        tmp_path / "metadata.json",
        tmp_path / "artifact.txt",
        tmp_path / "evidence.txt",
    ]
    for path in paths:
        value = app_components.redactor.sanitize_text(f"failed: {CANARY_SECRET}")
        path.write_text(value)

    app_components.redactor.assert_tree_clean(tmp_path)
    assert all(CANARY_SECRET not in path.read_text() for path in paths)
