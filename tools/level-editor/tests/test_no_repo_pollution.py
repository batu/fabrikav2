"""Importing the tool must not write anywhere outside its own tree.

The vendored notebook cache module resolved its directory to `tools/nbs/.cache`
— outside the tool — and created it on every import (routes -> prompts ->
imgcache), quietly littering the repo's tools/ directory.
"""

from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent.parent


def test_image_cache_lives_inside_the_tool():
    from levelbuilder import imgcache

    assert TOOL_ROOT in imgcache.CACHE_DIR.resolve().parents, imgcache.CACHE_DIR


def test_importing_does_not_create_the_cache_dir(tmp_path, monkeypatch):
    import importlib

    target = tmp_path / "images"
    monkeypatch.setenv("LEVEL_EDITOR_IMAGE_CACHE", str(target))
    from levelbuilder import imgcache

    importlib.reload(imgcache)
    try:
        assert not target.exists(), "import should not touch the filesystem"
        assert imgcache._ensure_cache_dir() == target
        assert target.exists()
    finally:
        monkeypatch.delenv("LEVEL_EDITOR_IMAGE_CACHE", raising=False)
        importlib.reload(imgcache)


def test_no_stray_nbs_directory_beside_the_tool():
    assert not (TOOL_ROOT.parent / "nbs").exists(), "tools/nbs was recreated"
