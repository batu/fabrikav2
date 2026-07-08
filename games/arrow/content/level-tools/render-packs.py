#!/usr/bin/env python3
"""Render one overview PNG per pack.

Each PNG shows the pack title, goal + approach text, and 10 small
thumbnails of each level's arrow layout. Uses PIL to draw.

Input : tmp/packs-dump.json (from content/level-tools/dump-levels.mjs)
Output: tmp/packs/NN-<slug>.png
"""

import json
import pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
DUMP = ROOT / "tmp" / "packs-dump.json"
OUT = ROOT / "tmp" / "packs"
OUT.mkdir(parents=True, exist_ok=True)

# Palette matches the game's pastel identity.
BG = (245, 244, 239)
INK = (63, 65, 107)
LAVENDER = (157, 161, 211)
ACCENT_SOFT = (224, 225, 240)
HEART = (236, 119, 152)

PACK_ORDER = [
    "first-steps", "bend-it", "snakes", "crowd", "mirror",
    "convergence", "spirals", "sparse-zen", "pictograms", "masterpieces",
]

PACK_INFO = {
    "first-steps": {
        "title": "First Steps",
        "goal": "Tutorial — introduce each primitive cleanly.",
        "approach": "Rising grid (4×5 → 7×9) and arrow count (2 → 12) following the curve in docs/level-grammar.md. Low bendProb so L1–3 reads as pure straight shots. L4+ introduces cross-direction and chain dependencies.",
    },
    "bend-it": {
        "title": "Bend It",
        "goal": "Make L-shaped arrows the star. Every level has at least one bend that hides the arrow's reach.",
        "approach": "bendProb climbs 0.35 → 0.70 across 10 recipes. Grid stays moderate (5×6 → 8×10). Procedural generator — the high bend probability reliably produces L and S shapes without needing an explicit shape classifier.",
    },
    "snakes": {
        "title": "Snakes",
        "goal": "Few arrows, each long and curvy — trace the body before tapping.",
        "approach": "minLen = 3, maxLen rising 7 → 11, lenDist histogram on L1 to verify the knob works. 3-6 arrows per level on 6×8 → 8×10 grids. Capstone 'Titanboa' is a single length-11 snake on a 4-arrow board.",
    },
    "crowd": {
        "title": "Crowd",
        "goal": "Dense packing — most arrows are locked, find the one free move.",
        "approach": "8-14 short arrows (maxLen 3) on 6×7 → 7×9 grids. blockedT1 bands rise from [3,6] to [11,13]. solverCheck was tried as 'near-unique' but over-constrained the 12+ arrow recipes — relaxed to default after empirical seed-sweep testing (content/level-tools/retry-budget-audit.mjs).",
    },
    "mirror": {
        "title": "Mirror",
        "goal": "Symmetric layouts — the grid reads as two halves of one problem.",
        "approach": "Explicit arrows + transform mode (D3+D4). Author one half; transform: mirror-x | rotate-180 emits the other. 5 mirror-x + 5 rotate-180 across 7×7 → 9×9. mirror-x recipes use vertical-only arrows to avoid the self-collision a horizontal arrow would cause when mirrored across its own body.",
    },
    "convergence": {
        "title": "Convergence",
        "goal": "Arrow rays cross at shared cells — ordering matters more than position.",
        "approach": "Procedural. 5-9 arrows on 6×8 → 8×10 with low-to-mid bendProb so straight rays dominate. No explicit ray-intersection enforcement; the grid-shape + arrow-count combination reliably produces convergence without extra solver work.",
    },
    "spirals": {
        "title": "Spirals",
        "goal": "U and coil shapes — arrows that turn back toward themselves.",
        "approach": "minLen 4 + maxLen 10 + bendProb 0.55-0.70 + seedSweep 500. The high retry budget (D6) lets the generator find coil shapes that shorter sweeps miss. 4-8 arrows on 7×8 → 9×10 grids.",
    },
    "sparse-zen": {
        "title": "Sparse Zen",
        "goal": "Generous whitespace — few long arrows with room to breathe. A palate cleanser after the dense packs.",
        "approach": "Large grids (9×10 → 10×12) with only 4-7 arrows. minLen 3, maxLen 8-10. Low bendProb so arrows glide across multiple empty cells before exiting.",
    },
    "pictograms": {
        "title": "Pictograms",
        "goal": "The layout itself is a drawing — plus, star, heart, key, crown, etc.",
        "approach": "Fully hand-authored via explicit arrows mode (D3). 4-10 short arrows arranged in recognizable shapes. Arrows point outward from shape perimeters so the solver always has a free exit. content/level-tools/scaffold-mirror-pictograms.py is the emitter.",
    },
    "masterpieces": {
        "title": "Masterpieces",
        "goal": "Capstone climaxes — every pack's mechanic at max difficulty.",
        "approach": "12-16 arrows on 9×10 → 10×12 with bendProb 0.40-0.55. seedSweep 800 absorbs the tight constraints. blockedT1 bands match arrowCount ceilings. Each recipe is named after the pack it echoes: 'Bend Finale', 'Snake Finale', etc.",
    },
}

# Thumb dimensions
THUMB_W = 190
THUMB_H = 190
THUMB_GAP_X = 10
THUMB_GAP_Y = 10
THUMB_COLS = 5
THUMB_ROWS = 2

PAGE_W = 1100
HEADER_H = 240  # title + goal + approach (4 lines)
FOOTER_H = 40
PAGE_H = HEADER_H + THUMB_ROWS * (THUMB_H + THUMB_GAP_Y) + FOOTER_H + 20


