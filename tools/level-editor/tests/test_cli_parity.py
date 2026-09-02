"""Server-owned operation contracts must be reachable from both clients."""

import argparse
from pathlib import Path

import pytest

from levelbuilder.cli.main import (
    CliError,
    WIZARD_OPERATIONS,
    build_parser,
    cmd_auto_place_sprites,
    cmd_bless_cutouts,
    cmd_bless_hitboxes,
    cmd_integrity_audit,
    cmd_integrity_migration_apply,
    cmd_integrity_migration_preview,
    cmd_place_sprite,
    cmd_sprite_candidates,
)
from levelbuilder.api.operation_registry import PRIMARY_OPERATIONS


def _parser_verbs() -> set[str]:
    parser = build_parser()
    sub = next(a for a in parser._actions if hasattr(a, "choices") and a.choices)
    return set(sub.choices)


def test_every_operation_has_a_real_verb() -> None:
    verbs = _parser_verbs()
    unmapped = {op: verb for op, verb in WIZARD_OPERATIONS.items() if verb not in verbs}
    assert not unmapped, f"operations mapped to nonexistent verbs: {unmapped}"


def test_core_wizard_operations_are_covered() -> None:
    # The five-step wizard flow, gallery, and export must all be present.
    required = {
        "create-session", "background-generation-job", "select-background",
        "upscale-background-job", "auto-hitboxes", "save-hitboxes",
        "inpaint-job", "single-dog-regenerate", "sequence-start-job",
        "selected-cutout-extraction", "selected-cutout-regeneration",
        "list-sprite-candidates", "manual-sprite-placement",
        "get-session", "list-sessions", "prompt-library",
        "human-review-hitboxes", "human-review-final-cutouts",
    }
    missing = required - set(WIZARD_OPERATIONS)
    assert not missing, f"wizard operations missing from inventory: {missing}"


def test_primary_operation_contracts_match_routes_and_ui_exports(app_client) -> None:
    routes = {
        (method, route.path)
        for route in app_client.app.routes
        for method in getattr(route, "methods", set())
    }
    ui_source = (Path(__file__).parents[1] / "ui" / "src" / "api" / "editorApi.ts").read_text()
    missing_routes = [
        item.operation_id for item in PRIMARY_OPERATIONS
        if (item.method, item.path) not in routes
    ]
    missing_ui = [
        item.operation_id for item in PRIMARY_OPERATIONS
        if item.ui_function and f"function {item.ui_function}(" not in ui_source
    ]
    assert not missing_routes, f"registered operations missing FastAPI routes: {missing_routes}"
    assert not missing_ui, f"registered operations missing UI API exports: {missing_ui}"


def test_ui_cutout_approval_declares_manual_editor_source() -> None:
    ui_source = (Path(__file__).parents[1] / "ui" / "src" / "api" / "editorApi.ts").read_text()
    function_source = ui_source.split("export function setFinalCutoutApproval(", 1)[1].split(
        "export function getFinalCutoutReviewReadiness(", 1,
    )[0]
    assert "humanActor: 'human:editor', reviewSource: 'editor-ui'" in function_source


class _Client:
    def __init__(self) -> None:
        self.calls = []

    def get(self, path):
        self.calls.append(("GET", path, None))
        if path.startswith("/api/sessions/") and not path.endswith("/sprite-candidates"):
            return {"contentRevision": "sha256:current"}
        return {"candidates": []}

    def request(self, method, path, *, json=None):
        self.calls.append((method, path, json))
        return {
            "ok": True,
            **({"spriteBox": json["spriteBox"]} if "spriteBox" in json else {}),
        }


def test_sprite_candidate_cli_uses_shared_api(capsys) -> None:
    client = _Client()
    cmd_sprite_candidates(client, argparse.Namespace(session_id="level-a", json=True))
    cmd_place_sprite(client, argparse.Namespace(
        session_id="level-a",
        candidate_id="dog_03:sprite_000",
        box=[10, 20, 70, 90],
        flip_x=True,
        flip_y=None,
        json=True,
    ))

    assert client.calls == [
        ("GET", "/api/sessions/level-a/sprite-candidates", None),
        ("GET", "/api/sessions/level-a", None),
        ("PUT", "/api/sessions/level-a/sprite-candidates/dog_03:sprite_000/placement", {
            "spriteBox": [10, 20, 70, 90], "flipX": True, "flipY": None,
            "expectedContentRevision": "sha256:current",
        }),
    ]
    assert '"ok": true' in capsys.readouterr().out


def test_integrity_audit_cli_uses_shared_api(capsys) -> None:
    client = _Client()

    cmd_integrity_audit(client, argparse.Namespace(json=True))

    assert client.calls == [("GET", "/api/artifact-integrity-audit", None)]
    assert '"candidates": []' in capsys.readouterr().out


def test_integrity_migration_cli_uses_shared_api(capsys) -> None:
    client = _Client()
    cmd_integrity_migration_preview(client, argparse.Namespace(json=True))
    cmd_integrity_migration_apply(client, argparse.Namespace(
        level_ids=["level-a"], expected_manifest_sha256="sha256:manifest", json=True,
    ))
    assert client.calls == [
        ("GET", "/api/artifact-integrity-migration", None),
        ("POST", "/api/artifact-integrity-migration/apply", {
            "levelIds": ["level-a"], "expectedManifestSha256": "sha256:manifest",
        }),
    ]


def test_cutout_approval_is_editor_ui_only_but_cli_can_remove_it(capsys) -> None:
    client = _Client()

    cmd_bless_hitboxes(client, argparse.Namespace(
        session_id="level-a", approved=True, human_confirmed_by="batu", json=True,
    ))
    with pytest.raises(CliError, match="editor UI"):
        cmd_bless_cutouts(client, argparse.Namespace(
            session_id="level-a", approved=True, human_confirmed_by="batu", json=True,
        ))
    cmd_bless_cutouts(client, argparse.Namespace(
        session_id="level-a", approved=False, human_confirmed_by=None, json=True,
    ))

    assert client.calls == [
        ("GET", "/api/sessions/level-a", None),
        ("PUT", "/api/sessions/level-a/hitbox-review", {
            "approved": True, "expectedContentRevision": "sha256:current", "humanActor": "human:batu",
        }),
        ("GET", "/api/sessions/level-a", None),
        ("PUT", "/api/sessions/level-a/final-cutout-review", {
            "approved": False, "expectedContentRevision": "sha256:current",
        }),
    ]
    assert capsys.readouterr().out.count('"ok": true') == 2


def test_auto_place_sprites_cli_uses_shared_api(capsys) -> None:
    client = _Client()

    cmd_auto_place_sprites(client, argparse.Namespace(
        session_id="level-a",
        include_human_confirmed=False,
        json=True,
    ))

    assert client.calls == [
        ("POST", "/api/sessions/level-a/sprite-candidates/auto-placement", {
            "includeHumanConfirmed": False,
        }),
    ]
    assert '"ok": true' in capsys.readouterr().out
