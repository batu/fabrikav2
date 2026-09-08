"""Difficulty scoring must be offline by default and preserve authoring data."""

import hashlib
import json

import httpx
import pytest
from PIL import Image

from levelbuilder.cli import main as cli


def digest(value):
    return hashlib.sha256(value).hexdigest()


@pytest.fixture
def pilot(tmp_path):
    root = tmp_path / "repo"
    public = root / "games/find_the_dog/public"
    directory = public / "levels/demo"
    directory.mkdir(parents=True)
    Image.new("RGB", (200, 400), "white").save(directory / "color.png")
    Image.new("RGBA", (20, 30), "black").save(directory / "sprite.png")
    dogs = [
        {"id": "a", "x": 50, "y": 100, "r": 20,
         "sprite": {"image": "levels/demo/sprite.png", "x": 40, "y": 85, "width": 20, "height": 30}},
        {"id": "b", "x": 150, "y": 300, "r": 20,
         "sprite": {"image": "levels/demo/sprite.png", "x": 140, "y": 285, "width": 20, "height": 30}},
    ]
    level = {"id": "demo", "width": 200, "height": 400, "dogs": dogs,
             "colorImage": "levels/demo/color.png"}
    (directory / "level.json").write_text(json.dumps(level))

    def asset(path):
        return {"path": str(path.relative_to(root)), "sha256": digest(path.read_bytes())}

    sprites = [{"dogId": dog["id"], **asset(directory / "sprite.png")} for dog in dogs]
    manifest = {"schemaVersion": 1, "levels": [{
        "levelId": "demo", "levelJson": asset(directory / "level.json"),
        "colorImage": asset(directory / "color.png"),
        "spriteSetSha256": digest(json.dumps(sprites, sort_keys=True, separators=(",", ":")).encode()),
    }]}
    path = root / "pilot.json"
    path.write_text(json.dumps(manifest))
    return root, path


