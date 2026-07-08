#!/usr/bin/env python3
"""scaffold-v2.py — one-shot scaffolder for the v2 100-level curve.

Design goals (learned from v1 review):
  1. Global difficulty rises monotonically. arrowCount climbs from 2
     at level 1 to 20 at level 100. Grid and bendProb follow.
  2. Pack themes tint the FLAVOUR of a level, not the count. So Pack 3
     Snakes takes its slot's arrowCount but swaps it for longer paths.
  3. Pictograms (Pack 9) are hand-authored via ASCII so they actually
     read as their glyph — Face, House, etc. using ascii-to-arrows.
  4. Mirror (Pack 5) uses explicit + transform with vertical-only or
     top-left-only authored arrows to avoid the self-collision bug.
  5. Masterpieces (Pack 10) each echo a specific earlier pack's
     mechanic, not just "more arrows".

Levels are emitted into levels/<pack>/NN-<slug>.yaml. Old yamls are
wiped (caller does that before invoking this script).

Picture the global level index L ∈ [1,100]:
  arrowCount(L)  = round(2 + (L-1) * 0.18)
  gridCols(L)    = round(4 + (L-1) * 0.07)
  gridRows(L)    = gridCols(L) + 1
  bendProb(L)    = min(0.6, (L-1) * 0.006)
The pack modifier shifts these around the base curve.
"""

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEVELS = ROOT / "levels"
LEVELS.mkdir(exist_ok=True)

# ---- Global difficulty curve --------------------------------------------

def base(L):
    """Base numbers for global level index L (1..100)."""
    return {
        "arrowCount": round(2 + (L - 1) * 0.18),
        "cols": round(4 + (L - 1) * 0.07),
        "rows": round(4 + (L - 1) * 0.07) + 1,
        "bendProb": round(min(0.6, (L - 1) * 0.006), 2),
    }


# ---- Pack specs ---------------------------------------------------------
# Each pack: authored levels with L local to the pack. `global_offset`
# places this pack's L=1 at the given global L.
#
# Per-pack override keys tune away from the base curve when the pack
# theme demands it. The arrowCount generally follows the base curve
# (monotonic across 100), but pack 8 Sparse trades count for grid,
# pack 3 Snakes trades count for length, etc.

