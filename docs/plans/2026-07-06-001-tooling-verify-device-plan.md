---
title: "tools/verify-device: ONE-COMMAND on-device capture + diff (forcing function for AGENTS.md #8)"
date: 2026-07-06
type: tooling
slug: verify-device
origin: docs/retros/fidelity-diff-mistakes-ledger.md  # no brainstorm doc — card description + ledger are the requirements source
trello: https://trello.com/c/Y59JXZhk
card: Y59JXZhk
stage: planned
status: as-built
note: >
  This card was routed through the reduced "planned" column AFTER the build had
  already landed (commits de927d7, eb55475, 2e8a770, 9ec037a on this branch).
  This document is therefore an AS-BUILT plan: it records the design that was
  actually implemented and verified, not a forward-looking proposal. It exists to
  satisfy the planned-column artifact gate honestly rather than fabricating a
  pre-implementation brainstorm/plan for work that is done.
---

# verify-device — plan (as-built)

## Problem

The recurring failure recorded in `docs/retros/fidelity-diff-mistakes-ledger.md`
(and now hard-coded into AGENTS.md #7/#8) is that on-device verification was
OPTIONAL + MULTI-STEP, so it got skipped for a proxy (a simulator render, a
passing unit test). Fix: make the correct check the path of least resistance —
ONE command that captures the real device and diffs it against a committed
reference set.

## Approach

Build `tools/verify-device` as an npm workspace exposing
`npm run verify-device -- --game <g>`, which runs, in order:

1. **Harness bundle build** (device-gated, conductor-run): `VITE_ENABLE_TEST_HARNESS=true
   VITE_INSITU_TOUR=allstates vite build` + `npx cap sync ios`.
2. **Build + install** (device/keychain/Mac-gated): `xcodebuild ... build` +
   `devicectl install`, keychain unlocked via `MAC_PASSWORD` from `.env`. Device
   serial is NEVER hardcoded — read from `xcrun devicectl list devices` (auto-pick
   single, skip on none, error on ambiguous) or a `--device` flag.
3. **Element-gated capture** (device-gated): the committed XCUITest runner
   template waits (≤25s) for the tour's `tourstate:<state>` accessibility marker,
   screenshots ONLY then, and `XCTFail`s loudly if a state never appears — a
   missing state is a LOUD failure, never a silent wrong-frame. Replaces the
   drift-prone fixed-`sleep(6)` cadence that caused the menu/level-as-settings
   mislabel.
4. **Diff + score**: device captures + committed reference set →
   `device | reference | pixel-diff` grid at `docs/evidence/<date>-device-verify/`.
   Primary verdict is a **multi-model vision panel** (src/panel.mjs) over an
   extensible, pluggable judge registry; phash is demoted to a secondary advisory
   signal. Panel score = median of per-model fidelity %, consensus = finding-key
   flagged by majority; FAIL below floor OR on a consensus blocker. Graceful
   per-judge degradation (skip on missing key / 401/402/403/429 / timeout / 404,
   record + continue); participated-vs-skipped judges reported explicitly.
5. **Verdict**: print the grid path + a one-line PASS/FAIL/UNVERIFIED verdict.

## Build / run split

- **Worker scope (unit-tested, no network/device in sandbox):** arg parsing,
  state-name canonicalisation, xcresult attachment extraction (manifest.json →
  per-state PNG, latest-timestamp-wins), device-list parsing, refcap-compare
  invocation + row assembly, verdict logic, grid assembly, panel aggregation /
  consensus / verdict (MOCKED model responses), graceful device-absent + no-key
  skip.
- **Conductor scope (live):** the actual on-device capture and live model calls.

## Reuse

Reuses `tools/refcap-compare`'s PNG codec + perceptual diff + the shared
`games/<g>/refs/manifest.yaml` reference set (the substantive reuse). Does NOT
bend refcap's reference|v2-specific grid module — a purpose-built
device|reference|diff grid is written instead.

## Committed template

The XCUITest runner lives at `tools/verify-device/runner/` (project.yml +
VerifyDeviceRunner/InsituTourTests.swift + README), generalising the ad-hoc
`games/marble_run/.work/insitu-runner`. Bundle id is injected via
`TEST_RUNNER_TARGET_BUNDLE_ID` so every game inherits ONE file, not a
`.work` throwaway.

## Verification

`npm run test:unit --workspace=tools/verify-device` — 63 tests / 8 files (args,
states, attachments, devices, compare over the real committed manifest, verdict,
grid escaping, panel aggregation). Device path + live model calls are
conductor-run and remain UNVERIFIED in the worker sandbox by design.

## Out of scope / known follow-ups

- `marble_run` has no `ios/` dir yet — `npx cap add ios` must run before step 2
  or it errors with a clear message (conductor).
- Thresholds start advisory (pixel 0.20, panel fidelity floor 85; exit stays 0
  without `--strict`) — tune against real device diffs.
- Confirm WKWebView surfaces the `#__tourstate__` aria-label as an
  XCUITest-matchable element on the installed Xcode/iOS; confirm default
  OpenRouter model slugs still resolve.

## AGENTS.md tie

`docs/AGENT-HANDOFF.md §4` names this THE required close-out for any
on-device/UI change (AGENTS.md #8): element-gated capture + panel-scored diff,
not eyeballed.
