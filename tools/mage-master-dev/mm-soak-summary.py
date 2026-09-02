"""Summarize a device soak log into Markdown. usage: mm-soak-summary.py OUTDIR"""
import json
import re
import sys
from pathlib import Path

out = Path(sys.argv[1])
lines = (out / "soak.log").read_text().splitlines()
rows = []
for line in lines:
    m = re.search(r"\+(\d+)s (\{.*\})$", line)
    if not m:
        continue
    try:
        rows.append((int(m.group(1)), json.loads(m.group(2))))
    except json.JSONDecodeError:
        continue

acts = [a for _, r in rows for a in r.get("acts", [])]
wins = sum(1 for a in acts if a == "win->next")
fails = sum(1 for a in acts if a.startswith("fail"))
uses = [a for a in acts if a.startswith("use:")]
discards = sum(1 for a in acts if a.startswith("discard"))
upgrades = sum(1 for a in acts if a == "upgrade")
skips = sum(1 for a in acts if a == "skip")
waits = sum(1 for a in acts if a == "ENERGY-WAIT")
last = rows[-1][1] if rows else {}
first = rows[0][1] if rows else {}
highest = max((r.get("highest", 0) for _, r in rows), default=0)
pulls = last.get("pulls", 0)
tier = last.get("tier", 0)
errors_file = out / "errors.log"
error_lines = [l for l in errors_file.read_text().splitlines() if l.strip() and l.strip() != '"errors":[]'] if errors_file.exists() else []
duration = rows[-1][0] if rows else 0

# level timeline: first time each highest value appeared
timeline = {}
for t, r in rows:
    h = r.get("highest", 0)
    if h and h not in timeline:
        timeline[h] = t

md = []
md.append(f"# Device soak — {duration // 60} min {duration % 60} s of continuous play on the iPhone\n")
md.append(f"Started {(out / 'started.txt').read_text().strip() if (out / 'started.txt').exists() else '?'}; {len(rows)} polls (one every ~5 s); battles ran in real time at 1×.\n")
md.append("| Metric | Value |")
md.append("| --- | --- |")
md.append(f"| Levels won | {wins} |")
md.append(f"| Levels lost | {fails} |")
md.append(f"| Highest level cleared | {highest} |")
md.append(f"| Rift pulls | {pulls} |")
md.append(f"| Items equipped / discarded | {len(uses)} / {discards} |")
md.append(f"| Rift upgrades / gem skips | {upgrades} / {skips} |")
md.append(f"| Rift tier at end | {tier} |")
md.append(f"| Energy waits (Play blocked) | {waits} |")
md.append(f"| Runtime errors logged on device | {len(error_lines)} |")
md.append(f"| End balances | gold {last.get('gold')}, crystals {last.get('crystals')}, gems {last.get('gems')}, energy {last.get('energy')} |")
md.append("")
md.append("## First clear timeline (seconds into the session)")
md.append("")
for h, t in sorted(timeline.items()):
    md.append(f"- Level {h}: {t // 60}m {t % 60:02d}s")
md.append("")
md.append("## Equips (rarity:slot)")
md.append("")
md.append(", ".join(a.split(':', 1)[1] for a in uses) or "none")
md.append("")
if error_lines:
    md.append("## Errors")
    md.extend(f"- {l}" for l in error_lines[:10])
(out / "SUMMARY.md").write_text("\n".join(md) + "\n")
print("\n".join(md))
