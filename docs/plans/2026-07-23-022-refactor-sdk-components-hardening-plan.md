---
title: "refactor: SDK components hardening (post-integration improvement pass)"
type: refactor
status: active
date: 2026-07-23
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-07-23-021-feat-marble-run-sdk-components-plan.md
---

# refactor: SDK Components Hardening

## Summary

Follow-up card to the four-SDK integration (plan 021). Inputs: Sol's (Codex
`gpt-5.6-sol`) 10-finding review of the working diff + the implementing agent's
retro + live-device observations. Fixes the one real product gap (Facebook gets
no gameplay events), hardens idempotency seams, de-duplicates the two-game
copies, and cleans small defects. Sol findings re-graded where device evidence
contradicts them (noted per unit).

## Problem Frame

The integration landed correct-by-construction and device-verified, but: Meta
initializes yet never receives production events (auto-log defaults off — so FB
campaigns would get install signal only); two idempotency bugs in the Android
apply tool would bite on the next SDK addition; ~1.5k lines of native + JS
composition code are duplicated between marble_run and shell_template and will
drift; and several small defects (double DOM removal, init-before-guard order,
Android pane firebase row overstating) reduce trust in the verifier surface.

## Requirements

- R1: Facebook receives the canonical gameplay events in production builds (as
  an analytics-style sink or explicit forwarding), config-gated like all sinks.
- R2: `tools/marble-run/android-apply-sdks.mjs` is per-item idempotent (each
  gradle dep and each MainActivity registration checked/injected independently).
- R3: Shared JS composition: hoist the common SdkContext builder and verifier
  entry construction so each game supplies only a config object (game id,
  lifecycle hooks, attribution provider name), not a copy.
- R4: Shared native recipe sources: the three SDK plugin Swift files live in one
  canonical location consumed by both games' recipes; only BridgeViewControllers
  stay per-game. (tools/native-shell copyRecipeApp learns a sharedSources path,
  or a sync step copies from a canonical dir with byte-equality validation.)
- R5: Partial-unit guards in `AppLovinMaxProvider` run before `init()` (no
  native init just to reject an unconfigured format) with a test pinning it.
- R6: Verifier pane truthfulness: the firebase row reflects native plugin
  availability, not just the JS env gate (probe `Capacitor.isPluginAvailable`
  or equivalent), fixing the Android "sink attached" overstatement.
- R7: Remove the double DOM removal in `toggleSdkVerifierPane` (keep
  `mounted.remove()` only).
- R8: shell_template decision recorded and implemented: EITHER strip the four
  SDK SPM packages from its manifest (template ships minimal; packages join via
  the manifest when a cloned game gets credentials — preferred) OR keep them
  linked and document why. Same decision for its missing Android sync scripts +
  Java bridges (currently intentional: config-less natives are never called;
  make that intent a written note or close the gap).
- R9: verify-device Android lane made trustworthy on this host: keep the
  ENOBUFS maxBuffer fix (already applied to `tools/verify-device/src/command.mjs`),
  then root-cause the allstates tour not publishing menu/level states on the
  Pixel and the settings capture rendering over black without RESET PROGRESS
  (reference mismatch). Determine whether tour timing, lane maturity, or the
  SDK-boot changes are responsible; fix or re-baseline references accordingly.

### Scope Boundaries

Out of scope: new SDK features, iOS device signing (needs Batu's Xcode
account), rewarded-interstitial support (publisher decision pending), find_the_dog
adoption of the shared composition root (candidate follow-up after R3 proves out).

### Deferred to Follow-Up Work

- find_the_dog migration onto the hoisted SdkContext builder.
- Banner support (no banner unit id exists; the Java banner sizing hack in
  `AppLovinMaxPlugin.java` gets rewritten when banners become real — note left).

---

## Sol Findings Traceability

