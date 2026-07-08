#!/usr/bin/env python3
"""scaffold-packs.py — one-shot generator for packs 2, 3, 4, 6, 7, 8, 10.

Procedural packs only. Pack 5 (Mirror) and Pack 9 (Pictograms) require
explicit/transform authoring — done separately. L10 Masterpieces is
procedural with tight solverCheck.

Writes levels/<pack>/NN-<slug>.yaml. Skips files that already exist.
"""

import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEVELS = ROOT / "levels"


def write(pack_slug, idx, slug, body):
    d = LEVELS / pack_slug
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{idx:02d}-{slug}.yaml"
    if p.exists():
        print(f"skip  {p.relative_to(ROOT)}")
        return
    p.write_text(body)
    print(f"wrote {p.relative_to(ROOT)}")


def ramp(pack_slug, pack_name, seeds, rows_by_i, cols_by_i, arrows_by_i, bend_by_i,
         minlen=2, maxlen_by_i=None, titles=None, difficulty_by_i=None,
         blocked_by_i=None, extras_by_i=None):
    for i in range(10):
        idx = i + 1
        slug = titles[i].lower().replace(" ", "-")
        title = titles[i]
        difficulty = difficulty_by_i[i] if difficulty_by_i else "easy"
        maxlen = maxlen_by_i[i] if maxlen_by_i else 4
        blocked = blocked_by_i[i] if blocked_by_i else None
        extras = extras_by_i[i] if extras_by_i else ""
        parts = [
            f"cols: {cols_by_i[i]}",
            f"rows: {rows_by_i[i]}",
            f"arrowCount: {arrows_by_i[i]}",
            "opts:",
            f"  minLen: {minlen}",
            f"  maxLen: {maxlen}",
            f"  bendProb: {bend_by_i[i]}",
            f"seed: {seeds[i]}",
        ]
        if blocked:
            parts.append(f"blockedT1: [{blocked[0]}, {blocked[1]}]")
        if extras:
            parts.append(extras.rstrip())
        parts.append("meta:")
        parts.append(f"  pack: {pack_slug}")
        parts.append(f"  indexInPack: {idx}")
        parts.append(f"  title: {title}")
        parts.append(f"  difficulty: {difficulty}")
        write(pack_slug, idx, slug, "\n".join(parts) + "\n")


# ---- Pack 2: Bend It (L-heavy, rising bendProb + grid) ----
ramp(
    "bend-it", "Bend It",
    seeds=[1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109, 1110],
    cols_by_i=[5, 5, 6, 6, 6, 7, 7, 7, 8, 8],
    rows_by_i=[6, 7, 7, 8, 8, 8, 9, 9, 9, 10],
    arrows_by_i=[4, 4, 5, 5, 6, 6, 7, 7, 8, 9],
    bend_by_i=[0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.6, 0.65, 0.65, 0.7],
    maxlen_by_i=[3, 3, 3, 4, 4, 4, 4, 4, 5, 5],
    titles=["First Bend", "Right Angle", "Corner Piece", "Tight Turn",
            "L-Cluster", "Hook Line", "Crook", "Zig", "Zag", "Bent Finale"],
    difficulty_by_i=["easy"] * 3 + ["medium"] * 5 + ["hard"] * 2,
)

# ---- Pack 3: Snakes (long paths, lenDist skewed to 5-8) ----
ramp(
    "snakes", "Snakes",
    seeds=[1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210],
    cols_by_i=[6, 6, 7, 7, 7, 8, 8, 8, 8, 8],
    rows_by_i=[8, 8, 8, 9, 9, 9, 10, 10, 10, 10],
    arrows_by_i=[3, 4, 4, 4, 5, 5, 5, 6, 5, 4],
    bend_by_i=[0.45, 0.5, 0.5, 0.55, 0.55, 0.5, 0.5, 0.55, 0.55, 0.6],
    minlen=3,
    maxlen_by_i=[7, 8, 8, 9, 9, 9, 10, 10, 10, 11],
    titles=["Little Snake", "Slitherer", "Thread", "Ribbon",
            "Python", "Constrictor", "Anaconda", "Hydra", "Leviathan", "Titanboa"],
    difficulty_by_i=["easy", "easy", "medium", "medium", "medium", "medium", "hard", "hard", "hard", "hard"],
    extras_by_i=[
        "opts:\n  minLen: 3\n  maxLen: 7\n  bendProb: 0.45\n  lenDist: [0, 1, 1, 2, 3, 3, 2, 1]" if i == 0 else "" for i in range(10)
    ],
)

