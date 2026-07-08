#!/usr/bin/env python3
"""Scaffold L5 Mirror + L9 Pictograms packs (explicit arrows mode)."""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEVELS = ROOT / "levels"


def write(pack_slug, idx, slug, cols, rows, arrows, transform=None, title="", difficulty="medium"):
    d = LEVELS / pack_slug
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{idx:02d}-{slug}.yaml"
    if p.exists():
        print(f"skip  {p.relative_to(ROOT)}")
        return
    # JSON-ify with no spaces inside arrays.
    arrows_json = json.dumps(arrows).replace(" ", "")
    lines = [
        f"cols: {cols}",
        f"rows: {rows}",
        f"arrows: {arrows_json}",
    ]
    if transform:
        lines.append(f"transform: {transform}")
    lines.extend([
        "meta:",
        f"  pack: {pack_slug}",
        f"  indexInPack: {idx}",
        f"  title: {title}",
        f"  difficulty: {difficulty}",
    ])
    p.write_text("\n".join(lines) + "\n")
    print(f"wrote {p.relative_to(ROOT)}")


# ============ L5 Mirror ============
# Each recipe places arrows in ONE half. transform duplicates them.
# For mirror-x on cols=7: authored cells keep x ≤ 2 (strict left half);
# the mirror lands at x ≥ 4 (strict right half). No overlap possible.
# For rotate-180 on any grid: authored cells stay in the top-left
# quadrant. Rotated copies land in bottom-right. Middle rows/cols OK.

# mirror-x: only vertical arrows. A horizontal arrow spans across the
# mirror axis and its mirrored copy collides with its own body. Vertical
# arrows on opposite sides never share a column, so both can exit
# independently.
write("mirror", 1, "reflection", 7, 7,
      [[[1,3],[1,2]], [[2,5],[2,6]]],
      transform="mirror-x", title="Reflection", difficulty="easy")
write("mirror", 2, "paired", 7, 7,
      [[[0,3],[0,2]], [[1,4],[1,5]]],
      transform="mirror-x", title="Paired", difficulty="easy")
write("mirror", 3, "bilateral", 7, 8,
      [[[0,1],[0,0]], [[1,4],[1,3]], [[2,7],[2,6]]],
      transform="mirror-x", title="Bilateral", difficulty="medium")
write("mirror", 4, "butterfly", 7, 8,
      [[[0,2],[0,1],[0,0]], [[1,5],[1,4],[1,3]]],
      transform="mirror-x", title="Butterfly", difficulty="medium")
write("mirror", 5, "pairwise", 7, 9,
      [[[0,1],[0,0]], [[1,3],[1,2]], [[2,5],[2,4]], [[0,8],[0,7]]],
      transform="mirror-x", title="Pairwise", difficulty="medium")

# Rotate-180 on cols=cols, rows=rows → (x,y) → (cols-1-x, rows-1-y).
# Keep authored cells strictly in top-left quadrant to avoid overlap.
write("mirror", 6, "spin", 7, 7,
      [[[0,0],[0,1]], [[1,2],[2,2]]],
      transform="rotate-180", title="Spin", difficulty="medium")
write("mirror", 7, "pinwheel", 8, 8,
      [[[0,0],[1,0]], [[0,2],[0,3]]],
      transform="rotate-180", title="Pinwheel", difficulty="medium")
write("mirror", 8, "windmill", 8, 8,
      [[[0,0],[1,0],[2,0]], [[0,2],[0,3]], [[3,0],[3,1]]],
      transform="rotate-180", title="Windmill", difficulty="hard")
write("mirror", 9, "carousel", 8, 8,
      [[[0,0],[1,0]], [[0,2],[0,3]], [[2,1],[3,1]]],
      transform="rotate-180", title="Carousel", difficulty="hard")
write("mirror", 10, "mirror-finale", 9, 9,
      [[[0,0],[0,1]], [[1,2],[2,2]], [[0,3],[0,4]], [[3,0],[3,1]]],
      transform="rotate-180", title="Mirror Finale", difficulty="hard")


# ============ L9 Pictograms ============
# Simple recognizable arrangements. Each uses 4-10 short arrows whose
# positioning suggests a glyph. All arrows are 2-cell (length 2) to
# give the solver easy exits.

# Plus sign — 4 arrows pointing outward from each arm tip.
write("pictograms", 1, "plus", 7, 7, [
    [[3,1],[3,0]],  # top arm, head (3,0) N
    [[5,3],[6,3]],  # right arm, head (6,3) E
    [[3,5],[3,6]],  # bottom, head (3,6) S
    [[1,3],[0,3]],  # left, head (0,3) W
], title="Plus", difficulty="easy")