| Sol # | Grade after verification | Landed in |
|---|---|---|
| 1 (P1 shell_template Android missing) | Downgraded: Android shell EXISTS, gradle-built and booted on the Pixel; missing piece is sync scripts + a written natives-decision | R8 |
| 2 (P1 MainActivity registration skip) | Confirmed | R2 |
| 3 (P1 Meta gets no gameplay events) | Confirmed — top product gap | R1 |
| 4 (P2 init-before-guard) | Confirmed, impact low (init happens at boot anyway) | R5 |
| 5 (P2 template links all SDK SPM packages) | Confirmed (KTD5 intent was never implemented for SPM) | R8 |
| 6 (P2 single gradle marker) | Confirmed | R2 |
| 7 (P2 native source duplication ~1.5k lines) | Confirmed | R4 |
| 8 (P2 SdkContext duplication) | Confirmed (matches retro) | R3 |
| 9 (P2 verifier mount duplication) | Confirmed (matches retro) | R3 |
| 10 (P3 double DOM removal) | Confirmed | R7 |

Agent-retro additions Sol missed: R6 (pane firebase truthfulness — observed on
device), R9 (verify-device lane ENOBUFS + tour mismatch — observed on host).

---

## Implementation Units

### U1. Meta gameplay-events sink

**Goal:** production FB app events. **Requirements:** R1. **Dependencies:** none.
**Files:** `packages/sdk/src/meta/metaSink.ts` (+`.test.ts`) — an `AnalyticsSink`
adapter over `MetaProvider.logEvent` with an event allowlist; wire in both
games' SdkContext (or the hoisted builder from U3 if landed first);
`packages/sdk/README.md`.
**Test scenarios:** sink forwards allowlisted canonical events with coerced
params; non-allowlisted events dropped; disabled meta provider → sink no-ops
without error; sink attaches only when meta config enabled.
**Verification:** unit green; device logcat shows `graph.facebook.com` activity
carrying a gameplay event after playing a level.

### U2. android-apply-sdks per-item idempotency

**Goal:** each dep/import/registration checked independently. **Requirements:** R2.
**Files:** `tools/marble-run/android-apply-sdks.mjs` + new unit test
(`tools/marble-run/android-apply-sdks.test.mjs` following repo test conventions).
**Test scenarios:** partially-applied gradle (one of three deps) gains the
missing two; MainActivity with AppLovin registered gains AppsFlyer+Meta;
fully-applied files are byte-stable (no-op).
**Verification:** tests green; re-run on the generated project is a no-op.

### U3. Hoist shared composition (SdkContext builder + verifier entries)

**Goal:** one implementation, two thin per-game configs. **Requirements:** R3.
**Dependencies:** U1 (sink wiring lands once, in the shared builder).
**Files:** new `packages/sdk/src/context/` (builder + tests) and
`packages/testkit/src/debug/sdkVerifierEntries.ts` (+ test); shrink both games'
`src/sdk/SdkContext.ts` and `src/devtools/SdkVerifierMount.ts` to config +
re-export; delete the duplicated admob shim by moving it to a shared path both
vite configs alias.
**Approach:** builder takes `{ gameId, lifecycle, analytics hooks, env }`;
behavior identical — pin with the existing sdk-context tests running against
both games' configs.
**Test scenarios:** existing sdk-context + verifier-mount tests pass unchanged
against the hoisted implementation; both games' bundles typecheck; empty-env
degradation unchanged.
**Verification:** both games `typecheck`+`test:unit` green; knip shows no dead
copies left.

### U4. Canonical native plugin sources

**Goal:** single source of truth for the three SDK Swift plugins (and the
Android Java trio when shell_template ever ships natives). **Requirements:** R4.
**Files:** new `tools/native-shell` support (manifest `sharedSources` +
canonical dir, e.g. `tools/native-shell/recipes/sdk-plugins/`), update both
games' manifests, delete duplicated copies; extend
`tools/native-shell/test/native-shell.test.mjs`.
**Execution note:** kit blast radius — find_the_dog manifest untouched; its
validate must stay green.
**Test scenarios:** validate fails when a shared source drifts from canonical;
apply copies shared sources; ftd validate unchanged.
**Verification:** all three games' `validate.mjs` green; marble_run iOS
simulator build still succeeds.

