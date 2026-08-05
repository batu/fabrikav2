"""Unit tests for the hitbox eval harness (eval/score.py, eval/compare.py).

score_level is the metric contract that ranks placement candidates
(GOAL.md): these tests pin the semantics the hillclimb's RESULTS.md was
built on, including the deliberately-permissive contract behaviors
(overlap recall, duplicate TPs) that the 1-to-1 columns disclose.
"""

import importlib.util
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent / "eval"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, EVAL_DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


score = _load("score")


def g(x, y, r, gid="g"):
    return {"x": x, "y": y, "r": r, "id": gid}


def test_recall_uses_golden_radius_not_candidate_radius():
    golden = [g(100, 100, 20)]
    # Candidate center 30px away: outside golden r=20, its own huge r is irrelevant.
    lvl = score.score_level(golden, [{"x": 130, "y": 100, "r": 500}], dim=4096)
    assert lvl["recall"] == 0.0
    assert lvl["false_positives"] == 1
    # Same distance but golden r=40 -> found.
    lvl = score.score_level([g(100, 100, 40)], [{"x": 130, "y": 100, "r": 10}], dim=4096)
    assert lvl["recall"] == 1.0


def test_duplicates_do_not_hurt_contract_precision_but_show_in_1to1():
    golden = [g(100, 100, 50)]
    stacked = [{"x": 100 + i, "y": 100, "r": 50} for i in range(3)]
    lvl = score.score_level(golden, stacked, dim=4096)
    assert lvl["recall"] == 1.0
    assert lvl["precision"] == 1.0  # contract: every candidate is inside a golden
    assert lvl["duplicates"] == 2
    assert lvl["precision_1to1"] == 1 / 3  # honesty column exposes the padding


def test_overlap_recall_inflation_disclosed_by_recall_1to1():
    # Two overlapping goldens, one candidate between them: contract recall
    # counts both as found; 1-to-1 counts a single match.
    golden = [g(100, 100, 60, "a"), g(160, 100, 60, "b")]
    lvl = score.score_level(golden, [{"x": 130, "y": 100, "r": 50}], dim=4096)
    assert lvl["recall"] == 1.0
    assert lvl["recall_1to1"] == 0.5


def test_one_to_one_matching_prefers_nearest_and_strands_the_farther():
    golden = [g(100, 100, 50)]
    near = {"x": 105, "y": 100, "r": 50}
    far = {"x": 130, "y": 100, "r": 50}
    lvl = score.score_level(golden, [far, near], dim=4096)
    # center error must come from the NEAR candidate (5px), not the far one.
    assert abs(lvl["center_err_px4096"] - 5.0) < 1e-9
    assert lvl["duplicates"] == 1


def test_center_error_normalizes_to_4096_space():
    golden = [g(100, 100, 50)]
    cand = [{"x": 110, "y": 100, "r": 50}]  # 10px off
    at_4096 = score.score_level(golden, cand, dim=4096)["center_err_px4096"]
    at_2048 = score.score_level(golden, cand, dim=2048)["center_err_px4096"]
    assert abs(at_4096 - 10.0) < 1e-9
    assert abs(at_2048 - 20.0) < 1e-9


def test_load_candidates_box_and_circle_formats(tmp_path):
    p = tmp_path / "c.json"
    p.write_text('[{"x": 10, "y": 20, "width": 30, "height": 50},'
                 ' {"x": 5, "y": 6, "r": 7},'
                 ' {"x": 0, "y": 0, "r": 9, "width": 10, "height": 10}]')
    box, circle, ambiguous = score.load_candidates(p)
    assert (box["x"], box["y"], box["r"]) == (25.0, 45.0, 25.0)
    assert (circle["x"], circle["y"], circle["r"]) == (5.0, 6.0, 7.0)
    # An entry carrying both r and width takes the box branch (documented).
    assert ambiguous["r"] == 5.0


def test_empty_candidates_and_empty_metrics():
    lvl = score.score_level([g(1, 1, 5)], [], dim=4096)
    assert lvl["recall"] == 0.0
    assert lvl["precision"] is None
    assert lvl["center_err_px4096"] is None


def test_compare_missing_input_is_always_stale(tmp_path, monkeypatch):
    compare = _load("compare")
    golden_dir = tmp_path / "golden"
    golden_dir.mkdir()
    monkeypatch.setattr(compare, "GOLDEN_DIR", golden_dir)
    monkeypatch.setattr(compare, "EVAL_DIR", tmp_path)
    color = tmp_path / "color.png"
    color.write_bytes(b"x")
    (golden_dir / "sid.hitboxes.json").write_text("[]")
    # Candidates file missing -> +inf (always stale), never a frozen cache.
    assert compare._inputs_mtime("sid", "some-run", color) == float("inf")
    cand_dir = tmp_path / "results" / "some-run" / "candidates"
    cand_dir.mkdir(parents=True)
    (cand_dir / "sid.json").write_text("[]")
    mt = compare._inputs_mtime("sid", "some-run", color)
    assert mt != float("inf") and mt > 0
