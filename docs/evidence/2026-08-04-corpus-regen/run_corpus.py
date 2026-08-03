"""Corpus regeneration via flat-key generate-first (#29): all birds, one model lane.

    uv run --project ../../../tools/level-editor python run_corpus.py --model <id> --lane <name> [--limit N]

Per bird: condition on the painted crop, render the bird on a flat magenta key
via merceka edit_image, recover RGBA with harness16's fitted chroma key,
composite the exact pixels into the untouched clean crop. Resumable ledger.
"""
from __future__ import annotations
import argparse, json, os, time, traceback
from pathlib import Path
from PIL import Image
import numpy as np
import harness16  # noqa: E402 — #16's chroma_key/_estimate_background_field etc.

def despill(cutout):
    """Neutralize residual magenta/green halo on edge pixels."""
    arr = np.asarray(cutout.convert("RGBA")).astype(np.int16)
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    edge = (a > 0) & (a < 255)
    magenta = (r > g + 40) & (b > g + 40)
    green = (g > r + 40) & (g > b + 40)
    spill = (edge | (a > 0)) & (magenta | green)
    # pull spill pixels toward their neighborhood-neutral gray
    m = (r + g + b) // 3
    for c in range(3):
        arr[:,:,c] = np.where(spill, m, arr[:,:,c])
    # fully drop low-alpha spill edge
    arr[:,:,3] = np.where(spill & (a < 90), 0, arr[:,:,3])
    from PIL import Image as _I
    return _I.fromarray(arr.astype("uint8"), "RGBA")

def flat_ok(flat, cutout):
    """Detect failed generations: non-flat key or duplicated subject."""
    arr = np.asarray(flat.convert("RGB")).astype(np.int16)
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    key = (r > 180) & (b > 180) & (g < 120)
    ca = np.asarray(cutout.convert("RGBA"))[:,:,3] > 8
    keyfrac = float(key.mean()); birdfrac = float(ca.mean())
    if keyfrac + birdfrac < 0.97:  # anything beyond bird+key = painted context
        return False, f"non-flat key (key={keyfrac:.2f} bird={birdfrac:.2f})"
    # background-purity inside the cutout: near-gray or near-white large zones
    ca_arr = np.asarray(cutout.convert("RGBA")).astype(np.int16)
    rr, gg, bb2, aa = ca_arr[:,:,0], ca_arr[:,:,1], ca_arr[:,:,2], ca_arr[:,:,3]
    vis = aa > 8
    grayish = vis & (abs(rr-gg) < 18) & (abs(gg-bb2) < 18) & (rr > 90) & (rr < 230)
    if vis.sum() and float(grayish.sum())/float(vis.sum()) > 0.45:
        return False, f"cutout dominated by flat gray/white background ({grayish.sum()/vis.sum():.2f})"
    import sys as _s
    _s.path.insert(0, str((HERE / "../../../tools/level-editor").resolve()))
    from levelbuilder.api.sprite_eval import _connected_components
    comps = _connected_components(ca)
    big = [c for c in comps if c.sum() > 0.25 * max(1, comps[0].sum())]
    if len(big) > 1:
        return False, f"{len(big)} large components (duplicate subject?)"
    return True, ""

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
WS = REPO / "games" / "find_the_bird" / ".levelbuilder" / "levels"
PUBLIC = REPO / "games" / "find_the_bird" / "public" / "levels"

FLAT_PROMPT = (
    "Recreate the exact same cartoon bird character from this image — identical "
    "species impression, colors, markings, pose, expression, and any held or worn "
    "item (broom, basket, hat, tool: keep it) — as a clean sticker illustration "
    "on a completely uniform, flat, pure magenta (#FF00FF) background. Match the "
    "image's rendering style (if it is uncolored line art, stay uncolored). "
    "Exactly ONE bird. No shadows, no scenery, no props that the bird is not "
    "holding, no gradient, no texture: perfectly flat magenta everywhere except "
    "the bird itself. The bird must be fully inside the frame."
)

BENCH = json.loads((HERE / "benchmark-manifest.json").read_text())
BENCH_KEYS = {(c["levelId"], c["dogDir"]) for c in (BENCH.get("cases") or BENCH)}

def birds():
    for lv in sorted(p.name for p in PUBLIC.iterdir() if (p / "level.json").exists()):
        sdir = WS / lv
        if not (sdir / "session.json").exists():
            continue
        raw = json.loads((sdir / "session.json").read_text())
        hbs = json.loads((sdir / "hitboxes.json").read_text())
        hb_by_id = {h.get("id"): h for h in hbs}
        for d in raw.get("dogs", []):
            if not isinstance(d, dict) or not d.get("id") or d.get("id") not in hb_by_id:
                continue
            av = d.get("activeVariant")
            if av is None:
                continue
            dog_dir = sdir / "dogs" / f"dog_{d['index']:02d}"
            vp = dog_dir / f"variant_{av:03d}.png"
            bp = dog_dir / f"variant_{av:03d}.box.json"
            if (lv, f"dog_{d['index']:02d}") not in BENCH_KEYS:
                continue
            if vp.exists() and bp.exists():
                yield lv, d, hb_by_id[d["id"]], vp, bp, sdir