def load_font(size, weight="normal"):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if weight == "bold" else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for c in candidates:
        if pathlib.Path(c).exists():
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def wrap_text(text, font, max_w):
    """Greedy word-wrap against PIL's measured text width."""
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        trial = (cur + " " + w).strip()
        if font.getbbox(trial)[2] <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_arrow(draw, ox, oy, cell, cells, color):
    """Draw one polyline arrow with a head triangle at the last cell."""
    if len(cells) < 2:
        return
    pts = [(ox + c[0] * cell + cell / 2, oy + c[1] * cell + cell / 2) for c in cells]
    # Body as connected segments
    draw.line(pts, fill=color, width=max(2, int(cell * 0.25)))
    # Head triangle at last point, oriented by the last segment
    hx, hy = pts[-1]
    px, py = pts[-2]
    dx, dy = hx - px, hy - py
    length = (dx * dx + dy * dy) ** 0.5 or 1
    ux, uy = dx / length, dy / length
    # Perpendicular
    perp_x, perp_y = -uy, ux
    tip_len = cell * 0.45
    base_off = cell * 0.28
    tip = (hx + ux * tip_len * 0.3, hy + uy * tip_len * 0.3)
    left = (hx - ux * tip_len * 0.6 + perp_x * base_off, hy - uy * tip_len * 0.6 + perp_y * base_off)
    right = (hx - ux * tip_len * 0.6 - perp_x * base_off, hy - uy * tip_len * 0.6 - perp_y * base_off)
    draw.polygon([tip, left, right], fill=color)


def draw_thumbnail(img, x, y, w, h, level):
    draw = ImageDraw.Draw(img)
    # Soft rounded background
    draw.rounded_rectangle([x, y, x + w, y + h], radius=10, fill=(255, 255, 255))
    # Dotted grid background
    cols, rows = level["cols"], level["rows"]
    pad = 16
    gw, gh = w - pad * 2, h - pad * 2 - 22  # reserve 22px for label
    cell = min(gw / cols, gh / rows)
    grid_w, grid_h = cell * cols, cell * rows
    ox = x + (w - grid_w) / 2
    oy = y + pad + (gh - grid_h) / 2
    # Dots
    dot_r = max(1, cell * 0.08)
    for gy in range(rows):
        for gx in range(cols):
            cx = ox + gx * cell + cell / 2
            cy = oy + gy * cell + cell / 2
            draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=ACCENT_SOFT)
    # Arrows
    for arrow_cells in level["arrows"]:
        draw_arrow(draw, ox, oy, cell, arrow_cells, INK)
    # Label below
    font = load_font(13, "bold")
    label = f"{level['indexInPack']:02d} · {level['title']}"
    tb = font.getbbox(label)
    text_w = tb[2] - tb[0]
    draw.text((x + (w - text_w) / 2, y + h - 20), label, fill=INK, font=font)


def render_pack(pack_idx, pack_slug, levels):
    info = PACK_INFO.get(pack_slug, {"title": pack_slug, "goal": "", "approach": ""})
    img = Image.new("RGB", (PAGE_W, PAGE_H), BG)
    draw = ImageDraw.Draw(img)

    # Header
    title_font = load_font(44, "bold")
    draw.text((40, 30), f"Pack {pack_idx + 1}  ·  {info['title']}", fill=INK, font=title_font)

    # Goal
    goal_font = load_font(20, "bold")
    draw.text((40, 92), "Goal:", fill=LAVENDER, font=goal_font)
    goal_body = load_font(18)
    for i, line in enumerate(wrap_text(info["goal"], goal_body, PAGE_W - 140)):
        draw.text((110, 92 + i * 24), line, fill=INK, font=goal_body)

    # Approach
    ap_font = load_font(17)
    ap_lines = wrap_text(info["approach"], ap_font, PAGE_W - 170)
    start_y = 148
    draw.text((40, start_y), "Approach:", fill=LAVENDER, font=load_font(16, "bold"))
    for i, line in enumerate(ap_lines[:4]):
        draw.text((130, start_y + i * 22), line, fill=INK, font=ap_font)

    # Thumbnails — 2 rows × 5 cols
    grid_x = (PAGE_W - (THUMB_COLS * THUMB_W + (THUMB_COLS - 1) * THUMB_GAP_X)) / 2
    grid_y = HEADER_H
    for i, level in enumerate(levels[:10]):
        col = i % THUMB_COLS
        row = i // THUMB_COLS
        x = grid_x + col * (THUMB_W + THUMB_GAP_X)
        y = grid_y + row * (THUMB_H + THUMB_GAP_Y)
        draw_thumbnail(img, x, y, THUMB_W, THUMB_H, level)

    # Footer
    footer = load_font(13)
    draw.text((40, PAGE_H - 28), f"{len(levels)} levels · pack slug: {pack_slug} · arrow", fill=LAVENDER, font=footer)

    out_path = OUT / f"{pack_idx + 1:02d}-{pack_slug}.png"
    img.save(out_path, "PNG")
    print(f"wrote {out_path.relative_to(ROOT)}")


def main():
    data = json.loads(DUMP.read_text())
    by_pack = {}
    for lv in data["levels"]:
        by_pack.setdefault(lv["pack"], []).append(lv)
    for k in by_pack:
        by_pack[k].sort(key=lambda l: l["indexInPack"])

    for i, slug in enumerate(PACK_ORDER):
        if slug not in by_pack:
            continue
        render_pack(i, slug, by_pack[slug])


if __name__ == "__main__":
    main()