def test_cli_dry_run_has_no_client_or_writes(pilot, monkeypatch, capsys):
    root, manifest = pilot
    before = {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    monkeypatch.setattr(cli, "Client", lambda *a: pytest.fail("editor contacted"))
    code = cli.main(["--json", "difficulty", "--manifest", str(manifest), "--repo-root", str(root)])
    assert code == 0
    report = json.loads(capsys.readouterr().out)
    assert report["status"] == "dry_run"
    assert report["plannedCalls"] == 3
    assert report["levels"][0]["imageSize"] == [200, 400]
    assert report["ranking"] is None
    assert before == {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_stale_input_fails_before_network(pilot, capsys):
    root, manifest = pilot
    (root / "games/find_the_dog/public/levels/demo/color.png").write_bytes(b"changed")
    assert cli.main(["--json", "difficulty", "--manifest", str(manifest), "--repo-root", str(root)]) == 2
    assert json.loads(capsys.readouterr().out)["error"]["code"] == "difficulty_invalid"


@pytest.fixture
def prepared(pilot):
    from levelbuilder import difficulty as d

    root, path = pilot
    return d.prepare(path, root, model=d.DEFAULT_MODEL, repeats=3, max_edge=1024)


def catalog():
    from levelbuilder import difficulty as d

    return {"data": [{"id": d.DEFAULT_MODEL, "context_length": 10000,
                      "reasoning": {"supported_efforts": ["low"]},
                      "architecture": {"input_modalities": ["image", "text"]},
                      "supported_parameters": ["structured_outputs", "response_format", "max_tokens", "reasoning", "temperature"],
                      "pricing": {"prompt": "0.000001", "completion": "0.000002"}}]}


def completion(dogs=None, cost=0.001, finish="stop"):
    return {"id": "generation-test", "model": "google/gemini-3.8-flash", "usage": {"cost": cost},
            "choices": [{"finish_reason": finish, "message": {"content": json.dumps({"dogs": dogs or []})}}]}


@pytest.fixture
def metering(monkeypatch):
    from merceka_core import costs

    rows = []
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-not-a-secret")
    monkeypatch.setattr(costs, "record", lambda **kw: rows.append(kw))
    return rows


def mock_network(post, calls):
    def handler(request):
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=catalog())
        return post(request)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_paid_run_cache_and_read_only(pilot, prepared, tmp_path, metering):
    from levelbuilder import difficulty as d

    root, _ = pilot
    before = {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    calls = []
    dog = {"box_2d": [212, 200, 288, 300]}
    with mock_network(lambda r: httpx.Response(200, json=completion([dog])), calls) as network:
        report = d.execute(prepared, root, tmp_path / "out", 1, client=network)
        assert report["paidCalls"] == 3
        assert report["meteredTotalUsd"] == pytest.approx(0.003)
        assert report["ranking"][0]["score"] == 90
        assert report["scoreVersion"] == "completion-bottleneck-v2"
        assert report["ranking"][0]["neverMatchedDogIds"] == ["b"]
        assert report["ranking"][0]["dogs"][1]["foundIn"] == 0
        resumed = d.execute(prepared, root, tmp_path / "out", 1, client=network)
        assert resumed["paidCalls"] == 0
    assert len([r for r in calls if r.method == "POST"]) == 3
    assert len(metering) == 3
    assert before == {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    payload = json.loads(next(r.content for r in calls if r.method == "POST"))
    assert payload["model"] == d.DEFAULT_MODEL
    assert payload["provider"]["allow_fallbacks"] is False
    assert payload["max_tokens"] == 8192
    text = payload["messages"][0]["content"][0]["text"]
    assert text == d.PROMPT
    assert "targets" not in text and "demo" not in text


def test_one_blocking_dog_outweighs_many_moderate_dogs():
    from levelbuilder import difficulty as d

    targets = [{"id": f"dog-{i}", "box": [i * 30, 10, i * 30 + 20, 30]} for i in range(25)]
    levels = [{"levelId": name, "fingerprint": name, "targets": targets,
               "dimensions": [1000, 1000], "dogCount": 25, "medianSpriteLinearFraction": 0.02}
              for name in ("one-blocker", "all-moderate", "all-easy", "all-missed")]
    responses = {}
    for level in levels:
        for trial in range(3):
            visible = {"one-blocker": targets[:-1], "all-moderate": targets if trial == 0 else [],
                       "all-easy": targets, "all-missed": []}[level["levelId"]]
            responses[f"{level['fingerprint']}-{trial}"] = {"dogs": [{"box_2d": t["box"]} for t in visible]}
    ranking = d.rank({"config": {"repeats": 3}, "levels": levels}, responses)
    assert [r["levelId"] for r in ranking] == ["all-easy", "all-moderate", "one-blocker", "all-missed"]
    blocker = ranking[2]
    assert blocker["score"] == pytest.approx(85.2)
    assert blocker["bottleneckDogIds"] == ["dog-24"]
    assert blocker["neverMatchedDogIds"] == ["dog-24"]
    assert any("unresolved bottleneck" in w for w in blocker["warnings"])
    assert ranking[0]["score"] == 0
    assert ranking[-1]["score"] == 100


def test_budget_reserves_before_post(prepared, pilot, tmp_path, metering):
    from levelbuilder import difficulty as d

    calls = []
    with mock_network(lambda r: pytest.fail("paid call crossed budget"), calls) as network:
        with pytest.raises(d.DifficultyError, match="budget"):
            d.execute(prepared, pilot[0], tmp_path / "out", 0.0001, client=network)
    assert metering == []


@pytest.mark.parametrize("response", [completion(cost=None), completion(finish="length"), completion([{"box_2d": [0, 0, 0, 2]}])])
def test_invalid_response_is_metered_and_never_retried(response, prepared, pilot, tmp_path, metering):
    from levelbuilder import difficulty as d

    calls = []
    with mock_network(lambda r: httpx.Response(200, json=response), calls) as network:
        with pytest.raises(d.DifficultyError):
            d.execute(prepared, pilot[0], tmp_path / "out", 1, client=network)
        with pytest.raises(d.DifficultyError, match="unresolved"):
            d.execute(prepared, pilot[0], tmp_path / "out", 1, client=network)
    assert len([r for r in calls if r.method == "POST"]) == 1
    assert len(metering) == 1
    assert len(list((tmp_path / "out").glob("response-*.json"))) == 1


def test_timeout_cannot_replay(prepared, pilot, tmp_path, metering):
    from levelbuilder import difficulty as d

    def timeout(request):
        raise httpx.ReadTimeout("ambiguous outcome")
    calls = []
    with mock_network(timeout, calls) as network:
        with pytest.raises(httpx.ReadTimeout):
            d.execute(prepared, pilot[0], tmp_path / "out", 1, client=network)
        with pytest.raises(d.DifficultyError, match="unresolved"):
            d.execute(prepared, pilot[0], tmp_path / "out", 1, client=network)
    assert len([r for r in calls if r.method == "POST"]) == 1


def test_one_to_one_duplicate_and_whole_scene_rejection(prepared):
    from levelbuilder import difficulty as d

    row = prepared["levels"][0]
    dog = d.Detection(box_2d=[212, 200, 288, 300])
    whole = d.Detection(box_2d=[0, 0, 1000, 1000])
    result = d.match(row["targets"], [dog, dog, whole], row["dimensions"])
    assert result["foundIds"] == ["a"]
    assert result["recall"] == 0.5
    assert result["precision"] == pytest.approx(1 / 3)
    assert result["falsePositives"] == 2


def test_overlap_cannot_find_two_targets():
    from levelbuilder import difficulty as d

    targets = [{"id": "a", "box": [100, 100, 200, 200]}, {"id": "b", "box": [120, 100, 220, 200]}]
    result = d.match(targets, [d.Detection(box_2d=[110, 100, 210, 200])], [1000, 1000])
    assert len(result["foundIds"]) == 1
    repeated = d.Detection(box_2d=[110, 100, 210, 200])
    result = d.match(targets, [repeated, repeated], [1000, 1000])
    assert len(result["foundIds"]) == 1
    assert result["falsePositives"] == 1


@pytest.mark.parametrize("box", [[0, 0, 1001, 1000], [100, 0, 1, 10], [0, 1, 2], [0, 0, 2.5, 10], [False, 0, 2, 10]])
def test_detection_schema_rejects_invalid_boxes(box):
    from levelbuilder import difficulty as d

    with pytest.raises(ValueError):
        d.Detection(box_2d=box)


def test_output_cannot_touch_games_or_existing_directory(pilot, tmp_path):
    from levelbuilder import difficulty as d

    root, _ = pilot
    with pytest.raises(d.DifficultyError, match="outside"):
        with d.output_lock(root / "games/find_the_dog/public", root):
            pytest.fail("entered game output")
    existing = tmp_path / "existing"
    existing.mkdir()
    (existing / "report.json").write_text("user data")
    with pytest.raises(d.DifficultyError, match="nonempty"):
        with d.output_lock(existing, root):
            pytest.fail("claimed existing output")
    assert (existing / "report.json").read_text() == "user data"


def test_manifest_path_escape(pilot):
    from levelbuilder import difficulty as d

    root, manifest = pilot
    value = json.loads(manifest.read_text())
    value["levels"][0]["colorImage"]["path"] = "../outside.png"
    manifest.write_text(json.dumps(value))
    with pytest.raises(d.DifficultyError, match="escapes"):
        d.prepare(manifest, root, model=d.DEFAULT_MODEL, repeats=3, max_edge=1024)


def test_preflight_missing_model_no_fallback(prepared):
    from levelbuilder import difficulty as d

    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"data": []}))) as client:
        with pytest.raises(d.DifficultyError, match="no fallback"):
            d.model_preflight(client, prepared["config"])