def judge_gate(cutout, painted):
    """codex vision gate: complete single bird + held item, no stray artifacts."""
    import sys as _s
    _s.path.insert(0, str((HERE / "../../../tools/level-editor").resolve()))
    from levelbuilder.api.sprite_judge import CodexExecJudge, JudgeCase
    v = CodexExecJudge().judge(JudgeCase(dog_id="gate", sprite=cutout, painted_crop=painted))
    if not v.ok:
        return True, ""  # judge unavailable: fail open, heuristics already passed
    if v.subject >= 0.5 and v.completeness >= 0.5:
        return True, ""
    return False, f"judge reject subject={v.subject} completeness={v.completeness}: {v.evidence[:80]}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--lane", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--levels", default="", help="comma-separated level ids; overrides the benchmark scoping")
    a = ap.parse_args()
    from merceka_core.image import edit_image
    out = HERE / f"lane-{a.lane}"
    out.mkdir(exist_ok=True)
    ledger_p = out / "ledger.json"
    ledger = json.loads(ledger_p.read_text()) if ledger_p.exists() else {}
    if a.levels:
        wanted = set(a.levels.split(","))
        global BENCH_KEYS
        BENCH_KEYS = {(lv, f"dog_{i:02d}") for lv in wanted for i in range(30)}
        todo = [t for t in birds() if t[0] in wanted]
    else:
        todo = list(birds())
    if a.limit:
        todo = todo[: a.limit]
    done = fail = 0
    for i, (lv, d, hb, vp, bp, sdir) in enumerate(todo):
        key = f"{lv}/dog_{d['index']:02d}"
        if ledger.get(key, {}).get("ok"):
            done += 1
            continue
        t0 = time.time()
        try:
            painted = Image.open(vp).convert("RGB")
            box = json.loads(bp.read_text())["box"]
            reason = ""
            for attempt in range(3):
                flat = edit_image(painted, FLAT_PROMPT, model=a.model)
                cutout = harness16.chroma_key(flat.convert("RGB"))
                ok, reason = flat_ok(flat, cutout)
                if not ok:
                    continue
                cutout = despill(cutout)
                ok, reason = judge_gate(cutout, painted)
                if ok:
                    break
            else:
                raise RuntimeError(f"3 attempts failed: {reason}")
            clean = Image.open(sdir / "bg_00.png").convert("RGB").crop(box)
            # Exact-bbox compositing: fit the generated bird into the ORIGINAL
            # bird's sprite box (crop-local), centered — no scale blowups.
            meta_p = vp.parent / f"sprite_{int(vp.stem.split('_')[1]):03d}.json"
            comp = clean.copy()
            bb = cutout.getbbox()
            trimmed = cutout.crop(bb)
            if meta_p.exists():
                sb = json.loads(meta_p.read_text())["spriteBox"]
                tw, th = sb[2] - sb[0], sb[3] - sb[1]
                scale = min(tw / trimmed.width, th / trimmed.height)
                nw, nh = max(1, round(trimmed.width * scale)), max(1, round(trimmed.height * scale))
                fitted = trimmed.resize((nw, nh), Image.LANCZOS)
                cx = sb[0] - box[0] + (tw - nw) // 2
                cy = sb[1] - box[1] + (th - nh)  # feet anchored to old bbox bottom
                comp.paste(fitted, (cx, cy), fitted)
                cutout = fitted
            else:
                comp.paste(trimmed, (0, 0), trimmed)
                cutout = trimmed
            bdir = out / lv
            bdir.mkdir(exist_ok=True)
            cutout.save(bdir / f"dog_{d['index']:02d}_cutout.png")
            comp.save(bdir / f"dog_{d['index']:02d}_composite.png")
            flat.convert("RGB").save(bdir / f"dog_{d['index']:02d}_flat.png")
            ledger[key] = {"ok": True, "s": round(time.time() - t0, 1)}
            done += 1
        except Exception as e:
            ledger[key] = {"ok": False, "err": f"{type(e).__name__}: {str(e)[:160]}"}
            fail += 1
            traceback.print_exc()
        ledger_p.write_text(json.dumps(ledger, indent=1))
        print(f"[{i+1}/{len(todo)}] {key} ok={ledger[key]['ok']}", flush=True)
    print(f"lane {a.lane} done: {done} ok, {fail} failed")

if __name__ == "__main__":
    main()
