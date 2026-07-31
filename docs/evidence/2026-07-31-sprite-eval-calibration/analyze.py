"""Agreement analysis: each backend vs the gold labels (plan U4).

Binary rule: subject < 0.5 => defect (blocker-class). Reports agreement,
false-negative/positive counts vs gold, score MAE, and wall time.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
GOLD = "gold-sol"
BACKENDS = ["ollama", "codex", "openrouter-flash", "luna"]
DEFECT = 0.5


def load(tag: str) -> dict:
    path = HERE / f"results_{tag}.json"
    if not path.exists():
        return {}
    return {k: v for k, v in json.loads(path.read_text()).items() if v.get("ok")}


def main() -> None:
    gold = load(GOLD)
    print(f"gold: {len(gold)} labeled, defects={sum(1 for v in gold.values() if v['subject'] < DEFECT)}")
    rows = []
    for tag in BACKENDS:
        results = load(tag)
        shared = sorted(set(gold) & set(results))
        if not shared:
            rows.append((tag, len(results), "-", "-", "-", "-", "-"))
            continue
        agree = fn = fp = 0
        mae = 0.0
        seconds = []
        disagreements = []
        for key in shared:
            g, r = gold[key], results[key]
            g_bad, r_bad = g["subject"] < DEFECT, r["subject"] < DEFECT
            if g_bad == r_bad:
                agree += 1
            elif g_bad:
                fn += 1
                disagreements.append((key, "miss", g["subject"], r["subject"]))
            else:
                fp += 1
                disagreements.append((key, "false-alarm", g["subject"], r["subject"]))
            mae += abs(g["subject"] - r["subject"])
            seconds.append(r.get("seconds", 0))
        n = len(shared)
        rows.append((
            tag, n, f"{agree / n:.0%}", fn, fp, f"{mae / n:.3f}",
            f"{sum(seconds) / n:.1f}s",
        ))
        for key, kind, gs, rs in disagreements:
            print(f"  [{tag}] {kind}: {key} gold={gs} backend={rs}")
    print(f"\n{'backend':18} {'n':>3} {'agree':>6} {'FN':>3} {'FP':>3} {'MAE':>6} {'s/case':>7}")
    for row in rows:
        print(f"{row[0]:18} {row[1]:>3} {row[2]:>6} {row[3]:>3} {row[4]:>3} {row[5]:>6} {row[6]:>7}")


if __name__ == "__main__":
    main()