def test_cache_settings_change_fails_before_spending(prepared, pilot, tmp_path, metering):
    from levelbuilder import difficulty as d

    calls = []
    with mock_network(lambda r: httpx.Response(200, json=completion()), calls) as network:
        d.execute(prepared, pilot[0], tmp_path / "out", 1, client=network)
        prepared["config"]["thinking"] = "high"
        with pytest.raises(d.DifficultyError, match="different inputs/settings"):
            d.execute(prepared, pilot[0], tmp_path / "out", 1, client=network)
    assert len([r for r in calls if r.method == "POST"]) == 3


def test_cli_requires_budget_and_output(pilot, capsys):
    root, manifest = pilot
    assert cli.main(["difficulty", "--json", "--manifest", str(manifest), "--repo-root", str(root), "--execute"]) == 2
    assert "requires --out-dir and --budget-usd" in capsys.readouterr().out


@pytest.mark.parametrize("cost", [-1, float("nan"), float("inf"), "0", True])
def test_corrupt_cached_cost_blocks_before_any_network(cost, prepared, pilot, tmp_path, metering):
    from levelbuilder import difficulty as d

    out = tmp_path / "out"
    with mock_network(lambda r: httpx.Response(200, json=completion()), []) as network:
        d.execute(prepared, pilot[0], out, 1, client=network)
    path = out / "state.json"
    state = json.loads(path.read_text())
    state["calls"][next(iter(state["calls"]))]["costUsd"] = cost
    path.write_text(json.dumps(state))
    with httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("network after corrupt cache"))) as network:
        with pytest.raises(d.DifficultyError, match="invalid metered cost"):
            d.execute(prepared, pilot[0], out, 1, client=network)


