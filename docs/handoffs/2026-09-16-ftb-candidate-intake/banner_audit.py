import json, sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
G=Path("/Users/base/dev/appletolye/fabrikav2/games/find_the_bird")
S=Path("/private/tmp/claude-501/-Users-base-dev-appletolye/331ae57c-2b61-46dc-a16c-fd36d2330b22/scratchpad/intake")
BANNER_FRACTION=0.071
BAND_TOP_FRAC=0.894  # measured iPhone 12 banner top (PIPELINE 2026-09-13); SE has no inset so band runs to the level bottom

def sprite_alpha_bottom(base, lid, sp):
    """True bottom edge (level y) of the sprite's non-transparent pixels."""
    rel=sp["image"]
    for cand in [base/lid/rel.split(f"{lid}/",1)[-1], base/rel.replace("levels/","",1)]:
        if cand.exists():
            a=np.asarray(Image.open(cand).convert("RGBA"))[...,3]
            ys=np.where(a.max(axis=1) > 8)[0]
            if not len(ys): return None
            # sprite box height may differ from png height -> scale
            sy = sp["height"]/a.shape[0]
            return sp["y"] + (ys.max()+1)*sy
    return None

def audit_level(base, lid):
    lj=base/lid/"level.json"
    if not lj.exists(): return None
    d=json.load(open(lj)); H=d["height"]; band=int(H*BAND_TOP_FRAC)
    out=[]
    for e in d.get("dogs",[]):
        sp=e.get("sprite") or {}
        if not sp.get("image"): continue
        bot=sprite_alpha_bottom(base, lid, sp)
        if bot is None: continue
        cl=sp.get("cleanup") or {}
        out.append({"dog":e["id"],"alpha_bottom":float(bot),"band":band,"H":H,
                    "over_px": float(bot-band),
                    "box_bottom": sp["y"]+sp["height"],
                    "cleanup_bottom": (cl["y"]+cl["height"]) if cl else None})
    return {"id":lid,"H":H,"band":band,"n":len(d.get("dogs",[])),"dogs":out}

if __name__=="__main__":
    which=sys.argv[1]
    if which=="shipped":
        base=G/"public/levels"
        ids=[l["id"] for l in json.load(open(G/"public/levels/bundled-manifest.json"))["levels"]]
    else:
        base=G/".levelbuilder/levels"
        rows=json.load(open(S/"inventory2.json"))
        ids=[r["id"] for r in rows if r["verdict"]=="candidate" and r["sub"]=="full sprites"]
    with ThreadPoolExecutor(8) as ex:
        res=[r for r in ex.map(lambda i: audit_level(base,i), ids) if r]
    json.dump(res, open(S/f"banner_{which}.json","w"), indent=1)
    for r in res:
        over=[d for d in r["dogs"] if d["over_px"]>0]
        near=[d for d in r["dogs"] if 0>=d["over_px"]>-60]
        if over or near:
            print(f"{r['id'][:52]:54} H={r['H']} band={r['band']} OVER={len(over)} near={len(near)} " +
                  " ".join(f"{d['dog']}:+{d['over_px']:.0f}" for d in over))
    tot=sum(len([d for d in r['dogs'] if d['over_px']>0]) for r in res)
    print(f"\nlevels: {len(res)}   birds over the band: {tot}   levels affected: {sum(1 for r in res if any(d['over_px']>0 for d in r['dogs']))}")
