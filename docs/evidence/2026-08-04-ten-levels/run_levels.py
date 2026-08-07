"""Ten new square FTB levels — 20 birds each, 25% smaller, magenta lane.

Drives the running level-editor server (port 5192) per level:
create session -> bg generation job -> select bg -> deterministic lanczos 4x
upscale (1024 -> 4096, in place; the editor's fal upscale lane is unrelated) ->
auto-hitboxes (radius 58 = 0.75x the campaign's effective 77px placement) ->
magenta crop-inpaint job (20 birds, one generation per bird) -> fix-hitboxes
(recenter to painted sprites) -> ship tail in-process (white-rim strip if
present, export_to_game WITHOUT manifest updates, webp derivatives).

The five campaign levels and all three active manifests are never touched.
Resumable via ledger.json.
"""
from __future__ import annotations

import json, os, sys, time, urllib.request
from pathlib import Path

sys.path.insert(0, "/Users/base/dev/appletolye/fabrikav2/tools/level-editor")
os.environ.setdefault("LEVEL_EDITOR_GAME", "find_the_bird")
from levelbuilder.settings import apply_game_from_env
apply_game_from_env()

import numpy as np
from PIL import Image
from scipy import ndimage
from levelbuilder.api import session as S
from levelbuilder.api.session import export_to_game

API = "http://localhost:5192/api"
HERE = Path(__file__).parent
LEDGER = HERE / "ledger.json"
MODEL = "google/gemini-3.1-flash-image-preview"
N_DOGS = 20
RADIUS = 58          # 4096-space; campaign effective placement was ~77 -> 0.75x
TARGET_EDGE = 4096

RECIPES = [
    ("japan", "japan_temple_garden"),
    ("uk", "uk_cotswolds_village"),
    ("france", "france_provence_lavender_village"),
    ("italy", "italy_tuscan_hill_village"),
    ("mexico", "mexico_dia_de_muertos_plaza"),
    ("fairytale_forest", "fairytale_forest_fairy_ring_picnic"),
    ("railway_roundhouse", "railway_roundhouse_sleepy_mountain_rail_stop"),
    ("coral_reef", "coral_reef_tidal_pool_labyrinth"),
    ("turkey", "turkey_cappadocia_balloon_dawn"),
    ("nordic_cold", "nordic_cold_bergen_harbor"),
]


def api(method: str, path: str, body: dict | None = None, timeout: int = 120):
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read() or b"{}")


def poll(path: str, timeout_s: int, interval: int = 10) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        job = api("GET", path)
        status = job.get("status")
        if status in ("succeeded", "failed"):
            return job
        time.sleep(interval)
    raise TimeoutError(f"job at {path} did not finish in {timeout_s}s")


def ledger() -> dict:
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else {}


def save_ledger(d: dict) -> None:
    LEDGER.write_text(json.dumps(d, indent=1))


def strip_white_rim(img: Image.Image) -> tuple[Image.Image, int]:
    a = np.array(img.convert("RGBA"), dtype=np.uint8)
    rgb, al = a[..., :3].astype(int), a[..., 3]
    whiteish = (rgb.min(axis=2) >= 215) & (al > 0)
    transparent = al == 0
    edge = ndimage.binary_dilation(np.pad(transparent, 1, constant_values=True))[1:-1, 1:-1]
    lab, n = ndimage.label(whiteish)
    rim = np.zeros_like(whiteish)
    for i in range(1, n + 1):
        m = lab == i
        if (m & edge).any():
            rim |= m
    halo = ndimage.binary_dilation(rim) & (rgb.min(axis=2) >= 185) & ~rim
    a[..., 3][rim | halo] = 0
    return Image.fromarray(a), int((rim | halo).sum())


def _load_env_key(name: str) -> str:
    for line in Path("/Users/base/dev/appletolye/.env").read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError(f"{name} not in ~/.env")