def test_completed_cache_is_offline_without_key(prepared, pilot, tmp_path, metering, monkeypatch):
    from levelbuilder import difficulty as d

    out = tmp_path / "out"
    with mock_network(lambda r: httpx.Response(200, json=completion()), []) as network:
        first = d.execute(prepared, pilot[0], out, 1, client=network)
    monkeypatch.delenv("OPENROUTER_API_KEY")
    with httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("network for complete cache"))) as network:
        again = d.execute(prepared, pilot[0], out, 1, client=network)
    assert again["paidCalls"] == 0
    assert again["ranking"] == first["ranking"]


def test_partial_budget_resume_charges_only_missing_trials(prepared, pilot, tmp_path, metering):
    from levelbuilder import difficulty as d

    calls = []
    out = tmp_path / "out"
    with mock_network(lambda r: httpx.Response(200, json=completion()), calls) as network:
        with pytest.raises(d.DifficultyError, match="budget"):
            d.execute(prepared, pilot[0], out, 0.027, client=network)
        assert len([r for r in calls if r.method == "POST"]) == 1
        result = d.execute(prepared, pilot[0], out, 0.03, client=network)
    assert result["paidCalls"] == 2
    assert result["meteredTotalUsd"] == pytest.approx(0.003)
    assert len(metering) == 3


def test_changed_sprite_rejected(pilot):
    from levelbuilder import difficulty as d

    root, path = pilot
    (root / "games/find_the_dog/public/levels/demo/sprite.png").write_bytes(b"changed")
    with pytest.raises(d.DifficultyError, match="sprite set changed"):
        d.prepare(path, root, model=d.DEFAULT_MODEL, repeats=3, max_edge=1024)


def test_output_lock_rejects_concurrent_run(pilot, tmp_path):
    from levelbuilder import difficulty as d

    with d.output_lock(tmp_path / "out", pilot[0]):
        with pytest.raises(d.DifficultyError, match="another scorer"):
            with d.output_lock(tmp_path / "out", pilot[0]):
                pytest.fail("concurrent output lock")


def test_symlink_output_cannot_write_game(pilot, tmp_path):
    from levelbuilder import difficulty as d

    link = tmp_path / "link"
    link.symlink_to(pilot[0] / "games/find_the_dog/public", target_is_directory=True)
    with pytest.raises(d.DifficultyError, match="outside"):
        with d.output_lock(link, pilot[0]):
            pytest.fail("output into game symlink")


def test_wrong_response_model_is_not_scored(prepared, pilot, tmp_path, metering):
    from levelbuilder import difficulty as d

    body = completion()
    body["model"] = "google/something-else"
    calls = []
    with mock_network(lambda r: httpx.Response(200, json=body), calls) as network:
        with pytest.raises(d.DifficultyError, match="different model"):
            d.execute(prepared, pilot[0], tmp_path / "out", 1, client=network)
    assert len(metering) == 1