PACKS = [
    {
        "slug": "first-steps",
        "name": "First Steps",
        "global_offset": 1,
        "difficulty_curve": ["easy"] * 4 + ["medium"] * 4 + ["hard"] * 2,
        "titles": ["Intro", "Pair", "Chain", "Cross", "Ladder",
                   "Tangle", "Dense", "Forced", "Webbed", "Trial"],
        "tune": lambda b, i: b,  # plain base curve
    },
    {
        "slug": "bend-it",
        "name": "Bend It",
        "global_offset": 11,
        "difficulty_curve": ["easy"] * 2 + ["medium"] * 5 + ["hard"] * 3,
        "titles": ["First Bend", "Right Angle", "Hook", "Twist",
                   "L-Cluster", "S-Curve", "Zig", "Zag", "Coil Start", "Bent Finale"],
        "tune": lambda b, i: {**b, "bendProb": round(min(0.7, b["bendProb"] + 0.2), 2)},
    },
    {
        "slug": "snakes",
        "name": "Snakes",
        "global_offset": 21,
        "difficulty_curve": ["medium"] * 6 + ["hard"] * 4,
        "titles": ["Slither", "Ribbon", "Serpent", "Thread",
                   "Python", "Constrictor", "Anaconda", "Hydra", "Leviathan", "Titanboa"],
        # Trade arrow count for length: -2 arrows, +4 maxLen
        "tune": lambda b, i: {
            **b,
            "arrowCount": max(3, b["arrowCount"] - 2),
            "minLen": 3,
            "maxLen": min(b["cols"] + 2, 6 + i // 2),
            "bendProb": round(min(0.55, b["bendProb"] + 0.1), 2),
        },
    },
    {
        "slug": "crowd",
        "name": "Crowd",
        "global_offset": 31,
        "difficulty_curve": ["medium"] * 3 + ["hard"] * 7,
        "titles": ["Cluster", "Thicket", "Brambles", "Pack",
                   "Swarm", "Jam", "Gridlock", "Logjam", "Deadlock", "Bottleneck"],
        # Dense short arrows: +3 arrows, maxLen cap 3
        "tune": lambda b, i: {
            **b,
            "arrowCount": b["arrowCount"] + 3,
            "maxLen": 3,
            "bendProb": round(min(0.35, b["bendProb"]), 2),
        },
    },
    # Pack 5 Mirror: explicit + transform — skipped by procedural ramp()
    {
        "slug": "mirror",
        "name": "Mirror",
        "global_offset": 41,
        "difficulty_curve": ["medium"] * 3 + ["hard"] * 7,
        "titles": ["Reflection", "Paired", "Bilateral", "Butterfly",
                   "Pairwise", "Spin", "Pinwheel", "Windmill", "Carousel", "Mirror Finale"],
        "explicit": True,  # authored separately
    },
    {
        "slug": "convergence",
        "name": "Convergence",
        "global_offset": 51,
        "difficulty_curve": ["medium"] * 3 + ["hard"] * 7,
        "titles": ["Meet Point", "Junction", "Cross Roads", "Fork",
                   "Star", "Compass", "Hub", "Nexus", "Confluence", "Vortex"],
        "tune": lambda b, i: {
            **b,
            # Lower bendProb so rays stay straight enough to cross.
            "bendProb": round(max(0.15, b["bendProb"] - 0.2), 2),
        },
    },
    {
        "slug": "spirals",
        "name": "Spirals",
        "global_offset": 61,
        "difficulty_curve": ["medium"] * 2 + ["hard"] * 8,
        "titles": ["Curl", "Whorl", "Hook", "Spiral",
                   "Coil", "Helix", "Nautilus", "Gyre", "Maelstrom", "Vortex Prime"],
        "tune": lambda b, i: {
            **b,
            "arrowCount": max(4, b["arrowCount"] - 2),
            "minLen": 4,
            "maxLen": min(b["cols"] + 1, 7 + i // 3),
            "bendProb": round(min(0.55, b["bendProb"] + 0.15), 2),
            "seedSweep": 1500,
        },
    },
    {
        "slug": "sparse-zen",
        "name": "Sparse Zen",
        "global_offset": 71,
        "difficulty_curve": ["medium"] * 4 + ["hard"] * 6,
        "titles": ["Breath", "Open Air", "Wide Room", "Quiet",
                   "Still Pond", "Garden", "Hall", "Cathedral", "Chorus", "Zen Finale"],
        # Big grid, few arrows, long paths.
        "tune": lambda b, i: {
            **b,
            "cols": b["cols"] + 2,
            "rows": b["rows"] + 2,
            "arrowCount": max(4, b["arrowCount"] - 4),
            "minLen": 3,
            "maxLen": 8 + i // 3,
            "bendProb": round(max(0.2, b["bendProb"] - 0.2), 2),
            "seedSweep": 1000,
        },
    },
    # Pack 9 Pictograms: explicit hand-authored
    {
        "slug": "pictograms",
        "name": "Pictograms",
        "global_offset": 81,
        "difficulty_curve": ["easy"] * 2 + ["medium"] * 4 + ["hard"] * 4,
        "titles": ["Plus", "Cross", "Diamond", "Face",
                   "Flower", "Sun", "House", "Tree", "Bird", "Crown"],
        "explicit": True,
    },
    {
        "slug": "masterpieces",
        "name": "Masterpieces",
        "global_offset": 91,
        "difficulty_curve": ["hard"] * 10,
        "titles": ["Bend Finale", "Snake Finale", "Crowd Finale", "Cross Finale",
                   "Convergence Finale", "Spiral Finale", "Sparse Finale",
                   "Forged", "Tempered", "Masterpiece"],
        "tune": lambda b, i: {
            **b,
            "arrowCount": b["arrowCount"] + 2,
            "maxLen": 4 + i // 3,
            "seedSweep": 800,
        },
    },
]

# Seed pool: unique globally, deterministic from pack + index.
# Pack N level M → seed = 10000 + N*100 + M, skipping collisions.
def pack_seed(pack_idx, level_idx):
    return 10000 + pack_idx * 100 + level_idx


# ---- Procedural emit ----------------------------------------------------

def emit_procedural(pack, L_global, i):
    b = base(L_global)
    tuned = pack["tune"](b, i)
    parts = [
        f"cols: {tuned['cols']}",
        f"rows: {tuned['rows']}",
        f"arrowCount: {tuned['arrowCount']}",
        "opts:",
        f"  minLen: {tuned.get('minLen', 2)}",
        f"  maxLen: {tuned.get('maxLen', min(tuned['cols'] - 1, 3 + L_global // 25))}",
        f"  bendProb: {tuned['bendProb']}",
        f"seed: {pack_seed(PACKS.index(pack), i + 1)}",
    ]
    if "seedSweep" in tuned:
        parts.append(f"seedSweep: {tuned['seedSweep']}")
    parts.append("meta:")
    parts.append(f"  pack: {pack['slug']}")
    parts.append(f"  indexInPack: {i + 1}")
    parts.append(f"  title: {pack['titles'][i]}")
    parts.append(f"  difficulty: {pack['difficulty_curve'][i]}")
    return "\n".join(parts) + "\n"


# ---- Mirror pack (explicit + transform) ---------------------------------

MIRROR_LEVELS = [
    # (cols, rows, authored_arrows, transform, title, difficulty)
    # Arrows are in the LEFT half for mirror-x (all x <= cols//2 - 1),
    # or in the TOP-LEFT quadrant for rotate-180 (x <= cols//2 - 1,
    # y <= rows//2 - 1). Vertical-only for mirror-x to avoid self-collide.
    (7, 7, [[[1, 3], [1, 2]], [[2, 5], [2, 6]]], "mirror-x", "easy"),
    (7, 7, [[[0, 3], [0, 2]], [[1, 4], [1, 5]]], "mirror-x", "easy"),
    (7, 8, [[[0, 1], [0, 0]], [[1, 4], [1, 3]], [[2, 7], [2, 6]]], "mirror-x", "medium"),
    (7, 8, [[[0, 2], [0, 1], [0, 0]], [[1, 5], [1, 4], [1, 3]]], "mirror-x", "medium"),
    (7, 9, [[[0, 1], [0, 0]], [[1, 3], [1, 2]], [[2, 5], [2, 4]], [[0, 8], [0, 7]]], "mirror-x", "medium"),
    (7, 7, [[[0, 0], [0, 1]], [[1, 2], [2, 2]]], "rotate-180", "medium"),
    (8, 8, [[[0, 0], [1, 0]], [[0, 2], [0, 3]]], "rotate-180", "medium"),
    (8, 8, [[[0, 0], [1, 0], [2, 0]], [[0, 2], [0, 3]], [[3, 0], [3, 1]]], "rotate-180", "hard"),
    (9, 9, [[[0, 0], [1, 0]], [[0, 2], [0, 3]], [[2, 1], [3, 1]]], "rotate-180", "hard"),
    (9, 9, [[[0, 0], [0, 1]], [[1, 2], [2, 2]], [[0, 3], [0, 4]], [[3, 0], [3, 1]]], "rotate-180", "hard"),
]


def emit_mirror(i):
    cols, rows, arrows, transform, difficulty = MIRROR_LEVELS[i]
    return (
        f"cols: {cols}\n"
        f"rows: {rows}\n"
        f"arrows: {json.dumps(arrows).replace(' ', '')}\n"
        f"transform: {transform}\n"
        f"meta:\n"
        f"  pack: mirror\n"
        f"  indexInPack: {i + 1}\n"
        f"  title: {PACKS[4]['titles'][i]}\n"
        f"  difficulty: {difficulty}\n"
    )


# ---- Pictograms pack (explicit hand-authored via ascii-to-arrows) -------
# Each pictogram is an ASCII grid fed through content/level-tools/ascii-to-arrows.mjs.
# Arrows point outward toward nearest edges so every level is solvable.

PICTOGRAM_ASCII = {
    # 01 Plus — 4 arrows out from a + center. 7x7.
    "plus": (
        7, 7, "easy",
        """
        . . . A . . .
        . . . a . . .
        . . . . . . .
        B b . . . c C
        . . . . . . .
        . . . d . . .
        . . . D . . .
        """,
    ),
    # 02 Cross — 4 corner arrows pointing outward diagonally (via cardinal).
    "cross": (
        7, 7, "easy",
        """
        A . . . . . B
        a . . . . . b
        . . . . . . .
        . . . . . . .
        . . . . . . .
        c . . . . . d
        C . . . . . D
        """,
    ),
    # 03 Diamond — 4 arrows at diamond corners, pointing outward.
    "diamond": (
        7, 7, "medium",
        """
        . . . A . . .
        . . . a . . .
        . B . . . . C
        . b . . . . c
        . . . . . . .
        . . . d . . .
        . . . D . . .
        """,
    ),
    # 04 Face — eyes + nose + mouth corners (5 arrows).
    "face": (
        11, 11, "medium",
        """
        . . . . . . . . . . .
        . . . . . . . . . . .
        . . A . . . . . C . .
        . . a . . . . . c . .
        . . . . . . . . . . .
        . . . . . E . . . . .
        . . . . . e . . . . .
        . . . . . . . . . . .
        . B b . . . . . d D .
        . . . . . . . . . . .
        . . . . . . . . . . .
        """,
    ),
    # 05 Flower — petals around a center (6 outward arrows).
    "flower": (
        9, 9, "medium",
        """
        . . . A . . . . .
        . . . a . . . . .
        . . . . . . . . .
        B b . . . . . c C
        . . . . . . . . .
        D d . . . . . e E
        . . . . . . . . .
        . . . f . . . . .
        . . . F . . . . .
        """,
    ),
    # 06 Sun — 8 rays in all directions.
    "sun": (
        9, 9, "medium",
        """
        . . . . A . . . .
        . . . . a . . . .
        . . . . . . . . .
        . . . . . . . . .
        B b . . . . . c C
        . . . . . . . . .
        . . . . . . . . .
        . . . . d . . . .
        . . . . D . . . .
        """,
    ),
    # 07 House — peak + roof corners + walls + door (6 arrows).
    "house": (
        11, 11, "hard",
        """
        . . . . . A . . . . .
        . . . . . a . . . . .
        . . B b . . . c C . .
        . . . . . . . . . . .
        . . . . . . . . . . .
        . d . . . . . . . f .
        . D . . . . . . . F .
        . . . . . . . . . . .
        . . . . . g . . . . .
        . . . . . G . . . . .
        . . . . . . . . . . .
        """,
    ),
    # 08 Tree — trunk + canopy (7 arrows).
    "tree": (
        9, 11, "hard",
        """
        . . . . A . . . .
        . . . . a . . . .
        . . B b . c C . .
        . . . . . . . . .
        . D . . . . . f F
        . d . . . . . f .
        . . . . . . . . .
        . . . . E . . . .
        . . . . e . . . .
        . . . . . . . . .
        . . . . . . . . .
        """,
    ),
    # 09 Bird — beak, outstretched wings, belly, two feet (6 arrows).
    "bird": (
        9, 9, "hard",
        """
        . . . . . . . . .
        . A a . . . . . .
        . . . . . . . . .
        B . . . . . . . C
        b . . . . . . . c
        . . . . . . . . .
        . . . D d . . . .
        . . . e . f . . .
        . . . E . F . . .
        """,
    ),
    # 10 Crown — three peaks + base (9 arrows).
    "crown": (
        11, 9, "hard",
        """
        . A . . D . . G . . .
        . a . . d . . g . . .
        . . . . . . . . . . .
        . . . . . . . . . . .
        . . . . . . . . . . .
        . . . . . . . . . . .
        B b . . . . . . . i I
        . . . . . . . . . . .
        C c . . . . . . . j J
        """,
    ),
}


def emit_pictogram(i, slug):
    cols, rows, difficulty, ascii_art = PICTOGRAM_ASCII[slug]
    # Write ascii file + run ascii-to-arrows CLI.
    drafts = ROOT / "levels" / "drafts"
    drafts.mkdir(exist_ok=True)
    draft_path = drafts / f"{slug}.txt"
    draft_path.write_text(ascii_art)

    out_path = LEVELS / "pictograms" / f"{i + 1:02d}-{slug}.yaml"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    title = PACKS[8]["titles"][i]
    cmd = [
        "node", "content/level-tools/ascii-to-arrows.mjs",
        "--file", str(draft_path),
        "--pack", "pictograms",
        "--indexInPack", str(i + 1),
        "--title", title,
        "--difficulty", difficulty,
        "--out", str(out_path),
    ]
    subprocess.run(cmd, check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
    return out_path.relative_to(ROOT)


# ---- Main ---------------------------------------------------------------

def main():
    for pack in PACKS:
        for i in range(10):
            L = pack["global_offset"] + i
            slug = pack["titles"][i].lower().replace(" ", "-")
            if pack.get("explicit") and pack["slug"] == "mirror":
                body = emit_mirror(i)
                path = LEVELS / "mirror" / f"{i + 1:02d}-{slug}.yaml"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(body)
                print(f"wrote {path.relative_to(ROOT)}")
            elif pack.get("explicit") and pack["slug"] == "pictograms":
                # slug here is the title-derived slug. The dict keys are the
                # lowercase titles below.
                rel = emit_pictogram(i, slug)
                print(f"wrote {rel}")
            else:
                body = emit_procedural(pack, L, i)
                path = LEVELS / pack["slug"] / f"{i + 1:02d}-{slug}.yaml"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(body)
                print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
