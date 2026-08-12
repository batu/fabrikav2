from __future__ import annotations

import argparse
import base64
import html
import io
import json
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
DEFAULT_SERVER = "http://127.0.0.1:5196"
def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def get_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()


def data_url(payload: bytes) -> str:
    image = Image.open(io.BytesIO(payload)).convert("RGB")
    output = io.BytesIO()
    image.save(output, "WEBP", quality=74, method=6)
    return "data:image/webp;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def candidate_map(server: str, level_id: str) -> dict[int, dict]:
    payload = get_json(
        f"{server}/api/sessions/{urllib.parse.quote(level_id, safe='')}/sprite-candidates"
    )
    return {int(item["dogIndex"]): item for item in payload.get("candidates", [])}


def overlay(server: str, level_id: str, candidate_id: str) -> bytes:
    return get_bytes(
        f"{server}/api/sessions/{urllib.parse.quote(level_id, safe='')}"
        f"/sprite-candidates/{urllib.parse.quote(candidate_id, safe='')}/overlay"
    )


def fit_image(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    contained = ImageOps.contain(image.convert("RGB"), size)
    canvas = Image.new("RGB", size, "#11130f")
    canvas.paste(contained, ((size[0] - contained.width) // 2, (size[1] - contained.height) // 2))
    return canvas


def draw_summary(method: dict, levels: list[dict], images: dict[tuple[str, int], bytes]) -> Path:
    width = 1100
    header = 190
    cell_w = width // len(levels)
    cell_h = 132
    canvas = Image.new("RGB", (width, header + cell_h * 25), "#ecebdc")
    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia Bold.ttf", 42)
    font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 16)
    small_font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 12)
    label = method["label"]
    draw.text((34, 24), f"{label} · BEST-SAFE PLACED", fill="#15170f", font=title_font)
    draw.text(
        (36, 88),
        f"{method['materialized']}/125 cutouts  |  {method['calls']} calls  |  ${method['usd']:.4f}  |  {method['durationSeconds']} sec",
        fill="#15170f",
        font=font,
    )
    draw.text((36, 124), "All 125 slots · one level per column · dog_00 through dog_24", fill="#58604e", font=font)
    for col, level in enumerate(levels):
        draw.text((col * cell_w + 8, 160), f"LEVEL {col + 1}", fill="#00a966", font=small_font)
        for row, dog_index in enumerate(range(25)):
            x = col * cell_w
            y = header + row * cell_h
            payload = images.get((level["level"], dog_index))
            if payload:
                image = Image.open(io.BytesIO(payload))
                thumb = fit_image(image, (cell_w - 12, cell_h - 28))
            else:
                thumb = Image.new("RGB", (cell_w - 12, cell_h - 28), "#791f24")
                ImageDraw.Draw(thumb).text((16, 16), "MISSING", fill="white", font=small_font)
            canvas.paste(thumb, (x + 6, y + 6))
            draw.text((x + 10, y + cell_h - 18), f"dog_{dog_index:02d}", fill="#15170f", font=small_font)
    path = ASSETS / f"{method['slug']}-summary.png"
    canvas.save(path, optimize=True)
    return path


def render_method(method: dict, server: str) -> tuple[str, list[dict], dict[tuple[str, int], bytes]]:
    sections: list[str] = []
    method_levels: list[dict] = []
    all_images: dict[tuple[str, int], bytes] = {}
    techniques: Counter[str] = Counter()
    for level in method["levels"]:
        candidates = candidate_map(server, level["level"])
        cards: list[str] = []
        for dog_index in range(25):
            candidate = candidates.get(dog_index)
            if candidate is None:
                cards.append(
                    f'<article class="bird missing"><div class="missing-mark">NO CUTOUT</div>'
                    f'<footer><b>dog_{dog_index:02d}</b><span>failed</span></footer></article>'
                )
                continue
            payload = overlay(server, level["level"], candidate["id"])
            all_images[(level["level"], dog_index)] = payload
            technique = str(candidate.get("technique") or "unknown")
            techniques[technique] += 1
            quality = candidate.get("quality") or {}
            status = "paid flat-key" if technique == "flatkey-recreate-v1" else "fallback"
            cards.append(
                '<article class="bird">'
                f'<img src="{data_url(payload)}" alt="Overlay for {html.escape(level["level"])} dog {dog_index:02d}">'
                f'<footer><b>dog_{dog_index:02d}</b><span>{html.escape(status)}</span></footer>'
                f'<small>{html.escape(technique)} · coverage {float(quality.get("visibleCoverage") or 0):.2f}</small>'
                '</article>'
            )
        method_levels.append(level)
        sections.append(
            '<section class="level">'
            f'<header><div><span>Level {len(method_levels)} of 5</span><h3>{html.escape(level["level"])}</h3></div>'
            f'<p>{level["materialized"]}/25 materialized · {level["calls"]} calls · ${level["usd"]:.4f} · {level["durationSeconds"]}s</p></header>'
            f'<div class="birds">{"".join(cards)}</div></section>'
        )
    method["techniques"] = dict(techniques)
    return "".join(sections), method_levels, all_images


def stat(label: str, value: str, note: str) -> str:
    return f'<div class="stat"><span>{html.escape(label)}</span><b>{html.escape(value)}</b><small>{html.escape(note)}</small></div>'


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("results", type=Path)
    parser.add_argument("--server", default=DEFAULT_SERVER)
    args = parser.parse_args()
    results = json.loads(args.results.read_text())
    methods = results["methods"]
    rendered: dict[str, str] = {}
    summary_paths: list[Path] = []
    for method in methods:
        markup, levels, images = render_method(method, args.server)
        rendered[method["slug"]] = markup
        summary_paths.append(draw_summary(method, levels, images))

    total_usd = sum(item["usd"] for item in methods)
    total_seconds = sum(item["durationSeconds"] for item in methods)
    comparison_rows = "".join(
        '<tr>'
        f'<th>{html.escape(method["label"])}</th>'
        f'<td>{method["materialized"]}/125</td><td>{method["flatkeyCount"]}</td>'
        f'<td>{method["calls"]}</td><td>${method["usd"]:.6f}</td>'
        f'<td>{method["durationSeconds"]}s</td><td>{method["failed"]}</td>'
        '</tr>'
        for method in methods
    )
    sections = "".join(
        f'<section class="method" id="{method["slug"]}">'
        f'<div class="method-title"><span>Initial extraction grid</span><h2>{html.escape(method["label"])}</h2>'
        f'<p>{method["flatkeyCount"]} paid flat-key cutouts; {method["materialized"] - method["flatkeyCount"]} fallback recoveries; {method["failed"]} missing.</p></div>'
        f'{rendered[method["slug"]]}</section>'
        for method in methods
    )
    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Find the Bird cutout grid comparison</title>
<style>
:root{{--paper:#ecebdc;--ink:#15170f;--muted:#626956;--line:#afb39d;--green:#00a966;--red:#9d2e35;--panel:#f7f5e7}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 Georgia,serif}}main{{max-width:1500px;margin:auto;padding:44px 30px 90px}}.kicker,.method-title span,.level header span{{font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--green)}}h1{{font-size:clamp(44px,7vw,94px);line-height:.92;letter-spacing:-.055em;max-width:1120px;margin:18px 0 22px}}.lede{{max-width:840px;font-size:20px;color:var(--muted)}}.jump{{display:flex;gap:10px;margin:28px 0 34px}}.jump a{{display:inline-block;padding:11px 16px;border:1px solid var(--ink);color:var(--ink);text-decoration:none;font:700 13px ui-monospace,monospace}}.jump a:focus,.jump a:hover{{background:var(--ink);color:var(--paper)}}.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin:36px 0}}.stat{{background:var(--panel);padding:20px}}.stat span,.stat small{{display:block;color:var(--muted);font:12px ui-monospace,monospace}}.stat b{{display:block;font:700 34px/1.1 ui-monospace,monospace;margin:8px 0}}.reading{{border-left:5px solid var(--green);padding:16px 20px;background:var(--panel);max-width:980px}}table{{border-collapse:collapse;width:100%;margin:44px 0;font:14px ui-monospace,monospace}}th,td{{text-align:left;padding:12px;border-bottom:1px solid var(--line)}}thead th{{color:var(--muted);font-size:11px;text-transform:uppercase}}.method{{margin-top:84px}}.method-title{{display:grid;grid-template-columns:1fr 1fr;align-items:end;border-bottom:3px solid var(--ink);padding-bottom:18px}}.method-title h2{{font-size:58px;line-height:.9;margin:8px 0 0}}.method-title p{{margin:0;color:var(--muted);max-width:580px}}.level{{margin:56px 0}}.level>header{{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:15px}}.level h3{{font:700 18px/1.2 ui-monospace,monospace;margin:5px 0;overflow-wrap:anywhere}}.level header p{{color:var(--muted);font:12px ui-monospace,monospace;margin:0;white-space:nowrap}}.birds{{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}}.bird{{min-width:0;background:var(--panel);border:1px solid var(--line);padding:7px;margin:0}}.bird img,.missing-mark{{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#11130f}}.bird footer{{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font:12px ui-monospace,monospace}}.bird footer span{{color:var(--green)}}.bird small{{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);font:10px ui-monospace,monospace;margin-top:4px}}.bird.missing{{border-color:var(--red)}}.bird.missing footer span{{color:var(--red)}}.missing-mark{{display:grid;place-items:center;color:#fff;background:var(--red);font:700 13px ui-monospace,monospace}}@media(max-width:900px){{main{{padding:26px 15px}}.stats{{grid-template-columns:1fr 1fr}}.birds{{grid-template-columns:repeat(3,1fr)}}.method-title{{grid-template-columns:1fr}}.method-title p{{margin-top:14px}}.level>header{{display:block}}.level header p{{white-space:normal}}}}@media(max-width:520px){{.birds{{grid-template-columns:repeat(2,1fr)}}.stats{{grid-template-columns:1fr}}}}
</style></head><body><main><div class="kicker">Find the Bird · Gemini Flash · best-safe placement · 10 August 2026</div><h1>Which auto-fitted grid earns the remaining cutouts?</h1>
<p class="lede">Ten untouched, non-lineup levels. Twenty-five painted birds per level. Five levels started in a 3×3 panel and five in a 2×2 panel. Best-safe then fitted all 248 available sprites. Every card shows the fitted sprite in translucent green over the painted bird.</p>
<nav class="jump"><a href="#grid-3x3">Review 3×3</a><a href="#grid-2x2">Review 2×2</a></nav>
<section class="stats">{stat("Experiment", "250 birds", "125 per initial grid")}{stat("Best-safe placed", "248 / 248", "all available sprites")}{stat("Actual spend", f"${total_usd:.6f}", "extraction only · merceka ledger")}{stat("Extraction runtime", f"{total_seconds}s", "serial end-to-end")}</section>
<p class="reading"><b>How to judge:</b> the green body should cover the painted bird with the same pose and scale. Exposed painted edges indicate an undersized or offset cutout; green outside the bird indicates excess body, another bird, or background contamination. The white box is the extraction crop. “Initial grid” matters: failures may fall through to smaller panels or the free extraction chain.</p>
<table><thead><tr><th>Method</th><th>Materialized</th><th>Paid flat-key</th><th>Calls</th><th>Actual cost</th><th>Time</th><th>Missing</th></tr></thead><tbody>{comparison_rows}</tbody></table>
{sections}</main></body></html>'''
    output = HERE / "report.html"
    output.write_text(document)
    print(json.dumps({"report": str(output), "summaries": [str(path) for path in summary_paths]}))


if __name__ == "__main__":
    main()
