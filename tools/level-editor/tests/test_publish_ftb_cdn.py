import importlib.util
from pathlib import Path


_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "publish_ftb_cdn.py"
_SPEC = importlib.util.spec_from_file_location("test_publish_ftb_cdn_script", _SCRIPT_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
stage_catalog_snapshots = _MODULE.stage_catalog_snapshots


def test_stage_catalog_snapshots_preserves_the_runtime_cdn_path(tmp_path):
    public_levels = tmp_path / "public" / "levels"
    snapshots = public_levels / "catalog-snapshots"
    snapshots.mkdir(parents=True)
    (snapshots / "catalog-000001.json").write_text('{"revision": 1}')
    (snapshots / "catalog-000002.json").write_text('{"revision": 2}')
    (snapshots / "ignore.txt").write_text("not a snapshot")
    staging = tmp_path / "staging"

    count = stage_catalog_snapshots(public_levels, staging)

    staged = staging / "levels" / "catalog-snapshots"
    assert count == 2
    assert (staged / "catalog-000001.json").read_text() == '{"revision": 1}'
    assert (staged / "catalog-000002.json").read_text() == '{"revision": 2}'
    assert not (staged / "ignore.txt").exists()
