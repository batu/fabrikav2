# Reference-fidelity harness (design, locked with Batu 2026-07-06)

Purpose: make "implement/clone game X off reference Y" a checkable pipeline, not
taste. First consumer: marble_run fidelity card (6QcUojYp); first full task:
v1 marble run (Android) → v2 implementation on iOS. Dovetails with
docs/retros/insitu-testing-capability-notes.md (the works/doesn't ledger).

## Decisions (Batu, 2026-07-06)

- **Reference source**: the real Android build, on the device connected via adb
  to **ubuntu-server** (remote capture lane over ssh). Web dev-server capture
  stays as the fast local lane where a web build of the reference exists.
  STATUS: no ssh config/keys for ubuntu-server on this Mac yet — Batu provides
  host/user/auth (NEEDS-YOU, asked 2026-07-06).
- **Strictness**: style-faithful — layout, palette, chrome character are
  must-match axes; v2 component internals may modernize where feel is preserved.
  Manifest can tighten specific states to pixel or loosen to free.
- **Visual judge**: Gemini **via merceka-core** (`merceka_core.llm.LLM`) —
  verified importable under uv; GOOGLE_API_KEY present in appletolye/.env.
  Judge CLI shells `uv run` into merceka-core.
- **Judge role**: ADVISE first (findings triaged by conductor) for the first
  2-3 games; must-match axes become hard aesthetics-stage gates once the
  false-positive rate is trusted.

## Components

1. **refs/manifest.yaml** (per game): canonical states (menu, saga, level-start,
   mid-play, win, fail, pause, settings, shop), each with: reach-recipe
   (harness call sequence or device input script), viewports, and per-axis
   strictness (must-match / style-match / free) over: layout geometry, palette,
   chrome style, typography, motion. The manifest IS the "correct reference"
   contract a clone card ships with.
2. **tools/refcap**: symmetric capture. Lanes:
   - web: playwright vs a dev server (v1 read-only or v2), harness-driven —
     today's proven path.
   - android-remote: ssh ubuntu-server → adb shell input/screencap for the
     device build (reach-recipes as input scripts; screencap PNGs pulled back).
   - ios-sim: xcodebuildmcp screenshot lane (device screenshots remain a gap —
     see capability ledger item 1).
   Captures are hash-versioned, immutable; re-capture = explicit promotion.
3. **tools/fidelity-judge**: tiered evaluation per state pair:
   - Tier 0: pixel/SSIM diff (regression + gross drift), pure code.
   - Tier 1: structural — DOM/text inventory (controls present, none invented,
     copy keys resolved) + real-click interaction test per control.
   - Tier 2: Gemini judge (merceka-core) on ref+candidate pair + axes →
     structured JSON {axis, score, deltas[], severity}; dual-judge
     (Gemini+Claude) on must-match states, agree-or-escalate.
4. **Loop discipline** = iterative-visual-review skill: task pack from failed
   axes, one visible problem per iteration, recapture, re-judge, append-only
   journal; artifacts promote to evidence/.
5. **Homes**: testkit (harness state-drive contract), tools/refcap +
   tools/fidelity-judge (CLIs), a game-fidelity-review skill for workers,
   manifest template in games/_template/refs/.

## Why this exists (the port's lesson)

The marble_run port shipped an invented Levels menu, wrong board camera, and
non-reference chrome because the card had no reference contract — and the e2e
harness masked a dead-buttons bug by driving state directly. Manifest axes +
tier-1 structural checks + real-click tests make those four failures
mechanically detectable.

## Build order (cards to write when Batu green-lights)

1. tools/refcap web lane + manifest schema + marble_run manifest (extracted
   from today's captures + FINDINGS.md).
2. tools/fidelity-judge tier 0+1 (+ real-click harness rule in testkit).
3. Tier 2 Gemini judge via merceka-core (advise mode).
4. android-remote lane (blocked on ubuntu-server ssh access).
5. Retrofit: fidelity card 6QcUojYp re-verified through the harness as its
   acceptance (dogfood).
