# Zoom sharpness fast-tier evaluator

Run `node tools/zoom-sharpness/eval.mjs --smoke --out /tmp/zoom-smoke` for a two-level smoke run, or `node tools/zoom-sharpness/eval.mjs` to refresh the fixed 15-level baseline.

The command builds Find the Dog in the optimized, explicitly gated `zoom-eval` mode, drives the real Phaser canvas with headless Chromium, and emits deterministic JSON plus an HTML candidate/reference grid. The baseline is a desktop Chromium fast-tier fitness signal, not physical-device verification.

The fixed inputs are a 390×844 viewport at DPR 1, max zoom 2.5, seed `0x5a17c0de`, three poses per level, and separate max-zoom/zoom-1 aggregates. Source references come from each level's `color.png`; candidate crops come from the actual game canvas at the same pose.