def test_large_asset_stops_before_decoding(pilot, monkeypatch):
    from levelbuilder import difficulty as d

    monkeypatch.setattr(d, "MAX_ASSET_BYTES", 10)
    with pytest.raises(d.DifficultyError, match="byte limit"):
        d.prepare(pilot[1], pilot[0], model=d.DEFAULT_MODEL, repeats=3, max_edge=1024)


def test_cache_invalid_detections_before_network(prepared, pilot, tmp_path, metering):
    from levelbuilder import difficulty as d

    out = tmp_path / "out"
    with mock_network(lambda r: httpx.Response(200, json=completion()), []) as network:
        d.execute(prepared, pilot[0], out, 1, client=network)
    path = out / "state.json"
    state = json.loads(path.read_text())
    state["calls"][next(iter(state["calls"]))]["detections"] = {"dogs": "invalid"}
    path.write_text(json.dumps(state))
    with httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("network after corrupt cache"))) as network:
        with pytest.raises(d.DifficultyError, match="invalid detections"):
            d.execute(prepared, pilot[0], out, 1, client=network)


def test_manifest_id_cannot_contain_path_segments(pilot):
    from levelbuilder import difficulty as d

    root, manifest = pilot
    value = json.loads(manifest.read_text())
    row = value["levels"][0]
    row["levelId"] = "../demo"
    level_path = root / row["levelJson"]["path"]
    level = json.loads(level_path.read_text())
    level["id"] = "../demo"
    level_path.write_text(json.dumps(level))
    row["levelJson"]["sha256"] = digest(level_path.read_bytes())
    manifest.write_text(json.dumps(value))
    with pytest.raises(d.DifficultyError, match="identity"):
        d.prepare(manifest, root, model=d.DEFAULT_MODEL, repeats=3, max_edge=1024)


def test_explicit_empty_model_is_not_substituted(pilot, capsys, monkeypatch):
    from levelbuilder import difficulty as d

    monkeypatch.setattr(d, "model_preflight", lambda *a: pytest.fail("network on invalid model"))
    root, manifest = pilot
    code = cli.main(["difficulty", "--json", "--manifest", str(manifest), "--repo-root", str(root),
                     "--model", "", "--preflight"])
    assert code == 2
    assert json.loads(capsys.readouterr().out)["error"]["code"] == "difficulty_invalid"


def test_astra_uses_same_images_but_separate_cache_and_no_temperature(pilot, prepared):
    from levelbuilder import difficulty as d

    astra = d.prepare(pilot[1], pilot[0], model=d.ASTRA_MODEL, repeats=3, max_edge=1024)
    assert astra["levels"][0]["imageSha256"] == prepared["levels"][0]["imageSha256"]
    assert astra["levels"][0]["fingerprint"] != prepared["levels"][0]["fingerprint"]
    assert astra["config"]["prompt"] == prepared["config"]["prompt"]
    payload = d.request_payload(astra["config"], astra["levels"][0], {"prompt": 0.00002, "completion": 0.000075})
    assert payload["model"] == d.ASTRA_MODEL
    assert "temperature" not in payload


def test_astra_preflight_reserves_highest_price_tier(pilot):
    from levelbuilder import difficulty as d

    astra = d.prepare(pilot[1], pilot[0], model=d.ASTRA_MODEL, repeats=3, max_edge=1024)
    entry = catalog()["data"][0]
    entry["id"] = d.ASTRA_MODEL
    entry["supported_parameters"].remove("temperature")
    entry["pricing"] = {"prompt": "0.00001", "completion": "0.00005",
                        "overrides": [{"min_prompt_tokens": 272000, "prompt": "0.00002",
                                       "completion": "0.000075", "input_cache_write": "0.000025"}]}
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"data": [entry]}))) as client:
        result = d.model_preflight(client, astra["config"])
    assert result["priceCaps"]["prompt"] == 0.00002
    assert result["perCallReserveUsd"] == pytest.approx(10000 * 0.000025 + 8192 * 0.000075)
