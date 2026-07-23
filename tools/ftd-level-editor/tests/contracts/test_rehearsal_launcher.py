from __future__ import annotations

from pathlib import Path

from ftd_editor.cutover import inventory_tree

from ftd_editor.rehearsal import initialize_clone


def test_initialize_clone_is_once_only_and_never_mutates_source(tmp_path: Path) -> None:
    source = tmp_path / "v1"
    session = source / "level-real"
    session.mkdir(parents=True)
    (session / "session.json").write_text('{"id":"level-real","dogs":[]}\n')
    before = inventory_tree(source)
    root = tmp_path / "v2"

    initialize_clone(source, root)
    assert (root / "authoring" / "level-real" / "session.json").is_file()
    (root / "authoring" / "v2-only.txt").write_text("keep")
    initialize_clone(source, root)

    assert (root / "authoring" / "v2-only.txt").read_text() == "keep"
    assert inventory_tree(source).checksum == before.checksum
