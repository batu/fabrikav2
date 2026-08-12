"""Stress-simulate the CL-5..CL-9 geometry model over the real corpus.

Rules simulated exactly as specified:
  restoreRegion(bird) = bbox(diff components Voronoi-assigned to it) ∪ spriteBox, +margin
  dissolve(A) = restore(A) ∩ A's half-space vs each remaining contested B
                − union(remaining B's sprite boxes)
Invariants:
  I1 end-clean: after all pickups, no painted pixel survives
  I2 sprite-safety: dissolving A never erases a remaining B's sprite-box pixels (by rule)
  I3 prop-safety: pixels assigned to remaining B erased before B is picked (violations
     quantified — the bisector is a proxy, so this measures its real-world error)
  I4 orphan paint: pixels of a PICKED bird left standing mid-game (spared for neighbors)
  I5 containment: derived restore region contains its bird's hitbox center
"""
import json, random, sys
import numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
import levelbuilder.api.session as S

SCALE = 4          # simulate at 1/4 resolution: mask fidelity fine, 16x faster
THRESH = 60
MARGIN = 6         # scaled px
rng = random.Random(7)

report = []
levels = 0
for d in sorted(S.LEVELS_DIR.iterdir()):
    if not d.is_dir(): continue
    r = S.read_canonical_session(d.name)
    if r.snapshot is None or r.state.value != "valid_current": continue
    snap = r.snapshot
    try:
        scene = np.asarray(Image.open(d / snap["assets"]["scene"]["path"]).convert("RGB").reduce(SCALE), dtype=np.int16)
        clean = np.asarray(Image.open(d / snap["assets"]["cleanBackground"]["path"]).convert("RGB").reduce(SCALE), dtype=np.int16)
    except Exception as e:
        continue
    if scene.shape != clean.shape: continue
    levels += 1
    H, W = scene.shape[:2]
    diff = (np.abs(scene - clean).sum(axis=2) > THRESH)
    birds = snap["birds"]
    centers = np.array([[b["hitbox"]["y"]/SCALE, b["hitbox"]["x"]/SCALE] for b in birds])
    sprites = []
    for b in birds:
        p = b["sprite"]["placement"]
        sprites.append((max(0,p["y"]//SCALE), max(0,p["x"]//SCALE),
                        min(H,(p["y"]+p["height"])//SCALE+1), min(W,(p["x"]+p["width"])//SCALE+1)))
    # --- component assignment (Voronoi by nearest hitbox center to component centroid)
    lab, n = ndimage.label(diff)
    objs = ndimage.find_objects(lab)
    owner = np.full(n+1, -1, dtype=np.int32)
    unassigned_px = 0
    coms = ndimage.center_of_mass(diff, lab, range(1, n+1)) if n else []
    sizes = ndimage.sum_labels(diff, lab, range(1, n+1)) if n else []
    for ci in range(1, n+1):
        cy, cx = coms[ci-1]
        dist = np.hypot(centers[:,0]-cy, centers[:,1]-cx)
        near = int(dist.argmin())
        if dist[near] > 400/SCALE and sizes[ci-1] > 50:   # far from every bird
            unassigned_px += int(sizes[ci-1]); continue
        owner[ci] = near
    # --- derived restore regions
    regions = []
    for bi, b in enumerate(birds):
        ys, xs, ye, xe = sprites[bi]
        for ci in range(1, n+1):
            if owner[ci] != bi: continue
            sl = objs[ci-1]
            ys, xs = min(ys, sl[0].start), min(xs, sl[1].start)
            ye, xe = max(ye, sl[0].stop), max(xe, sl[1].stop)
        regions.append((max(0,ys-MARGIN), max(0,xs-MARGIN), min(H,ye+MARGIN), min(W,xe+MARGIN)))
    # I5 containment
    i5 = sum(1 for bi,(ys,xs,ye,xe) in enumerate(regions)
             if not (ys <= centers[bi][0] <= ye and xs <= centers[bi][1] <= xe))
    # ownership mask for prop-safety accounting
    own_mask = np.zeros((H, W), dtype=np.int32) - 1
    for ci in range(1, n+1):
        if owner[ci] >= 0: own_mask[lab == ci] = owner[ci]
    yy, xx = np.mgrid[0:H, 0:W]
    worst = {"i3": 0, "i4": 0, "end": 0}
    for trial in range(3):
        order = list(range(len(birds)))
        if trial == 0: rng.shuffle(order)
        elif trial == 1: order.sort(key=lambda bi: centers[bi][0])       # top-down sweep
        else:  # adversarial: nearest-pair first
            order.sort(key=lambda bi: min(np.hypot(*(centers[bi]-centers[bj])) for bj in range(len(birds)) if bj != bi))
        painted = diff.copy()
        found = set()
        i3_px = 0; i4_max = 0
        def dissolve_mask(f, remaining):
            ys, xs, ye, xe = regions[f]
            m = np.zeros((H, W), dtype=bool); m[ys:ye, xs:xe] = True
            if remaining:
                # ownership-exact protection: never erase pixels ASSIGNED to a
                # still-hidden bird (replaces the Voronoi half-space proxy)
                m &= ~np.isin(own_mask, remaining)
            for b2 in remaining:
                sys_, sxs, sye, sxe = sprites[b2]
                m[sys_:sye, sxs:sxe] = False
            return m
        for a in order:
            found.add(a)
            remaining = [b2 for b2 in range(len(birds)) if b2 not in found]
            # progressive re-dissolve: protections only shrink, so re-apply
            # EVERY found bird's dissolve under the current protections
            reveal = np.zeros((H, W), dtype=bool)
            for f in found:
                reveal |= dissolve_mask(f, remaining)
            erased = painted & reveal
            i3_px += int((erased & (own_mask >= 0) & np.isin(own_mask, remaining)).sum()) if remaining else 0
            painted &= ~reveal
            # I4: paint owned by found birds still standing
            found_arr = np.array(sorted(found))
            i4 = int((painted & np.isin(own_mask, found_arr)).sum())
            i4_max = max(i4_max, i4)
        worst["i3"] = max(worst["i3"], i3_px)
        worst["i4"] = max(worst["i4"], i4_max)
        worst["end"] = max(worst["end"], int(painted.sum()))
    report.append({
        "level": d.name, "birds": len(birds), "i5_violations": i5,
        "unassigned_paint_px": unassigned_px * SCALE * SCALE,
        "worst_prop_erased_px": worst["i3"] * SCALE * SCALE,
        "worst_orphan_paint_px": worst["i4"] * SCALE * SCALE,
        "end_residue_px": worst["end"] * SCALE * SCALE,
    })

report.sort(key=lambda x: -(x["worst_prop_erased_px"] + x["end_residue_px"]))
print(f"levels simulated: {levels}")
tot = lambda k: sum(x[k] for x in report)
print(f"I5 containment violations: {tot('i5_violations')}")
print(f"unassigned paint total: {tot('unassigned_paint_px'):,} px")
print(f"I3 premature prop erasure (worst-order, total): {tot('worst_prop_erased_px'):,} px")
print(f"I4 orphan paint (worst per level, total): {tot('worst_orphan_paint_px'):,} px")
print(f"I1 end residue: {tot('end_residue_px'):,} px")
print("\nworst 8 levels:")
for x in report[:8]:
    print(f"  {x['level'][:44]:44} prop-erase={x['worst_prop_erased_px']:>8,} orphan={x['worst_orphan_paint_px']:>8,} end={x['end_residue_px']:>6,} unassigned={x['unassigned_paint_px']:>8,}")
json.dump(report, open(sys.argv[1], "w"), indent=1)
