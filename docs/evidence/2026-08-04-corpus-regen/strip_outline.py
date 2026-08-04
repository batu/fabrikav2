"""Strip the baked white sticker rim from the shipped flat-key sprites.

New variant slot per dog (stripped sprite + mask, boxes unchanged since the
canvas keeps its size), then recomposite + export + webp + manifest per level.
"""
import json, os, sys
sys.path.insert(0, "/Users/base/dev/appletolye/fabrikav2/tools/level-editor")
os.environ.setdefault("LEVEL_EDITOR_GAME", "find_the_bird")
from levelbuilder.settings import apply_game_from_env
apply_game_from_env()
import numpy as np
from PIL import Image
from scipy import ndimage
from levelbuilder.api import session as S, inpaint as inp
from levelbuilder.api.session import export_to_game, upsert_bundled_manifest_level
from pathlib import Path

REPO = Path("/Users/base/dev/appletolye/fabrikav2")
LEVELS = ["square_hawaii_waterfall_flash_4k", "square_pirate_cove_flash_4k",
          "square_yucatan_cenote_flash_4k", "square_sami_aurora_flash_4k",
          "square_grand_bazaar_flash_4k"]

def strip_white_rim(img):
    a = np.array(img.convert("RGBA"), dtype=np.uint8)
    rgb, al = a[...,:3].astype(int), a[...,3]
    whiteish = (rgb.min(axis=2) >= 215) & (al > 0)
    transparent = al == 0
    edge = ndimage.binary_dilation(np.pad(transparent, 1, constant_values=True))[1:-1,1:-1]
    lab, n = ndimage.label(whiteish)
    rim = np.zeros_like(whiteish)
    for i in range(1, n+1):
        m = lab == i
        if (m & edge).any():
            rim |= m
    halo = ndimage.binary_dilation(rim) & (rgb.min(axis=2) >= 185) & ~rim
    a[...,3][rim | halo] = 0
    return Image.fromarray(a), int((rim | halo).sum())

def run_level(lv):
    sdir = S.session_dir(lv)
    raw = json.loads((sdir / "session.json").read_text())
    done = 0
    for d in raw["dogs"]:
        if not isinstance(d, dict) or not isinstance(d.get("index"), int):
            continue
        dd = f"dog_{d['index']:02d}"
        dog_dir = S.dogs_dir(lv) / dd
        av = d.get("activeVariant") or 0
        meta = json.loads((dog_dir / f"sprite_{av:03d}.json").read_text())
        if meta.get("technique") != "flatkey-gemini-flash-v5":
            continue
        sp = Image.open(dog_dir / f"sprite_{av:03d}.png")
        stripped, removed = strip_white_rim(sp)
        nv = av + 1
        stripped.save(dog_dir / f"sprite_{nv:03d}.png")
        stripped.split()[3].save(dog_dir / f"sprite_mask_{nv:03d}.png")
        src_var = dog_dir / f"variant_{av:03d}.png"
        if src_var.exists():
            import shutil
            shutil.copy(src_var, dog_dir / f"variant_{nv:03d}.png")
            box_sidecar = dog_dir / f"variant_{av:03d}.box.json"
            if box_sidecar.exists():
                shutil.copy(box_sidecar, dog_dir / f"variant_{nv:03d}.box.json")
        meta = dict(meta)
        meta["image"] = f"dogs/{dd}/sprite_{nv:03d}.png"
        meta["mask"] = f"dogs/{dd}/sprite_mask_{nv:03d}.png"
        meta["sourceVariant"] = f"dogs/{dd}/variant_{nv:03d}.png"
        meta["technique"] = "flatkey-gemini-flash-v5-noborder"
        (dog_dir / f"sprite_{nv:03d}.json").write_text(json.dumps(meta, indent=2))
        d["activeVariant"] = nv
        done += 1
    S.update_session_field(lv, dogs=raw["dogs"])
    os.environ["FTD_SPRITE_ONLY_COMPOSE"] = "1"
    inp.recomposite_color(lv)
    export_to_game(lv, update_preview_manifest=False)
    pub = REPO / "games/find_the_bird/public/levels" / lv
    for stem in ("color", "bg_00"):
        png, webp = pub/f"{stem}.png", pub/f"{stem}.webp"
        if png.exists():
            with Image.open(png) as img:
                img.convert("RGB").save(webp, format="WEBP", quality=80, method=6)
    upsert_bundled_manifest_level(lv)
    return done

if __name__ == "__main__":
    for lv in LEVELS:
        print(lv, run_level(lv), flush=True)
