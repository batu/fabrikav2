from __future__ import annotations

import base64
import html
import io
import json
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
SERVER = "http://127.0.0.1:5293"


def get_json(path: str) -> dict:
    with urllib.request.urlopen(SERVER + path, timeout=30) as response:
        return json.load(response)


def get_bytes(path: str) -> bytes:
    with urllib.request.urlopen(SERVER + path, timeout=30) as response:
        return response.read()


def candidates(session_id: str) -> dict[int, dict]:
    sid = urllib.parse.quote(session_id, safe="")
    payload = get_json(f"/api/sessions/{sid}/sprite-candidates")
    return {int(item["dogIndex"]): item for item in payload["candidates"]}


def overlay(session_id: str, candidate_id: str) -> str:
    sid = urllib.parse.quote(session_id, safe="")
    cid = urllib.parse.quote(candidate_id, safe="")
    payload = get_bytes(f"/api/sessions/{sid}/sprite-candidates/{cid}/overlay")
    image = Image.open(io.BytesIO(payload)).convert("RGB")
    image.thumbnail((520, 520), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, "WEBP", quality=76, method=6)
    return "data:image/webp;base64," + base64.b64encode(output.getvalue()).decode()


def main() -> None:
    data = json.loads((HERE / "results.json").read_text())
    sections = []
    missing = []
    for level_no, level in enumerate(data["levels"], 1):
        two = candidates(level["two"])
        three = candidates(level["three"])
        cards = []
        for dog in range(level["birds"]):
            a, b = two.get(dog), three.get(dog)
            if not a or not b:
                missing.append(f'{level["source"]}:dog_{dog:02d}')
                continue
            vote_key = f'{level["source"]}:dog_{dog:02d}'
            cards.append(
                '<article class="bird" data-vote-key="%s"><h4>dog_%02d</h4><div class="pair">'
                '<button type="button" class="option" data-choice="2x2" aria-pressed="false">'
                '<img loading="lazy" src="%s" alt="2 by 2 cutout overlay"><span>2×2</span></button>'
                '<button type="button" class="option" data-choice="3x3" aria-pressed="false">'
                '<img loading="lazy" src="%s" alt="3 by 3 cutout overlay"><span>3×3</span></button>'
                '</div></article>' % (html.escape(vote_key), dog, overlay(level["two"], a["id"]), overlay(level["three"], b["id"]))
            )
        sections.append(
            '<section class="level"><header><div><span>Level %d of 6 · %d birds</span><h2>%s</h2></div>'
            '<code>%s</code></header><div class="birds">%s</div></section>'
            % (level_no, level["birds"], html.escape(level["label"]), html.escape(level["source"]), "".join(cards))
        )
    two, three = data["methods"]["2x2"], data["methods"]["3x3"]
    cheaper = 100 * (two["usd"] - three["usd"]) / two["usd"]
    faster = 100 * (two["wallSeconds"] - three["wallSeconds"]) / two["wallSeconds"]
    document = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>2×2 vs 3×3 · controlled cutout comparison</title><style>
