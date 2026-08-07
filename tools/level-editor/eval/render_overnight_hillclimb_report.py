from __future__ import annotations

import base64
import html
import io
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from PIL import Image


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RUN = ROOT / ".context/compound-engineering/ce-optimize/ftb-golden-cutout-overnight"
LOG = RUN / "experiment-log.yaml"
VISUALS = RUN / "visual-review"
REDO = HERE / "results/golden-cutout-v1/redo-evaluation.json"
OUTPUT = ROOT / "docs/reports/2026-08-08-ftb-golden-cutout-overnight-report.html"


def load_yaml(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["ruby", "-rjson", "-ryaml", "-e", "puts JSON.generate(YAML.safe_load(File.read(ARGV[0])))", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def image_data(path: Path) -> str:
    with Image.open(path) as source:
        image = source.convert("RGB")
        image.thumbnail((1440, 1200), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, "JPEG", quality=84, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()


def status_label(outcome: str) -> str:
    return {
        "kept": "kept",
        "reverted": "no win",
        "degenerate": "gate fail",
        "error": "error",
    }.get(outcome, outcome)


log = load_yaml(LOG)
subprocess.run([sys.executable, str(RUN / "render_frontier_review.py")], check=True, cwd=ROOT)
baseline = log["baseline"]["diagnostics"]
best = log["best"]["metrics"]
redo = json.loads(REDO.read_text())
winner = redo["models"][redo["winner"]]
revision = subprocess.run(
    ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True,
).stdout.strip()

experiment_rows = []
for experiment in log["experiments"]:
    diagnostics = experiment.get("diagnostics", {})
    experiment_rows.append(
        f'''<tr data-status="{html.escape(experiment['outcome'])}">
        <td>{experiment['iteration']:02d}</td>
        <td>{html.escape(experiment['category'])}</td>
        <td>{html.escape(experiment['hypothesis'])}</td>
        <td><span class="status {html.escape(experiment['outcome'])}">{status_label(experiment['outcome'])}</span></td>
        <td>{diagnostics.get('objective_loss', 0):.6f}</td>
        <td>{html.escape(experiment.get('primary_delta', '—'))}</td>
        <td>{html.escape(experiment.get('learnings', ''))}</td>
        </tr>'''
    )

images = {
    "decision": image_data(VISUALS / "frontier-01.png"),
    "regressions": image_data(VISUALS / "frontier-03.png"),
    "hard": image_data(VISUALS / "frontier-05.png"),
    "ceiling": image_data(VISUALS / "frontier-02.png"),
}
relative_gain = (best["redo_average_precision"] / baseline["redo_average_precision"] - 1.0) * 100

document = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Find the Bird — Overnight Cutout Hill-Climb</title>
<style>
:root{{--paper:#f0ede3;--panel:#faf8f1;--ink:#20251f;--muted:#687068;--line:#c8c4b8;--green:#28724a;--green-soft:#dce9de;--red:#a74036;--red-soft:#f0ddd8;--amber:#a86d21;--blue:#2f708d}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 "Iowan Old Style","Palatino Linotype",Georgia,serif}}main{{width:min(1320px,calc(100% - 32px));margin:auto;padding:28px 0 92px}}h1{{font-size:clamp(45px,7vw,88px);line-height:.92;letter-spacing:-.055em;margin:10px 0 18px;max-width:1050px}}h2{{font-size:clamp(28px,4vw,48px);line-height:1;letter-spacing:-.035em;margin:0}}h3{{margin:0 0 8px;font-size:22px}}p{{margin:0 0 12px}}.mono,.eyebrow,.metric span,.status,table,.audit{{font-family:"SFMono-Regular",Consolas,monospace}}header{{border-top:8px solid var(--ink);padding:20px 0 36px;display:grid;grid-template-columns:1.5fr .5fr;gap:30px;align-items:end}}.eyebrow{{font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:800;color:var(--green)}}.summary{{font-size:clamp(20px,2.4vw,29px);line-height:1.25;max-width:900px}}.stamp{{border-left:1px solid var(--line);padding-left:22px;color:var(--muted)}}.stamp b{{display:block;color:var(--ink);font-size:28px}}.verdict{{background:var(--ink);color:#f8f5ed;padding:28px;display:grid;grid-template-columns:1.15fr .85fr;gap:30px;margin-bottom:22px}}.verdict strong{{color:#91ddb0}}.verdict .risk strong{{color:#ffb3aa}}.metrics{{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--line);background:var(--panel)}}.metric{{padding:20px;border-right:1px solid var(--line)}}.metric:last-child{{border:0}}.metric b{{display:block;font-size:30px;line-height:1.05}}.metric span{{font-size:10px;color:var(--muted)}}section{{border-top:1px solid var(--line);margin-top:64px;padding-top:28px}}.section-head{{display:grid;grid-template-columns:.7fr 1.3fr;gap:36px;margin-bottom:24px}}.section-head p{{font-size:18px;color:var(--muted)}}.decision-grid{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}.decision{{background:var(--panel);padding:22px;border-top:5px solid var(--green)}}.decision.reject{{border-color:var(--red)}}.decision code{{font:12px "SFMono-Regular",Consolas,monospace}}.evidence{{margin:18px 0;background:var(--panel);border:1px solid var(--line)}}.evidence img{{display:block;width:100%;height:auto}}.evidence figcaption{{padding:14px 18px;color:var(--muted)}}.callout{{padding:18px 22px;background:#ebe0cb;border-left:5px solid var(--amber);margin:20px 0}}.controls{{position:sticky;top:6px;z-index:2;display:flex;gap:8px;padding:10px 0;background:#f0ede3ee;backdrop-filter:blur(9px)}}.controls input{{position:absolute;opacity:0}}.controls span{{display:block;padding:8px 12px;border:1px solid var(--line);background:var(--panel);font:12px "SFMono-Regular",Consolas,monospace;cursor:pointer}}.controls input:focus-visible+span{{outline:3px solid var(--blue);outline-offset:2px}}.controls input:checked+span{{background:var(--ink);color:white;border-color:var(--ink)}}.experiment-wrap{{overflow:auto;background:var(--panel);border:1px solid var(--line)}}table{{border-collapse:collapse;width:100%;min-width:1020px;font-size:11px}}th,td{{padding:10px 11px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}}th{{position:sticky;top:50px;background:var(--ink);color:white}}td:nth-child(1),td:nth-child(5),td:nth-child(6){{white-space:nowrap}}.status{{display:inline-block;padding:3px 7px;border-radius:12px;background:#e5e3dc}}.status.kept{{background:var(--green-soft);color:var(--green)}}.status.degenerate{{background:var(--red-soft);color:var(--red)}}.controls:has(#show-kept:checked)+.experiment-wrap tr[data-status]:not([data-status="kept"]),.controls:has(#show-gates:checked)+.experiment-wrap tr[data-status]:not([data-status="degenerate"]){{display:none}}details{{background:var(--panel);border:1px solid var(--line);padding:14px 18px;margin-top:12px}}summary{{font-weight:bold;cursor:pointer}}.contract{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}pre{{margin:0;background:var(--ink);color:#f6f3eb;padding:18px;overflow:auto;font:12px/1.7 "SFMono-Regular",Consolas,monospace}}.audit{{font-size:11px;color:var(--muted);overflow-wrap:anywhere}}.fade{{animation:arrive .5s ease both}}@keyframes arrive{{from{{opacity:0;transform:translateY(8px)}}to{{opacity:1;transform:none}}}}@media(max-width:900px){{header,.verdict,.section-head,.decision-grid,.contract{{grid-template-columns:1fr}}.metrics{{grid-template-columns:1fr 1fr}}.metric{{border-bottom:1px solid var(--line)}}}}@media(prefers-reduced-motion:reduce){{html{{scroll-behavior:auto}}.fade{{animation:none}}}}
</style></head><body><main>
<header class="fade"><div><p class="eyebrow">Find the Bird · overnight optimization · 08 August 2026</p><h1>Keep the placement. Improve the review queue.</h1><p class="summary">Twenty-three leakage-safe experiments found one production-worthy change: a better redo-review ranker. The apparent placement win was rejected by eye because it regressed birds that were already right.</p></div><div class="stamp"><span>Frozen corpus</span><b>162 birds</b><span>9 fully reviewed levels<br>23 measured candidates<br>0 provider calls</span></div></header>

<div class="verdict fade"><div><p class="eyebrow">Ship</p><p><strong>Extra Trees for redo queue ordering.</strong> Held-out average precision rises from {baseline['redo_average_precision']:.3f} to {best['redo_average_precision']:.3f}. It is integrated into the CLI as a portable JSON ensemble.</p></div><div class="risk"><p class="eyebrow">Do not ship</p><p><strong>The depth-two placement booster.</strong> Its aggregate score was better; its individual decisions were not. The existing guarded logistic selector remains the recommendation.</p></div></div>
<div class="metrics fade"><div class="metric"><b>23</b><span>experiments</span></div><div class="metric"><b>{baseline['placement_balanced_loss']:.4f}</b><span>placement loss unchanged</span></div><div class="metric"><b>{best['redo_average_precision']:.4f}</b><span>redo average precision</span></div><div class="metric"><b>+{relative_gain:.1f}%</b><span>relative ranking gain</span></div><div class="metric"><b>0</b><span>identity safety failures</span></div></div>

<section><div class="section-head"><h2>The decision</h2><p>The objective combines conservative placement loss with redo ranking. The final objective improves from {baseline['objective_loss']:.6f} to {best['objective_loss']:.6f}; all retained improvement comes from ranking redo candidates better.</p></div><div class="decision-grid"><article class="decision"><p class="eyebrow">Retained frontier</p><h3>Logistic placement + Extra Trees redo</h3><p>Correction IoU {best['correction_iou']:.3f}; keep IoU {best['keep_iou']:.3f}; zero wrong-neighbor, duplicate-target, or target-identity failures. Redo AP {best['redo_average_precision']:.3f}.</p></article><article class="decision reject"><p class="eyebrow">Visually rejected</p><h3>Depth-two placement boosting</h3><p>Nominal objective 0.114163 and lower worst-level loss, but four already-approved keeps moved and two strong corrections were discarded. The model optimized the average and offended the birds individually.</p></article></div></section>

<section><div class="section-head"><h2>Why the metric winner lost</h2><p>Each row is current placement, logistic decision, boosted decision, and human target. Green aggregate metrics cannot excuse a visibly wrong pickup transition.</p></div><figure class="evidence"><img src="{images['decision']}" alt="Four-way placement comparison showing Cozy Library decisions"><figcaption>Cozy Library dog_09 is the decisive regression: logistic applies a substantially better fit; boosting abstains and preserves the offset current box. The same page shows dog_12 and dog_13, where boosting correctly avoids neighbor-like proposals. Mixed evidence is why aggregate scoring alone is inadequate.</figcaption></figure><figure class="evidence"><img src="{images['regressions']}" alt="Four-way comparison showing Desert Trading Post and Attic regressions"><figcaption>Desert Trading Post dog_04 loses a near-target logistic correction. Attic dog_07 and dog_16 begin exactly on their human targets, then the boosted selector moves them. Visual gate: fail.</figcaption></figure></section>

<section><div class="section-head"><h2>Known hard cases</h2><p>The three Toymaker birds named during review—dog_01, dog_02, and dog_09—remain keeps under both selectors. The new review also exposes the actual ceiling: some matcher proposals are themselves wrong, so a selector can only abstain, not invent a better transform.</p></div><figure class="evidence"><img src="{images['hard']}" alt="Toymaker hard-case comparisons"><figcaption>Toymaker dog_02 and dog_09 remain unchanged; dog_10 is a real correction the rejected booster found, but one recovered bird does not pay for the regressions elsewhere.</figcaption></figure><figure class="evidence"><img src="{images['ceiling']}" alt="Worst remaining placement cases"><figcaption>Adobe dog_03 and dog_05 plus Canyon dog_00 show poor candidate geometry. These belong in an outlier queue. The current corpus is not sufficient to learn a reliable automatic abstention rule without sacrificing known-good corrections.</figcaption></figure><div class="callout"><strong>Production constraint:</strong> “needs redo” remains review ordering only. At threshold 0.5 the new model's precision is {winner['precision']:.3f}, down from the logistic baseline's {baseline['redo_precision']:.3f}; it must not spend generation credits automatically.</div></section>

<section><div class="section-head"><h2>Experiment ledger</h2><p>The search stopped after eight consecutive non-winners. Gate failures are preserved because they explain why tempting raw scores were rejected.</p></div><div class="controls" aria-label="Experiment filters"><label><input id="show-all" type="radio" name="filter" checked><span>All 23</span></label><label><input id="show-kept" type="radio" name="filter"><span>Kept</span></label><label><input id="show-gates" type="radio" name="filter"><span>Gate failures</span></label></div><div class="experiment-wrap"><table><thead><tr><th>#</th><th>Category</th><th>Hypothesis</th><th>Outcome</th><th>Objective</th><th>Delta</th><th>Learning</th></tr></thead><tbody>{''.join(experiment_rows)}</tbody></table></div></section>

<section><div class="section-head"><h2>CLI contract</h2><p>The backend and CLI now report the same winner and serialize it without pickle state. The model is deliberately marked review-only in machine output.</p></div><div class="contract"><pre>uv run level-editor --json golden-cutouts-validate
uv run level-editor --json golden-cutouts-evaluate --out eval/results/golden-cutout-v1/redo-evaluation.json

# expected
winner: extra-trees-depth-4-balanced
predictionMode: review-ranking-only
averagePrecision: {winner['averagePrecision']:.6f}</pre><article class="decision"><p class="eyebrow">Verified</p><h3>Portable model parity</h3><p>The emitted <code>binary-tree-ensemble-v1</code> contains {len(redo['productionModel']['trees'])} deterministic trees. Unit tests compare its probabilities directly with scikit-learn predictions.</p><p>Manifest hash validation still protects every approved scene, sprite, target box, and review input before evaluation begins.</p></article></div></section>

<section><div class="section-head"><h2>Verification and limits</h2><p>This was a local deterministic optimization pass, not a content generation run.</p></div><details open><summary>Passed</summary><p>12 golden-dataset tests; Ruff; CLI end-to-end evaluation; 162 manifest approvals; whole-level outer splits; nested placement policy tuning; zero safety-identity failures; visual inspection of all changed selector decisions and named hard cases.</p></details><details><summary>Deliberately not done</summary><p>No cutouts, scenes, boxes, or labels were overwritten. No Gemini, OpenRouter, or GPU provider calls were made. No automatic regeneration decision was enabled. No phone build was necessary because the retained change is an editor/CLI review model and does not alter game runtime or assets.</p></details><details><summary>Next data that would matter</summary><p>Add more fully reviewed levels and explicit wrong-neighbor negatives. The placement problem is now data-limited: more model complexity repeatedly improved a summary number by learning the wrong lesson.</p></details></section>

<section><p class="audit">Audit: run {html.escape(log['run_id'])} · corpus 04eecb76c8257c1275c964a1ee05df148bd611d74129be33b8fc620afedc3079 · harness 0acf97c3158582c81814f0d2c5a5cdc48f39b28f8bade2a05a043d83fe71e2d4 · report revision {revision}</p></section>
</main></body></html>'''

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(document)
print(OUTPUT)