def rebuild_detections(sid: str, hitboxes: list[dict]) -> list[dict]:
    """Vision recognition of ALL birds in the painted scene (the model does
    not respect the magenta markers, so paint-diff heuristics find scenery;
    recognition is the reconcile contract's intended input)."""
    import base64, io
    sdir = S.session_dir(sid)
    img = Image.open(sdir / "color.png").convert("RGB")
    W0 = img.width
    scaled = img.resize((1024, 1024))
    buf = io.BytesIO()
    scaled.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    key = _load_env_key("OPENROUTER_API_KEY")
    expected = len(hitboxes)
    hint = ""
    for attempt in range(4):
        body = json.dumps({
            "model": "google/gemini-3.6-flash",
            "temperature": 0,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text":
                    f"This hidden-object game scene contains exactly {expected} birds. "
                    "Find every single bird, including partially occluded or camouflaged ones. "
                    "Return ONLY a JSON array with one entry per bird: "
                    '{"box_2d": [ymin, xmin, ymax, xmax]} with coordinates normalized to 0-1000. '
                    "Boxes must be tight around each bird's body (include held props). " + hint},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ]}],
        }).encode()
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions", method="POST", data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        res = json.loads(urllib.request.urlopen(req, timeout=180).read())
        text = res["choices"][0]["message"]["content"]
        start, end = text.find("["), text.rfind("]")
        try:
            boxes = json.loads(text[start:end + 1])
        except Exception:
            boxes = []
        boxes = [b for b in boxes if isinstance(b, dict) and len(b.get("box_2d", [])) == 4]
        if len(boxes) == expected:
            out = []
            for b in boxes:
                ymin, xmin, ymax, xmax = [v / 1000 * W0 for v in b["box_2d"]]
                out.append({"x": int(xmin), "y": int(ymin),
                            "width": max(1, int(xmax - xmin)),
                            "height": max(1, int(ymax - ymin)),
                            "confidence": 1.0})
            return out
        hint = (f"Your previous answer had {len(boxes)} boxes, which is wrong — "
                f"the scene has exactly {expected} birds. Look again carefully.")
    raise RuntimeError(f"recognition never returned exactly {expected} birds")


