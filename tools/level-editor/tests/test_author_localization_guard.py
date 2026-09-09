"""author must not report success when the paint job's post-paint
localization failed (2026-09-08: a provider 402 left two sessions on their
pre-paint dots; the lane blessed and cut sprites around them)."""
import argparse

import pytest


def test_author_raises_when_localization_failed(monkeypatch):
    from levelbuilder.cli import main as cli

    class _Client:
        def get(self, path):
            if path.endswith("/hitboxes") or path.startswith("/api/sessions/"):
                return {"hitboxes": [{"x": 1, "y": 2, "r": 3}], "nDogs": 1}
            return {}

        def post(self, path, json=None):
            if path.endswith("assemble-recipe-prompts"):
                return {"dogPrompt": "bird", "scenePrompt": "scene"}
            if path.endswith("/inpaint/jobs"):
                return {"jobId": "j1"}
            raise AssertionError(path)

    monkeypatch.setattr(cli, "_wait_for_job", lambda client, jid, timeout_s, quiet: {
        "status": "succeeded", "result": {"localizationFailed": "Client error '402 Payment Required'"}})
    monkeypatch.setattr(cli, "_require_success", lambda job: job)
    monkeypatch.setattr(cli, "_session_recipe", lambda session: {})
    monkeypatch.setattr(cli, "_check_disk", lambda force: None, raising=False)
    args = argparse.Namespace(
        template=None, session_id="sid", start_from="inpaint", stop_after="inpaint", dry_run=False,
        count=None, bg_index=0, strategy="smart", radius=None, min_radius=18, shrink_step=2,
        hard_percent=0, inpaint_mode="magenta", max_offset=0.5, repair_passes=2,
        drop_unrepairable=False, changelog="t", timeout=1.0, inpaint_timeout=1.0, force_disk=True,
        max_repairs=1, redo=False, json=True,
    )
    with pytest.raises(cli.CliError) as info:
        cli.cmd_author(_Client(), args)
    assert info.value.code == "localization_failed"
    assert "place-hitboxes-vlm sid" in info.value.message