# X — 4 arrows at 4 corners pointing outward diagonally (via cardinal).
write("pictograms", 2, "x-mark", 7, 7, [
    [[1,1],[0,0]],  # invalid — not 4-connected. Use 2 cells instead.
], title="X", difficulty="easy") if False else None
write("pictograms", 2, "four-corners", 7, 7, [
    [[1,1],[0,1]],
    [[5,1],[6,1]],
    [[1,5],[0,5]],
    [[5,5],[6,5]],
], title="Four Corners", difficulty="easy")

# Frame — 4 arrows along 4 edges pointing outward.
write("pictograms", 3, "frame", 8, 8, [
    [[0,3],[1,3]],  # wait that points INWARD. Reverse.
    [[3,0],[3,1]],  # pointing down INTO grid. I want OUT.
], title="Frame", difficulty="medium") if False else None
write("pictograms", 3, "outward", 8, 8, [
    [[3,1],[3,0]],  # top center → N
    [[6,3],[7,3]],  # right mid → E
    [[3,6],[3,7]],  # bottom → S
    [[1,3],[0,3]],  # left → W
    [[1,1],[0,1]],  # top-left corner → W
    [[6,1],[7,1]],  # top-right → E
    [[1,6],[0,6]],  # bottom-left → W
    [[6,6],[7,6]],  # bottom-right → E
], title="Frame", difficulty="medium")

# Heart — simplified to 2-cell arrows at 8 points suggesting a heart.
write("pictograms", 4, "heart", 9, 11, [
    [[2,1],[2,0]],  # top-left lobe tip → N
    [[6,1],[6,0]],  # top-right lobe tip → N
    [[0,3],[0,2]],  # left side → N (suggest lobe)
    [[8,3],[8,2]],  # right side → N
    [[0,5],[0,4]],  # left mid
    [[8,5],[8,4]],  # right mid
    [[3,8],[4,9]],  # bottom approach — wait not 4-connected vertical. Fix.
], title="Heart", difficulty="medium") if False else None
write("pictograms", 4, "heart", 9, 11, [
    [[2,1],[2,0]],
    [[6,1],[6,0]],
    [[0,3],[0,2]],
    [[8,3],[8,2]],
    [[0,5],[0,4]],
    [[8,5],[8,4]],
    [[3,9],[3,10]],
    [[5,9],[5,10]],
    [[4,10],[4,9]],
], title="Heart", difficulty="medium")

# Star — 5 arrows at star points.
write("pictograms", 5, "star", 9, 9, [
    [[4,1],[4,0]],  # top
    [[7,3],[8,3]],  # upper right
    [[1,3],[0,3]],  # upper left
    [[2,7],[2,8]],  # lower left
    [[6,7],[6,8]],  # lower right
], title="Star", difficulty="medium")

# Sun — rays in 8 directions.
write("pictograms", 6, "sun", 9, 9, [
    [[4,1],[4,0]],
    [[4,7],[4,8]],
    [[1,4],[0,4]],
    [[7,4],[8,4]],
    [[2,2],[1,1]] if False else [[2,2],[1,2]],
    [[6,2],[7,2]],
    [[2,6],[1,6]],
    [[6,6],[7,6]],
], title="Sun", difficulty="medium")

# Moon (crescent outline, left-open)
write("pictograms", 7, "moon", 7, 9, [
    [[3,1],[3,0]],
    [[5,2],[6,2]],
    [[5,6],[6,6]],
    [[3,7],[3,8]],
    [[1,3],[0,3]],
    [[1,5],[0,5]],
], title="Moon", difficulty="medium")

# Bolt (simplified — scatter of arrows along a zig-zag, pointing outward)
write("pictograms", 8, "bolt", 7, 11, [
    [[3,1],[3,0]],   # top, exit N
    [[1,3],[0,3]],   # left upper, exit W
    [[5,5],[6,5]],   # right mid, exit E
    [[1,7],[0,7]],   # left lower, exit W
    [[3,10],[3,9]],  # bottom arrow pointing S — wait, (3,10) head, (3,9) tail = head dir S
    # Actually head is last cell so (3,9) → (3,10) means head (3,10) direction S (down).
], title="Bolt", difficulty="hard")

# Key
write("pictograms", 9, "key", 9, 9, [
    [[1,4],[0,4]],  # tooth
    [[3,4],[2,4]],
    [[5,4],[4,4]],
    [[7,3],[7,2]],  # bow top
    [[7,6],[7,7]],  # bow bottom
    [[8,4],[7,4]],  # bow edge
], title="Key", difficulty="hard")

# Crown (3 peaks)
write("pictograms", 10, "crown", 9, 9, [
    [[1,2],[1,1]],
    [[4,1],[4,0]],
    [[7,2],[7,1]],
    [[1,5],[0,5]],
    [[4,5],[4,6]],
    [[7,5],[8,5]],
    [[2,7],[1,7]],
    [[6,7],[7,7]],
], title="Crown", difficulty="hard")


print("\nDone. Run: npm run levels:gen")
