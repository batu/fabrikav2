"""Threshold sweep for the local-diff runner (calls run_local_diff.main via CLI args)."""
import subprocess
import sys

for t, a in [(100, 1500), (150, 1500), (200, 1500), (150, 4000), (200, 4000)]:
    out = f"eval/results/local-diff-t{t}-a{a}/candidates"
    print(f"=== t={t} a={a} -> {out}", flush=True)
    subprocess.run([sys.executable, "eval/runners/run_local_diff.py", out,
                    "--threshold", str(t), "--min-area", str(a)], check=True)
