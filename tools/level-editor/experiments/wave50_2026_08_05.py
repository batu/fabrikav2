"""Wave-50: 50 all-easy levels through the canonical lane (2026-08-05).

30 scenes from the existing catalog (hawaii-heavy per Batu) + 20 brand-new
scenes (greece / southeast_asia / cozy_interiors / american_southwest).
Everything uses the fall level's framing: isometric_close_20, 1:1, count 16,
clean_old_cartoon.

Didactic contract: every level appends a journal row (timings per step,
hitboxes placed vs VLM-found, prune count, approve verdict, ledger spend
delta) to wave50_journal.jsonl. Failures never stop the batch. Restartable:
scenes already journaled as complete are skipped.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from levelbuilder.settings import resolve_game  # noqa: E402
resolve_game("find_the_bird").apply()
from levelbuilder.api import session as S  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
JOURNAL = Path(__file__).parent / "wave50_journal.jsonl"
LEDGER = Path.home() / ".merceka/costs.jsonl"

SCENES: list[tuple[str, str]] = [
    # (setting, scene) — 30 existing
    *[("hawaii", s) for s in (
        "hawaii_waikiki_beach_market", "hawaii_volcano_national_park",
        "hawaii_rainforest_waterfall", "hawaii_luau_sunset_courtyard",
        "hawaii_north_shore_surf_shack")],
    ("japan", "japan_morning_market"), ("japan", "japan_temple_garden"),
    ("japan", "japan_night_harbor"),
    ("fairytale_forest", "fairytale_forest_mushroom_cottage_glade"),
    ("fairytale_forest", "fairytale_forest_witches_herb_hut"),
    ("fairytale_forest", "fairytale_forest_giant_hollow_tree_library"),
    ("pirate_shipwreck_island", "pirate_shipwreck_island_treasure_cove_camp"),
    ("pirate_shipwreck_island", "pirate_shipwreck_island_broken_bow_lagoon"),
    ("pirate_shipwreck_island", "pirate_shipwreck_island_dock_fragment_hideout"),
    ("mexico", "mexico_oaxaca_market"), ("mexico", "mexico_yucatan_cenote_ruins"),
    ("italy", "italy_venice_canal_morning"), ("italy", "italy_amalfi_cliff_lemons"),
    ("turkey", "turkey_cappadocia_balloon_dawn"), ("turkey", "turkey_grand_bazaar_corridor"),
    ("nordic_cold", "nordic_cold_bergen_harbor"),
    ("nordic_cold", "nordic_cold_stockholm_christmas_market"),
    ("france", "france_provence_lavender_village"),
    ("france", "france_mont_saint_michel_causeway"),
    ("uk", "uk_cotswolds_village"),
    ("alpine_meadow", "alpine_meadow_cheese_farm_courtyard"),
    ("railway_roundhouse", "railway_roundhouse_garden_rail_museum"),
    ("ad_campaigns", "ad_treehouse_village"), ("ad_campaigns", "ad_cozy_library"),
    ("ad_campaigns", "ad_farm_orchard"),
    # 20 new
    *[("greece", s) for s in (
        "greece_santorini_steps", "greece_olive_grove_press",
        "greece_harbor_taverna_morning", "greece_hilltop_windmills",
        "greece_agora_ruins_garden")],
    *[("southeast_asia", s) for s in (
        "sea_floating_market", "sea_rice_terrace_village",
        "sea_jungle_temple_ruins", "sea_stilt_village_shore",
        "sea_lantern_festival_canal")],
    *[("cozy_interiors", s) for s in (
        "cozy_greenhouse_conservatory", "cozy_attic_workshop",
        "cozy_village_bakery_kitchen", "cozy_toymaker_workshop",
        "cozy_potting_shed_garden")],
    *[("american_southwest", s) for s in (
        "sw_adobe_courtyard", "sw_canyon_river_camp", "sw_cactus_garden_ranch",
        "sw_desert_trading_post", "sw_mesa_campground")],
]
assert len(SCENES) == 50, len(SCENES)


def cli(*args: str) -> tuple[int, str]:
    r = subprocess.run(["uv", "run", "level-editor", *args],
                       cwd=ROOT, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr)


def ledger_usd_since(ts: str) -> float:
    total = 0.0
    for line in LEDGER.read_text().splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("ts", "") >= ts:
            total += row.get("usd") or 0.0
    return total


def newest_session() -> str:
    dirs = [d for d in S.LEVELS_DIR.iterdir() if (d / "session.json").exists()]
    return max(dirs, key=lambda d: (d / "session.json").stat().st_mtime).name


def done_scenes() -> set[str]:
    if not JOURNAL.exists():
        return set()
    return {json.loads(l)["scene"] for l in JOURNAL.read_text().splitlines()
            if json.loads(l).get("complete")}


def run_level(setting: str, scene: str) -> dict:
    row: dict = {"setting": setting, "scene": scene, "steps": {}, "notes": []}
    t_start = time.time()
    ledger_t0 = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())

    def step(name: str, *args: str) -> bool:
        t0 = time.time()
        code, out = cli(*args)
        row["steps"][name] = {"s": round(time.time() - t0, 1), "ok": code == 0}
        if code != 0:
            row["steps"][name]["err"] = out[-300:]
            row["notes"].append(f"{name} failed")
        return code == 0

    if not step("create", "create", "--setting", setting, "--scene", scene,
                "--entity", "bird", "--style", "clean_old_cartoon",
                "--view", "isometric_close_20", "--aspect-ratio", "1:1",
                "--count", "16"):
        return row
    sid = newest_session()
    row["sid"] = sid

    step("author", "author", "--session-id", sid, "--start-from", "generate-bg",
         "--stop-after", "fix-hitboxes", "--inpaint-mode", "magenta",
         "--strategy", "smart")
    step("vlm", "place-hitboxes-vlm", sid)
    try:
        hbs = json.loads((S.session_dir(sid) / "hitboxes.json").read_text())
        row["hitboxes"] = len(hbs)
    except Exception:
        row["hitboxes"] = None
    step("materialize", "materialize-hitbox-sprites", sid)
    step("recenter", "recenter-hitboxes-local", sid, "--prune-empty")
    try:
        row["hitboxes_final"] = len(json.loads((S.session_dir(sid) / "hitboxes.json").read_text()))
    except Exception:
        row["hitboxes_final"] = None
    approved = step("approve", "approve", sid)
    row["approved"] = approved
    row["usd"] = round(ledger_usd_since(ledger_t0), 4)
    row["wall_s"] = round(time.time() - t_start, 1)
    row["complete"] = all(v.get("ok") for v in row["steps"].values())
    return row


def main() -> None:
    skip = done_scenes()
    for i, (setting, scene) in enumerate(SCENES, 1):
        if scene in skip:
            print(f"[{i:02d}/50] {scene}: already done, skipping", flush=True)
            continue
        print(f"[{i:02d}/50] {scene} ...", flush=True)
        row = run_level(setting, scene)
        with open(JOURNAL, "a") as f:
            f.write(json.dumps(row) + "\n")
        status = "OK" if row.get("complete") else "PARTIAL"
        print(f"[{i:02d}/50] {scene}: {status} sid={row.get('sid')} "
              f"hb={row.get('hitboxes')}→{row.get('hitboxes_final')} "
              f"${row.get('usd')} {row.get('wall_s')}s "
              f"{'; '.join(row['notes']) if row['notes'] else ''}", flush=True)
    print("WAVE50 DONE", flush=True)


if __name__ == "__main__":
    main()