### U5. Small defects sweep

**Goal:** R5 + R6 + R7 in one pass. **Requirements:** R5, R6, R7.
**Files:** `packages/sdk/src/ads/AppLovinMaxProvider.ts` (+ test: unconfigured
format never triggers native init), `games/*/src/devtools/SdkVerifierMount.ts`
(or hoisted equivalent): firebase row probes native plugin availability; drop
`removeSdkVerifierPane` double-removal; `packages/testkit` test updates.
**Test scenarios:** show/preload on '' unit id resolves safe value with zero
plugin calls including initialize; firebase row shows 'native plugin absent'
when JS gate passes but plugin unavailable; toggle mount/unmount single-removal.
**Verification:** package + game suites green; Android device pane shows honest
firebase state.

### U6. shell_template minimal-native decision

**Goal:** R8 implemented as the preferred strip. **Requirements:** R8.
**Files:** `games/shell_template/native-resources/ios/shell-manifest.json`
(remove AppLovin/AppsFlyer/Facebook/Firebase packages + plugin sources; keep
the BridgeViewController registering nothing), matching bridge edit; note in
`games/shell_template/docs/` recording the clone-time recipe (copy manifest
entries from marble_run when a real game gets credentials); package.json gains
`android:add`/`android:sync` mirroring marble_run minus the SDK apply step.
**Test scenarios:** shell_template iOS simulator build green with stripped
manifest; validate green; boot shows all SDKs not-configured (unchanged JS).
**Verification:** builds + a device boot capture matching the existing
placeholder evidence.

### U7. verify-device Android lane trust

**Goal:** R9 — a green (or honestly re-baselined) verify-device Android run for
marble_run on this host. **Requirements:** R9. **Dependencies:** none.
**Files:** `tools/verify-device/src/command.mjs` (maxBuffer fix — already in
working tree, keep), possibly `games/marble_run/src/testing/*` tour timing or
`games/marble_run/refs/captures/android-basegamelab/*` re-baseline.
**Approach:** ROOT CAUSE FOUND during plan-writing: the AppLovin SDK shows a
blocking "Missing Privacy Policy URL" debug dialog when the consent flow is
enabled without `VITE_PRIVACY_POLICY_URL`, overlaying every tour capture
(median 27.5%, settings==pause==win indistinguishable). Fixes already in the
working tree: legal URLs added to marble_run `.env`/.env.example (from the
publisher sheet) and a fail-safe in `AppLovinMaxPlugin.java` (missing privacy
URL disables the consent flow instead of enabling it broken). Remaining: apply
the same fail-safe to the shared iOS `AppLovinMaxPlugin.swift` recipe source,
confirm a clean verify-device Android run, and decide whether residual score
deltas justify re-baselining the android references (Linux-host-authored).
**Test expectation:** none — this unit is diagnosis + evidence.
**Verification:** fresh `panel.json`/`grid.html` under `docs/evidence/` with a
written attribution of the earlier failure.

---

## Risks & Dependencies

- U4 touches the shared native-shell tool again — ftd validate is the canary.
- U3 ordering: land after U1 so sink wiring is written once.
- U7 may end in "re-baseline references", which needs human sign-off on the new
  goldens (visual approval is Batu's).

## Definition of Done

All units green on `typecheck`/`test:unit`/tool tests; both games build on iOS
sim + Android; device evidence for U1 (FB gameplay event in logcat), U5 (honest
pane), U6 (placeholder boot), U7 (fresh verify-device artifacts + attribution
note); no new duplication (knip clean); ftd untouched and green.