:root{--paper:#eeeddf;--ink:#161811;--muted:#606654;--green:#00a966;--line:#adb29c;--panel:#faf8eb}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 Georgia,serif}main{max-width:1540px;margin:auto;padding:42px 28px 140px}.kicker,.level span{font:700 12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em;color:var(--green)}h1{font-size:clamp(42px,7vw,86px);line-height:.94;letter-spacing:-.05em;max-width:1100px;margin:18px 0}.lede{font-size:20px;color:var(--muted);max-width:920px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin:34px 0}.stat{background:var(--panel);padding:18px}.stat b,.stat span{display:block}.stat b{font:700 30px ui-monospace,monospace}.stat span{color:var(--muted);font:12px ui-monospace,monospace}.rule{border-left:5px solid var(--green);background:var(--panel);padding:16px 20px;max-width:1000px}.tally{position:sticky;bottom:12px;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;margin:24px auto 0;padding:12px 16px;max-width:760px;background:var(--ink);color:var(--paper);box-shadow:0 8px 28px #0004;font:700 13px ui-monospace,monospace}.tally strong{color:#54e2a8}.level{margin-top:72px}.level>header{display:flex;justify-content:space-between;align-items:end;gap:24px;border-bottom:3px solid var(--ink);padding-bottom:14px;margin-bottom:16px}.level h2{font-size:34px;margin:5px 0 0}.level code{font-size:11px;color:var(--muted);overflow-wrap:anywhere}.birds{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.bird{background:var(--panel);border:1px solid var(--line);padding:8px}.bird h4{font:700 12px ui-monospace,monospace;margin:1px 0 7px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:5px}.option{position:relative;display:block;min-width:0;padding:0;border:3px solid transparent;background:#111;color:var(--paper);cursor:pointer;font:700 12px ui-monospace,monospace;transition:border-color .12s ease,transform .12s ease}.option:hover{transform:translateY(-2px);border-color:var(--line)}.option:focus-visible{outline:4px solid #111;outline-offset:2px}.option[aria-pressed="true"]{border-color:var(--green)}.option[aria-pressed="true"]:after{content:"✓";position:absolute;right:8px;top:8px;display:grid;place-items:center;width:28px;height:28px;border-radius:50%%;background:var(--green);color:#07140d;font-size:18px}.option img{display:block;width:100%%;aspect-ratio:1;object-fit:contain}.option span{display:block;padding:8px;color:#54e2a8}.final{margin-top:80px;padding:28px;background:var(--ink);color:var(--paper)}.final h2{font-size:38px;margin:0 0 18px}.final-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#ffffff44}.final-grid div{padding:20px;background:var(--ink)}.final-grid b{display:block;font:700 40px ui-monospace,monospace;color:#54e2a8}.final-grid span{font:12px ui-monospace,monospace}.submit{margin-top:24px;padding:14px 20px;border:0;background:var(--green);color:#07140d;cursor:pointer;font:700 14px ui-monospace,monospace}.submit:disabled{opacity:.55;cursor:wait}.submit-status{margin-left:12px;font:12px ui-monospace,monospace;color:#54e2a8}@media(max-width:900px){.stats{grid-template-columns:1fr 1fr}.birds{grid-template-columns:1fr 1fr}.level>header{display:block}}@media(max-width:560px){main{padding:24px 12px 130px}.stats,.birds{grid-template-columns:1fr}.tally{left:8px;right:8px}.final-grid{grid-template-columns:1fr}}
</style></head><body><main><div class="kicker">Find the Bird · controlled A/B · Gemini Flash · 10 August 2026</div><h1>Same birds. Same fit. Only the grid changes.</h1>
<p class="lede">Six human-reviewed scenes, 112 painted birds, and 224 fresh cutouts. Every pair uses the same source crop, prompt, model, padding, and best-safe automatic placement.</p>
<section class="stats"><div class="stat"><b>112 × 2</b><span>paired cutouts</span></div><div class="stat"><b>$%.4f / $%.4f</b><span>2×2 / 3×3 metered spend</span></div><div class="stat"><b>%d / %d</b><span>2×2 / 3×3 Gemini calls</span></div><div class="stat"><b>%.1f%% cheaper</b><span>3×3 in this run · %.1f%% less wall time</span></div></section>
<p class="rule"><b>Click only when one is better.</b> Choose 2×2 or 3×3. Leave the pair untouched when they are equivalent. Click your selected side again to clear it.</p>
<aside class="tally" aria-live="polite"><span><strong id="chosen">0</strong> selected</span><span>2×2 <strong id="two-count">0</strong></span><span>3×3 <strong id="three-count">0</strong></span><span>Equivalent <strong id="equal-count">112</strong></span></aside>%s
<section class="final" id="results"><h2>Current result</h2><div class="final-grid"><div><b id="final-two">0</b><span>2×2 wins</span></div><div><b id="final-three">0</b><span>3×3 wins</span></div><div><b id="final-equal">112</b><span>Equivalent / untouched</span></div></div><button type="button" class="submit" id="submit-results">Submit results to Portal</button><span class="submit-status" id="submit-status" role="status"></span></section>
<footer><p>Missing pairs: %d. Spend is from <code>~/.merceka/costs.jsonl</code>, filtered to this run and exact model. Time is the observed end-to-end upper bound, including extraction and automatic placement.</p></footer></main>
<script>
(()=>{const storageKey='ftb-grid-votes-v1';const cards=[...document.querySelectorAll('[data-vote-key]')];let votes={};try{votes=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}const counts=()=>{let two=0,three=0;for(const value of Object.values(votes)){if(value==='2x2')two++;if(value==='3x3')three++}return{two,three,equivalent:cards.length-two-three}};const update=()=>{for(const card of cards){const choice=votes[card.dataset.voteKey];for(const button of card.querySelectorAll('.option'))button.setAttribute('aria-pressed',String(button.dataset.choice===choice))}const c=counts();document.querySelector('#chosen').textContent=c.two+c.three;document.querySelector('#two-count').textContent=c.two;document.querySelector('#three-count').textContent=c.three;document.querySelector('#equal-count').textContent=c.equivalent;document.querySelector('#final-two').textContent=c.two;document.querySelector('#final-three').textContent=c.three;document.querySelector('#final-equal').textContent=c.equivalent;try{localStorage.setItem(storageKey,JSON.stringify(votes))}catch{}};for(const button of document.querySelectorAll('.option'))button.addEventListener('click',()=>{const key=button.closest('[data-vote-key]').dataset.voteKey;votes[key]=votes[key]===button.dataset.choice?undefined:button.dataset.choice;if(!votes[key])delete votes[key];update()});document.querySelector('#submit-results').addEventListener('click',async event=>{const button=event.currentTarget;const status=document.querySelector('#submit-status');const match=location.pathname.match(/^\/(?:view|media)\/([^/]+)\//);if(!match){status.textContent='Portal view required to submit';return}button.disabled=true;status.textContent='Submitting…';try{const response=await fetch('/r/'+match[1]+'/decide',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({payload:{schemaVersion:1,votes,counts:counts(),total:cards.length}})});if(!response.ok){const error=await response.json();throw new Error(typeof error.detail==='string'?error.detail:'Submission failed')}status.textContent='Submitted';button.textContent='Results submitted'}catch(error){status.textContent=error.message;button.disabled=false}});update()})();
</script></body></html>''' % (two["usd"], three["usd"], two["calls"], three["calls"], cheaper, faster, "".join(sections), len(missing))
    (HERE / "report.html").write_text(document)
    print(json.dumps({"report": str(HERE / "report.html"), "pairs": data["sourceBirds"], "missing": missing}))


if __name__ == "__main__":
    main()
