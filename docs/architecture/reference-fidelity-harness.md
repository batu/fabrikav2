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

## Step-back: fit with the overall fabrika flow (2026-07-06, Batu-prompted)

The harness is not a testing add-on; it becomes the verification spine of every
stage of the studio loop:

- **Birth**: template ships harness.ts → every game is born instrumented; the
  refs/manifest state list can be SEEDED from game.config.ts screens (one
  source of truth for "what states exist").
- **Design round-trip (synthesis 1)**: DS11 shipped page cards as
  structural-only because "v2 has no screen-capture pipeline" — capture()
  IS that pipeline. Follow-up: the fabrikav2 ingester embeds harness captures
  into sheet page cards, so designers in claude.ai/design see real screens.
- **Board pipeline (synthesis 2)**: tested_insitu / aesthetics_reviewed /
  evidence_captured stages standardize on collectRun() artifacts instead of
  ad-hoc proof — card checklists can demand a run dir. Process-doc change,
  not code.
- **Monetization QA (synthesis 3)**: drainEvents() + the owned-mirror dev
  environment give client- and server-side views of the same events — SDK
  wiring becomes assertable end-to-end without store builds.
- **Later ports**: FTD's 140-line bespoke TestHarness (research 07 R71)
  collapses into contract + verbs. Store-listing screenshots and demo reels
  consume capture() instead of v1's .work/appstore-shots chaos.

Forced changes (conventions, priced in):
1. ui components maintain stable data-fab-* hooks (H1 adds the audit check).
2. Game cards' AC must include harness coverage of any new surface — a feature
   without verbs/states is untestable by construction. → card-writing checklist.
3. Games route randomness through kernel rand (seeded) so chaos runs reproduce.
   marble_run already does; template must say it.
4. OPEN (Batu, not urgent): does chaos/e2e join the CI matrix (browser cost)
   or stay conductor-run per landing? Advise: conductor-run until flake rate
   is known.

## End-of-process review (standing commitment)

When the drill + harness package land, a full process review synthesizes:
night-run friction ledger (F1-F15+), agency improvement ideas (19+), the
harness evaluation doc, and twf ledger metrics — output: prioritized updates
to AGENTS.md / twf / skills / card templates. Carded on the board.