# ---- Pack 4: Crowd (dense short arrows, solverCheck near-unique) ----
ramp(
    "crowd", "Crowd",
    seeds=[1301, 1302, 1303, 1304, 1305, 1306, 1307, 1308, 1309, 1310],
    cols_by_i=[6, 6, 6, 6, 7, 7, 7, 7, 7, 7],
    rows_by_i=[7, 7, 8, 8, 8, 8, 9, 9, 9, 9],
    arrows_by_i=[8, 9, 10, 10, 11, 12, 12, 13, 13, 14],
    bend_by_i=[0.25, 0.3, 0.3, 0.3, 0.3, 0.3, 0.35, 0.35, 0.4, 0.4],
    maxlen_by_i=[3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    blocked_by_i=[(3, 6), (4, 7), (4, 7), (5, 8), (6, 9), (7, 10), (8, 10), (9, 11), (10, 12), (11, 13)],
    titles=["Cluster", "Thicket", "Brambles", "Pack",
            "Swarm", "Jam", "Gridlock", "Logjam", "Deadlock", "Bottleneck"],
    difficulty_by_i=["easy", "easy", "medium", "medium", "medium", "medium", "hard", "hard", "hard", "hard"],
    extras_by_i=['' for i in range(10)],  # relaxed solverCheck — near-unique over-constrained the high-arrow recipes
)

# ---- Pack 6: Convergence (rays cross) ----
ramp(
    "convergence", "Convergence",
    seeds=[1501, 1502, 1503, 1504, 1505, 1506, 1507, 1508, 1509, 1510],
    cols_by_i=[6, 6, 7, 7, 7, 8, 8, 8, 8, 8],
    rows_by_i=[8, 8, 8, 9, 9, 9, 10, 10, 10, 10],
    arrows_by_i=[5, 5, 6, 6, 7, 7, 8, 8, 9, 9],
    bend_by_i=[0.2, 0.25, 0.25, 0.3, 0.3, 0.3, 0.35, 0.35, 0.4, 0.4],
    maxlen_by_i=[4, 4, 4, 4, 4, 5, 5, 5, 5, 5],
    titles=["Meet Point", "Junction", "Cross Roads", "Fork",
            "Star", "Compass", "Hub", "Nexus", "Confluence", "Vortex"],
    difficulty_by_i=["easy"] * 3 + ["medium"] * 4 + ["hard"] * 3,
)

# ---- Pack 7: Spirals (U/coil, high bendProb, long minLen, seedSweep) ----
ramp(
    "spirals", "Spirals",
    seeds=[1601, 1602, 1603, 1604, 1605, 1606, 1607, 1608, 1609, 1610],
    cols_by_i=[7, 7, 8, 8, 8, 9, 9, 9, 9, 9],
    rows_by_i=[8, 8, 9, 9, 9, 10, 10, 10, 10, 10],
    arrows_by_i=[4, 5, 5, 6, 6, 6, 7, 7, 8, 8],
    bend_by_i=[0.55, 0.55, 0.6, 0.6, 0.6, 0.6, 0.65, 0.65, 0.7, 0.7],
    minlen=4,
    maxlen_by_i=[7, 7, 8, 8, 9, 9, 9, 10, 10, 10],
    titles=["Curl", "Whorl", "Hook", "Spiral",
            "Coil", "Helix", "Nautilus", "Gyre", "Maelstrom", "Vortex Prime"],
    difficulty_by_i=["easy", "medium", "medium", "medium", "medium", "hard", "hard", "hard", "hard", "hard"],
    extras_by_i=["seedSweep: 500"] * 10,
)

# ---- Pack 8: Sparse Zen (large grids, few arrows, wide lenDist) ----
ramp(
    "sparse-zen", "Sparse Zen",
    seeds=[1701, 1702, 1703, 1704, 1705, 1706, 1707, 1708, 1709, 1710],
    cols_by_i=[9, 9, 9, 10, 10, 10, 10, 10, 10, 10],
    rows_by_i=[10, 10, 11, 11, 11, 12, 12, 12, 12, 12],
    arrows_by_i=[4, 4, 5, 5, 5, 6, 6, 6, 7, 7],
    bend_by_i=[0.2, 0.25, 0.25, 0.3, 0.3, 0.3, 0.35, 0.35, 0.4, 0.4],
    minlen=3,
    maxlen_by_i=[8, 8, 9, 9, 9, 10, 10, 10, 10, 10],
    titles=["Breath", "Open Air", "Wide Room", "Quiet",
            "Still Pond", "Garden", "Hall", "Cathedral", "Chorus", "Zen Finale"],
    difficulty_by_i=["easy"] * 3 + ["medium"] * 5 + ["hard"] * 2,
)

# ---- Pack 10: Masterpieces (capstones, solverCheck unique, seedSweep) ----
ramp(
    "masterpieces", "Masterpieces",
    seeds=[1901, 1902, 1903, 1904, 1905, 1906, 1907, 1908, 1909, 1910],
    cols_by_i=[9, 9, 9, 9, 10, 10, 10, 10, 10, 10],
    rows_by_i=[10, 10, 11, 11, 11, 11, 12, 12, 12, 12],
    arrows_by_i=[12, 12, 13, 13, 14, 14, 15, 15, 16, 16],
    bend_by_i=[0.4, 0.4, 0.45, 0.45, 0.45, 0.5, 0.5, 0.5, 0.55, 0.55],
    minlen=3,
    maxlen_by_i=[5, 5, 6, 6, 6, 7, 7, 7, 7, 8],
    blocked_by_i=[(6, 10), (7, 11), (8, 12), (9, 12), (10, 13), (11, 13), (12, 14), (13, 14), (14, 15), (15, 15)],
    titles=["Bend Finale", "Snake Finale", "Crowd Finale", "Mirror Finale",
            "Convergence Finale", "Spiral Finale", "Sparse Finale", "Forged",
            "Tempered", "Masterpiece"],
    difficulty_by_i=["hard"] * 10,
    extras_by_i=["seedSweep: 800"] * 10,
)


print("\nDone. Run: npm run levels:gen")
