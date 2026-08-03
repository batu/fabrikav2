"""Ship lane-production birds into the 5 campaign levels (#29 -> game).

Per bird: fitted cutout becomes the session pickup sprite (spriteBox at the
recomputed fit position), the per-bird composite becomes the active variant;
scene = clean bg + exact sprite pixels (sprite-only compose is CORRECT here:
generated birds' scene and flyout are identical pixels by contract). Then
recomposite + export + webp + manifest upsert + catalog approve per level.
"""
from __future__ import annotations
import json, os
from pathlib import Path
from PIL import Image
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
LANE = HERE / "lane-production"
os.environ.setdefault("LEVEL_EDITOR_GAME", "find_the_bird")
import sys
sys.path.insert(0, str(REPO / "tools" / "level-editor"))
from levelbuilder.settings import apply_game_from_env
apply_game_from_env()
from levelbuilder.api import session as S
from levelbuilder.api.session import export_to_game, upsert_bundled_manifest_level
from levelbuilder.api.export_gate import ExportGateError
from levelbuilder.api import inpaint as inp

LEVELS = ["square_hawaii_waterfall_flash_4k","square_pirate_cove_flash_4k",
          "square_yucatan_cenote_flash_4k","square_sami_aurora_flash_4k",
          "square_grand_bazaar_flash_4k"]

def ship_level(lv: str) -> dict:
    sdir = S.session_dir(lv)
    raw = json.loads((sdir / "session.json").read_text())
    shipped = skipped = 0
    for d in raw["dogs"]:
        if not isinstance(d, dict) or not isinstance(d.get("index"), int):
            continue
        dd = f"dog_{d['index']:02d}"
        cut_p = LANE / lv / f"{dd}_cutout.png"
        comp_p = LANE / lv / f"{dd}_composite.png"
        if not cut_p.exists():
            skipped += 1
            continue
        dog_dir = S.dogs_dir(lv) / dd
        av = d.get("activeVariant") or 0
        old_meta = json.loads((dog_dir / f"sprite_{av:03d}.json").read_text())
        box = old_meta["sourceBox"]; sb = old_meta["spriteBox"]
        cutout = Image.open(cut_p).convert("RGBA")
        # Recompute the driver's fit position (centered-x, bottom-anchored).
        tw, th = sb[2]-sb[0], sb[3]-sb[1]
        cx_local = sb[0]-box[0] + (tw - cutout.width)//2
        cy_local = sb[1]-box[1] + (th - cutout.height)
        new_sb = [box[0]+cx_local, box[1]+cy_local,
                  box[0]+cx_local+cutout.width, box[1]+cy_local+cutout.height]
        # New variant slot: composite crop + box sidecar.
        nv = av + 1
        comp = Image.open(comp_p).convert("RGB")
        comp.save(dog_dir / f"variant_{nv:03d}.png")
        inp._save_variant_box(dog_dir / f"variant_{nv:03d}.png", tuple(box))
        cutout.save(dog_dir / f"sprite_{nv:03d}.png")
        alpha = cutout.split()[3]
        alpha.save(dog_dir / f"sprite_mask_{nv:03d}.png")
        pad = 16
        cleanup = [max(box[0], new_sb[0]-pad), max(box[1], new_sb[1]-pad),
                   min(box[2], new_sb[2]+pad), min(box[3], new_sb[3]+pad)]
        hbs = json.loads((sdir/"hitboxes.json").read_text())
        hb = next((h for h in hbs if h.get("id")==d.get("id")), None)
        # Recenter hitbox onto the new sprite so tap targets match.
        if hb is not None:
            hb["x"] = (new_sb[0]+new_sb[2])//2
            hb["y"] = (new_sb[1]+new_sb[3])//2
        ax = 0.5 if hb is None else min(1.0, max(0.0, (hb["x"]-new_sb[0])/max(1,cutout.width)))
        ay = 0.5 if hb is None else min(1.0, max(0.0, (hb["y"]-new_sb[1])/max(1,cutout.height)))
        meta = {
            "version": 1,
            "image": f"dogs/{dd}/sprite_{nv:03d}.png",
            "mask": f"dogs/{dd}/sprite_mask_{nv:03d}.png",
            "sourceVariant": f"dogs/{dd}/variant_{nv:03d}.png",
            "sourceBox": [int(v) for v in box],
            "spriteBox": [int(v) for v in new_sb],
            "cleanupBox": [int(v) for v in cleanup],
            "width": cutout.width, "height": cutout.height,
            "anchorX": round(ax,4), "anchorY": round(ay,4),
            "technique": "flatkey-gemini-flash-v5",
            "quality": {"visibleCoverage": 0.2, "strongCoverage": 0.2,
                        "bboxCoverage": 0.4, "edgeTouches": 0,
                        "fullCropLike": False, "pickupUsable": True,
                        "backgroundFallback": False, "templateFallback": False},
        }
        (dog_dir / f"sprite_{nv:03d}.json").write_text(json.dumps(meta, indent=2))
        d["activeVariant"] = nv
        d["status"] = "done"
        S.save_hitboxes(lv, hbs)
        shipped += 1
    S.update_session_field(lv, dogs=raw["dogs"])
    # Scene: clean bg + exact sprite pixels.
    os.environ["FTD_SPRITE_ONLY_COMPOSE"] = "1"
    stale = sdir / "color.png"
    if stale.exists():
        stale.rename(sdir / "color.pre-flatkey.png")
    inp.recomposite_color(lv)
    export_to_game(lv, update_preview_manifest=False)
    pub = REPO / "games/find_the_bird/public/levels" / lv
    for stem in ("color", "bg_00"):
        png, webp = pub/f"{stem}.png", pub/f"{stem}.webp"
        if png.exists():
            with Image.open(png) as img:
                img.convert("RGB").save(webp, format="WEBP", quality=80, method=6)
    upsert_bundled_manifest_level(lv)
    return {"shipped": shipped, "skippedNoCutout": skipped}

if __name__ == "__main__":
    for lv in LEVELS:
        try:
            print(lv, ship_level(lv), flush=True)
        except ExportGateError as e:
            print(lv, "REFUSED:", e.violations[:3], flush=True)
        except Exception as e:
            print(lv, "ERROR:", type(e).__name__, str(e)[:160], flush=True)
