from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from benchmark_harness import (  # noqa: E402
    ManifestError,
    MethodSpec,
    format_method_path,
    load_manifest,
    parse_method_spec,
    render_sheets,
    resolve_case,
    run_prefilter,
)
from levelbuilder.api.sprite_judge import SUBJECT_RULE, JudgeVerdict  # noqa: E402


MANIFEST = HERE / "benchmark-manifest.json"


def _write_source_case(root: Path, *, case_id: str = "level_a__dog_03") -> dict:
    level = root / "level_a"
    dog_dir = level / "dogs" / "dog_03"
    dog_dir.mkdir(parents=True)
    Image.new("RGB", (100, 100), (80, 120, 60)).save(level / "bg_00.png")
    Image.new("RGB", (20, 20), (180, 60, 40)).save(dog_dir / "variant_002.png")
    Image.new("RGBA", (12, 14), (180, 60, 40, 255)).save(dog_dir / "sprite_002.png")
    (dog_dir / "variant_002.box.json").write_text(json.dumps({"box": [10, 20, 30, 40]}))
    # Target is deliberately second in the dogs array and first in hitboxes.
    # A positional join would select the wrong dog and fail this fixture.
    (level / "session.json").write_text(json.dumps({
        "id": "level_a",
        "bg_width": 100,
        "bg_height": 100,
        "dogs": [
            {"index": 8, "id": "other-id", "activeVariant": 0},
            {"index": 3, "id": "target-id", "activeVariant": 2},
        ],
    }))
    (level / "hitboxes.json").write_text(json.dumps([
        {"id": "target-id", "x": 18, "y": 29, "r": 24},
        {"id": "other-id", "x": 80, "y": 80, "r": 30},
    ]))
    return {
        "caseId": case_id,
        "levelId": "level_a",
        "dogDir": "dog_03",
        "birdId": "target-id",
        "activeVariant": 2,
        "hitbox": {"x": 18, "y": 29, "r": 24},
        "sourceSize": [100, 100],
        "sourceBox": [10, 20, 30, 40],
        "paintedCrop": "level_a/dogs/dog_03/variant_002.png",
        "variantBox": "level_a/dogs/dog_03/variant_002.box.json",
        "priorSprite": "level_a/dogs/dog_03/sprite_002.png",
        "candidatePath": "level_a/dog_03.png",
        "tags": ["held_item", "tiny_r24", "small_768", "line_art"],
        "note": "fixture",
    }


def test_fixed_manifest_has_20_unique_cases_and_required_coverage():
    manifest = load_manifest(MANIFEST)
    cases = manifest["cases"]
    assert len(cases) == 20
    assert len({case["caseId"] for case in cases}) == 20
    assert len({case["levelId"] for case in cases}) == 20
    tags = {tag for case in cases for tag in case["tags"]}
    assert {
        "held_item",
        "water_reflection",
        "tiny_r24",
        "line_art",
        "small_768",
        "native_4k",
    } <= tags


def test_resolve_case_joins_dog_to_hitbox_by_stable_id(tmp_path):
    case = _write_source_case(tmp_path)
    resolved = resolve_case(case, tmp_path)
    assert resolved.dog["id"] == "target-id"
    assert resolved.dog["index"] == 3
    assert resolved.hitbox == {"id": "target-id", "x": 18, "y": 29, "r": 24}


def test_resolve_case_rejects_manifest_hitbox_drift(tmp_path):
    case = _write_source_case(tmp_path)
    case["hitbox"]["x"] = 999
    with pytest.raises(ManifestError, match="hitbox"):
        resolve_case(case, tmp_path)


def test_method_spec_defaults_to_manifest_candidate_path(tmp_path):
    spec = parse_method_spec(f"alpha={tmp_path}")
    case = {"caseId": "a", "candidatePath": "level_a/dog_03.png"}
    assert spec.name == "alpha"
    assert format_method_path(spec, case) == tmp_path / "level_a" / "dog_03.png"


def test_method_template_supports_existing_source_layout_and_blocks_escape(tmp_path):
    spec = parse_method_spec(
        f"rejected={tmp_path}::{{levelId}}/dogs/{{dogDir}}/sprite_{{activeVariant:03d}}.png"
    )
    case = {"levelId": "lv", "dogDir": "dog_03", "activeVariant": 2}
    assert format_method_path(spec, case) == tmp_path / "lv" / "dogs" / "dog_03" / "sprite_002.png"
    with pytest.raises(ManifestError, match="escapes root"):
        format_method_path(MethodSpec("bad", tmp_path, "../secret.png"), case)


def test_render_writes_portal_sheets_and_machine_summary(tmp_path):
    source = tmp_path / "source"
    case = _write_source_case(source)
    candidates = tmp_path / "candidates"
    candidate = candidates / case["candidatePath"]
    candidate.parent.mkdir(parents=True)
    Image.new("RGBA", (12, 14), (180, 60, 40, 255)).save(candidate)
    out = tmp_path / "render"

    summary = render_sheets(
        {"schemaVersion": 1, "cases": [case]},
        source,
        [MethodSpec("alpha", candidates, "{candidatePath}")],
        out,
        rows_per_page=4,
    )

    assert summary["pages"] == ["sheet-01.png"]
    assert (out / "sheet-01.png").exists()
    saved = json.loads((out / "render.json").read_text())
    assert saved["cases"][0]["methods"]["alpha"]["hasAlpha"] is True


def test_prefilter_records_guarded_bird_and_held_items_rule(tmp_path):
    source = tmp_path / "source"
    case = _write_source_case(source)
    candidates = tmp_path / "candidates"
    candidate = candidates / case["candidatePath"]
    candidate.parent.mkdir(parents=True)
    Image.new("RGBA", (12, 14), (180, 60, 40, 255)).save(candidate)

    class StubJudge:
        name = "stub"

        def judge(self, judge_case):
            return JudgeVerdict(
                judge_case.dog_id,
                subject=0.9,
                completeness=0.85,
                evidence="complete bird plus held item",
                backend=self.name,
            )

    out = tmp_path / "prefilter.json"
    report = run_prefilter(
        {"schemaVersion": 1, "cases": [case]},
        source,
        MethodSpec("alpha", candidates, "{candidatePath}"),
        StubJudge(),
        out,
    )

    assert report["subjectRule"] == SUBJECT_RULE
    assert report["humanAcceptanceRequired"] is True
    assert report["results"][case["caseId"]]["prefilterPass"] is True