def run_level(setting: str, scene: str, state: dict) -> dict:
    # 1. create session
    if "sessionId" not in state:
        res = api("POST", "/sessions", {
            "setting": setting, "scene": scene, "entity": "bird",
            "view": "isometric_close_20", "style": "clean_old_cartoon",
            "scale": "none", "model": MODEL, "nDogs": N_DOGS,
            "aspectRatio": "1:1", "imageSize": "1K",
            "upscaleEnabled": False,
            "tags": ["ten-levels-2026-08-04"],
        })
        state["sessionId"] = res["sessionId"]
        state["dogPrompt"] = res["dogPrompt"]
        save_all()
    sid = state["sessionId"]

    # 2. background generation
    if not state.get("bgDone"):
        job = api("POST", f"/sessions/{sid}/background-generation/jobs", {})
        job = poll(f"/sessions/{sid}/background-generation/jobs/{job['jobId']}", 900)
        if job["status"] != "failed":
            api("POST", f"/sessions/{sid}/select-bg", {"bgIndex": 0})
            state["bgDone"] = True
            save_all()
        else:
            raise RuntimeError(f"bg generation failed: {job.get('error')}")

    # 3. deterministic lanczos upscale to 4096, in place
    if not state.get("upscaled"):
        sdir = S.session_dir(sid)
        bg = Image.open(sdir / "bg_00.png")
        if max(bg.size) < TARGET_EDGE:
            scale = TARGET_EDGE / max(bg.size)
            up = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.LANCZOS)
            up.save(sdir / "bg_00.png")
            S.update_session_field(
                sid, selected_bg=0, bg_width=up.width, bg_height=up.height,
                upscale_enabled=True, upscale_model="deterministic-lanczos-4x",
                upscale_target_long_edge=TARGET_EDGE,
            )
        state["upscaled"] = True
        save_all()

    # 4. hitboxes (25% smaller target radius)
    if "hitboxes" not in state:
        res = api("POST", f"/sessions/{sid}/auto-hitboxes",
                  {"nDogs": N_DOGS, "radius": RADIUS, "strategy": "random"})
        state["hitboxes"] = res["hitboxes"]
        save_all()

    # 5. magenta paint job — one generation per bird
    if not state.get("painted"):
        job = api("POST", f"/sessions/{sid}/inpaint/jobs", {
            "hitboxes": state["hitboxes"],
            "dogPrompt": state["dogPrompt"],
            "inpaintMode": "magenta",
            "padding": 2.75,
        })
        # magenta mode enqueues kind=magenta_inpaint; the per-session crop
        # poll route 404s on it, so poll the generic jobs route.
        job = poll(f"/jobs/{job['jobId']}", 3600, interval=20)
        result = job.get("result") or {}
        state["paintResult"] = {"status": job.get("status"), **{k: result.get(k) for k in ("succeeded", "failed", "error") if k in result}}
        raw = S.load_session_raw(sid) or {}
        done = sum(1 for d in raw.get("dogs", [])
                   if isinstance(d, dict) and d.get("status") == "done")
        state["dogsDone"] = done
        if job.get("status") == "failed" or done < N_DOGS - 2:
            raise RuntimeError(f"paint job unhealthy: {state['paintResult']} dogsDone={done}")
        state["painted"] = True
        save_all()

    # 6. detections (deterministic diff vs clean bg) -> reconcile -> sprites
    if not state.get("hitboxesFixed"):
        detections = rebuild_detections(sid, state["hitboxes"])
        state["detections"] = detections
        api("POST", f"/sessions/{sid}/reconcile-magenta-hitboxes",
            {"detections": detections, "minimumConfidence": 0.5})
        # Materialize sprites; a bird whose paint defies semantic extraction
        # gets repainted via the per-dog regen lane, then we retry.
        import re as _re, urllib.error
        regens = 0
        for attempt in range(6):
            try:
                api("POST", f"/sessions/{sid}/materialize-detection-sprites",
                    {"detections": detections, "minimumConfidence": 0.5}, timeout=1800)
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode()[:400]
                m = _re.search(r"detection (\d+)", detail)
                if e.code != 409 or m is None or regens >= 4:
                    raise RuntimeError(f"materialize failed: {e.code} {detail}")
                bad = int(m.group(1))
                regens += 1
                api("POST", f"/sessions/{sid}/dogs/{bad}/regen",
                    {"prompt": state["dogPrompt"], "padding": 2.75}, timeout=600)
                detections = rebuild_detections(sid, state["hitboxes"])
                state["detections"] = detections
                api("POST", f"/sessions/{sid}/reconcile-magenta-hitboxes",
                    {"detections": detections, "minimumConfidence": 0.5})
                save_all()
        else:
            raise RuntimeError("materialize never converged")
        state["regens"] = regens
        # Reconcile clamps r to the 1K-era 22-64 band; recompute tap radii
        # from the materialized sprite dimensions (campaign-comparable: the
        # shipped levels sit around r ~= 0.75 * max sprite edge).
        raw = S.load_session_raw(sid) or {}
        sdir = S.session_dir(sid)
        hbs = json.loads((sdir / "hitboxes.json").read_text())
        for d in raw.get("dogs", []):
            if not isinstance(d, dict) or not isinstance(d.get("index"), int):
                continue
            i, av = d["index"], d.get("activeVariant") or 0
            meta_path = S.dogs_dir(sid) / f"dog_{i:02d}" / f"sprite_{av:03d}.json"
            if not meta_path.exists() or i >= len(hbs):
                continue
            meta = json.loads(meta_path.read_text())
            sb = meta.get("spriteBox") or [0, 0, 0, 0]
            edge = max(sb[2] - sb[0], sb[3] - sb[1])
            hbs[i]["r"] = max(60, min(256, round(0.75 * edge)))
        S.save_hitboxes(sid, hbs)
        S.recenter_hitboxes_to_sprites(sid, max_offset_fraction=0.5)
        state["hitboxesFixed"] = True
        save_all()

    # 7. ship tail: rim strip (if any), export package only, webp derivatives
    if not state.get("shipped"):
        raw = S.load_session_raw(sid) or {}
        stripped = 0
        for d in raw.get("dogs", []):
            if not isinstance(d, dict) or not isinstance(d.get("index"), int):
                continue
            dog_dir = S.dogs_dir(sid) / f"dog_{d['index']:02d}"
            av = d.get("activeVariant") or 0
            sp_path = dog_dir / f"sprite_{av:03d}.png"
            if not sp_path.exists():
                continue
            img = Image.open(sp_path)
            out, removed = strip_white_rim(img)
            if removed > 50:
                out.save(sp_path)
                out.split()[3].save(dog_dir / f"sprite_mask_{av:03d}.png")
                stripped += 1
        state["rimStripped"] = stripped
        export_to_game(sid, update_preview_manifest=False)
        pub = Path("/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/public/levels") / sid
        for stem in ("color", "bg_00"):
            png = pub / f"{stem}.png"
            if png.exists():
                with Image.open(png) as img:
                    img.convert("RGB").save(pub / f"{stem}.webp", format="WEBP", quality=80, method=6)
        state["shipped"] = True
        save_all()
    return state


LEDGER_STATE: dict = {}


def save_all() -> None:
    save_ledger(LEDGER_STATE)


def main() -> None:
    global LEDGER_STATE
    LEDGER_STATE = ledger()
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for setting, scene in RECIPES:
        if only and scene != only:
            continue
        state = LEDGER_STATE.setdefault(scene, {})
        if state.get("shipped"):
            print(scene, "already shipped", flush=True)
            continue
        try:
            run_level(setting, scene, state)
            print(scene, "OK", state.get("paintResult"), "rimStripped:", state.get("rimStripped"), flush=True)
        except Exception as e:
            state["lastError"] = str(e)[:500]
            save_all()
            print(scene, "FAILED:", e, flush=True)


if __name__ == "__main__":
    main()
