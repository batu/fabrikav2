"""Publish FTB levels for the bundled-starter + CDN-streaming build.

Produces, from the exported public levels:
  1. games/find_the_bird/public/levels/bundled-manifest.json — ONLY the
     starter-prefix entries (the native bundle plugin ships exactly the
     paths this file references; 100 MB cap enforced at build).
  2. A CDN staging dir with the runtime's static contract:
       manifest.json               (ManifestV1, ALL levels, array order =
                                    level progression when RC is disabled)
       assets/<sha256>.<ext>       (content-addressed level.json / color.webp
                                    / bg webps — runtime verifies the hash)
       levels/<id>/dogs/**         (sprites stay path-addressed: cdnAssetPath
                                    exempts '/dogs/' paths)
  3. Rewrites levels-index.json to the same order (editor/game-view parity).

Usage:
  uv run python scripts/publish_ftb_cdn.py --starters N --order-file order.txt \
      [--staging DIR] [--rsync user@host:/var/www/ftb-cdn]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from levelbuilder.settings import resolve_game  # noqa: E402
resolve_game("find_the_bird").apply()
from levelbuilder.api import public_levels as P  # noqa: E402
from levelbuilder.api import session as S  # noqa: E402


def build(order: list[str], starters: int, staging: Path, rsync_target: str | None) -> None:
    entries = []
    for sid in order:
        entry = P.public_level_manifest_entry(S.GAME_PUBLIC_LEVELS, sid)
        entry["bundled"] = order.index(sid) < starters
        entries.append(entry)

    now = P.utc_now_iso()
    prev = S.load_bundled_manifest() or {}
    revision = int(prev.get("manifestRevision") or 0) + 1

    def manifest(levels: list[dict]) -> dict:
        return {
            "version": 1,
            "manifestRevision": revision,
            "generatedAt": now,
            "experimentId": "ftd_levelset_v1",
            "levels": levels,
        }

    # 1. In-app bundled manifest: starter entries only.
    S.save_bundled_manifest(manifest([e for e in entries if e["bundled"]]))

    # 2. CDN staging.
    if staging.exists():
        shutil.rmtree(staging)
    (staging / "assets").mkdir(parents=True)
    (staging / "manifest.json").write_text(json.dumps(manifest(entries), indent=2))

    copied = 0
    for entry in entries:
        sid = entry["id"]
        assets = entry["assets"]
        flat = [assets["levelJson"], assets["colorImage"], *assets.get("bgImages", [])]
        for desc in flat:
            src = S.GAME_PUBLIC_LEVELS.parent / desc["path"]
            ext = Path(desc["path"]).suffix
            dst = staging / "assets" / f"{desc['hash']}{ext}"
            if not dst.exists():
                shutil.copyfile(src, dst)
                copied += 1
        dogs_src = S.GAME_PUBLIC_LEVELS / sid / "dogs"
        if dogs_src.exists():
            shutil.copytree(dogs_src, staging / "levels" / sid / "dogs", dirs_exist_ok=True)

    # 3. levels-index parity (id order = progression).
    index_path = S.GAME_PUBLIC_LEVELS / "levels-index.json"
    index_path.write_text(json.dumps(
        [{"id": e["id"], "name": e["name"]} for e in entries], indent=2))

    size = sum(f.stat().st_size for f in staging.rglob("*") if f.is_file())
    print(f"staged {len(entries)} levels ({starters} bundled), "
          f"{copied} hashed assets, {size/1e6:.0f} MB at {staging}")

    if rsync_target:
        # Assets first, manifest LAST (cold-launchers mid-upload never see a
        # manifest pointing at an unuploaded hash — v1 publisher contract).
        subprocess.run(["rsync", "-az", "--delete",
                        "--exclude", "manifest.json",
                        f"{staging}/", rsync_target], check=True)
        subprocess.run(["rsync", "-az", str(staging / "manifest.json"),
                        f"{rsync_target}/manifest.json"], check=True)
        print(f"published to {rsync_target}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--starters", type=int, required=True)
    ap.add_argument("--order-file", required=True,
                    help="one level id per line, progression order")
    ap.add_argument("--staging", default=str(Path.home() / ".ftb-cdn-staging"))
    ap.add_argument("--rsync", default=None, help="user@host:/path target")
    args = ap.parse_args()
    order = [l.strip() for l in Path(args.order_file).read_text().splitlines()
             if l.strip() and not l.startswith("#")]
    missing = [sid for sid in order if not (S.GAME_PUBLIC_LEVELS / sid / "level.json").exists()]
    if missing:
        raise SystemExit(f"not exported: {missing}")
    build(order, args.starters, Path(args.staging), args.rsync)


if __name__ == "__main__":
    main()
