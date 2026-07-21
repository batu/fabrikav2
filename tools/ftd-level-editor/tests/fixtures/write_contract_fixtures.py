"""Write or check the deterministic U1 contract fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from ftd_editor.app import AppComponents, EmptyStores, FailClosedProviders, ManualWorker, create_app
from ftd_editor.domain.geometry import banner_band, hud_band, section_forbidden_zones, section_ranges
from ftd_editor.models.options import model_option_snapshot
from ftd_editor.prompts.recipes import build_scene_prompt, get_entity_prompt, prompt_catalog_snapshot
from ftd_editor.security import CompositionSecrets, SecretRedactor
from ftd_editor.settings import EditorSettings


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def build_fixture(provenance: dict[str, str]) -> dict[str, object]:
    pure_ftd = {
        "geometry": {
            "hud1080": hud_band(1080),
            "banner1080": banner_band(1080),
            "ranges1921": section_ranges(1921),
            "middleZones": [asdict(zone) for zone in section_forbidden_zones(1, 640, 1080)],
        },
        "models": model_option_snapshot(),
        "prompts": prompt_catalog_snapshot(),
        "promptDigests": {
            "defaultScene": _digest(build_scene_prompt()),
            "dog": _digest(get_entity_prompt("clean_old_cartoon", "dog")),
            "oldPixelCat": _digest(get_entity_prompt("old_pixel_art", "cat")),
        },
    }
    settings = EditorSettings.for_test(
        Path("/tmp/ftd-editor-contract-fixture"),
        allowed_hosts=("fixture.invalid",),
        allowed_origins=("http://fixture.invalid",),
    )
    app = create_app(
        settings,
        AppComponents(
            stores=EmptyStores(),
            worker=ManualWorker(),
            providers=FailClosedProviders(),
            redactor=SecretRedactor(CompositionSecrets.from_mapping({})),
        ),
    )
    routes = sorted(
        (
            {
                "path": route.path,
                "methods": sorted(route.methods or ()),
                "operationId": getattr(route, "operation_id", None),
            }
            for route in app.routes
        ),
        key=lambda route: (route["path"], route["methods"]),
    )
    openapi = json.dumps(app.openapi(), sort_keys=True, separators=(",", ":"))
    return {
        "provenance": provenance,
        "pureFtd": pure_ftd,
        "appContract": {
            "routes": routes,
            "openapiSha256": hashlib.sha256(openapi.encode()).hexdigest(),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-prompt-source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.legacy_prompt_source is not None:
        provenance = {
            "legacyPromptSourceSha256": hashlib.sha256(
                args.legacy_prompt_source.read_bytes()
            ).hexdigest(),
            "note": "Generated once from the read-only v1 prompt catalog; runtime has no legacy dependency.",
        }
    elif args.check and args.output.exists():
        provenance = json.loads(args.output.read_text())["provenance"]
    else:
        raise SystemExit("--legacy-prompt-source is required when writing a fixture")
    payload = json.dumps(
        build_fixture(provenance),
        indent=2,
        ensure_ascii=False,
        sort_keys=True,
    ) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text() != payload:
            raise SystemExit(f"contract fixture drift: regenerate {args.output}")
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(payload)


if __name__ == "__main__":
    main()
