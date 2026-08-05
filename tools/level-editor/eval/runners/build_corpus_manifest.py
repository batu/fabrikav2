"""Build the auto-label training corpus manifest (READ-ONLY over sessions).

Corpus = non-golden sessions with painted color.png + per-bird spriteBox
metadata (dogs/dog_XX/sprite_000.json) — materialization-time bird bounding
boxes, far cleaner than raw diff masks (global repaint drift makes whole-image
diffs useless as labels; measured 2026-08-05).

Each corpus entry records its scene FAMILY (sid minus trailing variant
suffixes). Any trained candidate evaluated on a golden level must exclude all
corpus sessions sharing that level's family (leakage guard: variants are
repaints of the same scene, often with identical bird positions).

Writes eval/corpus/corpus.json: {sid: {family, color, dims, boxes: [[x0,y0,x1,y1],...]}}
"""

from __future__ import annotations

import json
import re
from pathlib import Path

LEVELS = Path("/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels")
EVAL_DIR = Path(__file__).resolve().parent.parent
GOLDEN = json.loads((EVAL_DIR / "golden-hitboxes-2026-08-05/manifest.json").read_text())

# Known variant suffixes seen in the levels dir + trailing 4-hex session ids.
SUFFIX = re.compile(
    r"(_[0-9a-f]{4}|_native2k|_poststretch\d*|_adopt|_comp|_gpro|_gpt\d*|_mgguard"
    r"|_v\d+code|_v\d+|_[a-z0-9]{1,10})$"
)


def family_of(sid: str) -> str:
    # Peel trailing variant tokens until the "*_bird" stem remains.
    s = sid
    while not s.endswith("_bird"):
        s = s.rstrip("_")
        if s.endswith("_bird"):
            break
        m = SUFFIX.search(s)
        if not m:
            break
        s = s[: m.start()]
    return s


def main() -> None:
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    corpus: dict[str, dict] = {}
    golden_families = {family_of(g) for g in GOLDEN}
    for sdir in sorted(LEVELS.iterdir()):
        if not sdir.is_dir() or sdir.name in GOLDEN:
            continue
        if not (sdir / "color.png").exists():
            continue
        boxes = []
        for meta_path in sorted(sdir.glob("dogs/dog_*/sprite_000.json")):
            try:
                sb = json.loads(meta_path.read_text()).get("spriteBox")
            except (OSError, ValueError):
                continue
            if isinstance(sb, list) and len(sb) == 4:
                boxes.append([int(v) for v in sb])
        if not boxes:
            continue
        with Image.open(sdir / "color.png") as im:
            dims = list(im.size)
        corpus[sdir.name] = {
            "family": family_of(sdir.name),
            "color": str(sdir / "color.png"),
            "dims": dims,
            "boxes": boxes,
        }
    out = EVAL_DIR / "corpus"
    out.mkdir(exist_ok=True)
    (out / "corpus.json").write_text(json.dumps(corpus, indent=1))
    fams = {}
    for sid, e in corpus.items():
        fams.setdefault(e["family"], []).append(sid)
    print(f"corpus: {len(corpus)} sessions, {sum(len(e['boxes']) for e in corpus.values())} boxes, "
          f"{len(fams)} families ({sum(1 for f in fams if f in golden_families)} overlap golden)")
    print("golden families:", len(golden_families))
    for f in sorted(fams):
        mark = "*" if f in golden_families else " "
        print(f" {mark} {f}: {len(fams[f])}")


if __name__ == "__main__":
    main()
