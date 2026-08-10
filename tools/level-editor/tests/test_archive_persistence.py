import json
import shutil

from PIL import Image


def test_archived_public_package_stays_archived_after_source_cleanup(
    app_client,
    isolated_session,
    monkeypatch,
):
    """Deleting source metadata must not resurrect a retained public package."""
    from levelbuilder.api import routes

    session_id = "archived_public_level"
    source_dir = isolated_session.LEVELS_DIR / session_id
    source_dir.mkdir(parents=True)
    (source_dir / "session.json").write_text(json.dumps({
        "setting": "other",
        "archived": False,
        "archived_variants": [],
    }))

    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    public_dir.mkdir(parents=True)
    Image.new("RGB", (64, 64), (80, 100, 120)).save(public_dir / "color.png")
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Archived public level",
        "width": 64,
        "height": 64,
        "dogs": [],
    }))

    # A catalog package is retained by archive/revoke. Keep this test focused
    # on the archive-state handoff rather than preview-manifest mechanics.
    monkeypatch.setattr(isolated_session, "revoke_export", lambda _session_id: {})
    monkeypatch.setattr(routes.SequenceWorkflow, "remove_level_from_draft", lambda _session_id: False)

    response = app_client.patch(
        f"/api/sessions/{session_id}/archive",
        json={"archived": True},
    )
    assert response.status_code == 200

    shutil.rmtree(source_dir)
    listed = app_client.get("/api/sessions?include_public=true").json()
    public_session = next(item for item in listed if item["id"] == session_id)

    assert public_session["assetBase"] == "public-levels"
    assert public_session["archived"] is True


def test_tombstoned_public_only_package_is_not_listed(app_client, isolated_session):
    session_id = "deleted_public_level"
    public_dir = isolated_session.GAME_PUBLIC_LEVELS / session_id
    public_dir.mkdir(parents=True)
    Image.new("RGB", (64, 64), (80, 100, 120)).save(public_dir / "color.png")
    (public_dir / "level.json").write_text(json.dumps({
        "id": session_id,
        "name": "Deleted public level",
        "width": 64,
        "height": 64,
        "dogs": [],
    }))
    (isolated_session.GAME_PUBLIC_LEVELS / "catalog-manifest.json").write_text(json.dumps({
        "version": 1,
        "revisionNumber": 1,
        "catalogRevision": "catalog-test",
        "levels": [{
            "id": session_id,
            "listable": False,
            "tombstonedAt": "2026-08-10T00:00:00Z",
        }],
    }))

    listed = app_client.get("/api/sessions?include_public=true").json()

    assert session_id not in {item["id"] for item in listed}
