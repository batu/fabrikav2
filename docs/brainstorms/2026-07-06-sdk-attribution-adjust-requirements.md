---
title: "packages/sdk — attribution (Adjust): wire v1's dead core module (requirements)"
date: 2026-07-06
trello: https://trello.com/c/d44nVkm2
card: d44nVkm2
depends_on: Fw1NtsCr
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika
---

# packages/sdk: attribution — Adjust — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. **No code is
written at this stage.** This doc front-loads what the `planned`/`worked` stages need: an
evidence-mapped port plan of v1's TWO parallel attribution copies, the one behavioral change
the card mandates (env defaults to **sandbox**), and the scaffolding gaps the acceptance
command depends on.

The card is a **port + finish-the-migration**, not net-new. Research `06` §2 named this the
"clearest fork" in v1: `packages/core/src/attribution/` (1,214 lines **with tests**, freshly
extracted 2026-07-02, **zero consumers** — dead) sits parallel to
`games/find_the_dog/src/attribution/` (493 lines, **the actually-running one**, wired into
FTD bootstrap/HUD/scenes). Research `06`'s recommendation: *"either delete the core copy or
actually cut FTD over to it — don't carry two copies into v2."* This card does the latter for
v2: **take core's copy as the base** (it has tests + retryable-timeout + privacy-flag
correctness FTD lacks), fold in the FTD behaviors the diff shows core lacks, and land it under
`@fabrikav2/sdk/attribution`.

## Goal

Stand up one `@fabrikav2/sdk` subpath:

- `./attribution` — v1 **core**'s attribution module carried as the base (7 non-test files +
  3 test files), with:
  - the existing **provider seam preserved** (`AttributionProvider` interface + `Adjust` and
    `Disabled` implementations — already present in v1, this is not net-new);
  - **env defaults to `sandbox`** (the one deliberate behavioral change — see §"The one
    behavioral change" below; today *neither* v1 copy defaults to sandbox);
  - the `../runtime/with-timeout` dependency **vendored into the SDK** (it does not exist
    anywhere in v2 yet, and the card confines edits to `packages/sdk/**`);
  - core's ported vitest suite green under the sdk package.

Acceptance: typed provider seam compiles; ported tests green; env defaults to sandbox;
`npm run typecheck --workspace=packages/sdk && npm run test:unit --workspace=packages/sdk`.

## Constraints (inherited, non-negotiable)

- **v1 is READ-ONLY.** Read from `/Users/base/dev/appletolye/fabrika`; never edit it.
- **Files touched: `packages/sdk/**` (attribution/ subtree only)**, with two unavoidable
  exceptions inside the same package: the `package.json` `exports` map (add `./attribution`)
  and the shared `src/haptics/capacitor-shims.d.ts` ambient shim (add `registerPlugin` — see
  scaffolding gap #3). Both are flagged below; nothing outside `packages/sdk/` is touched.
- **No secrets.** Adjust app tokens/event tokens are read from `import.meta.env` at runtime
  (`VITE_ADJUST_*`); none are committed. Tests use the placeholder `'abc123abc123'`.
- Advance exactly one column; no PRs (conductor merges); no deploys.
- UI guardrail #2 (zero literal colors/copy/asset paths in `packages/ui`) is **N/A** — this is
  `packages/sdk`, no rendering surface. Noted so the next worker doesn't chase it.

## What v1 actually is (evidence)

Both copies are **JS/TS Capacitor-bridge adapters only**. Neither imports an npm Adjust SDK —
the real Adjust iOS SDK is native Swift (SPM `adjust/ios_sdk 5.6.2`) reached through a
Capacitor plugin registered as `AdjustAttribution`. Android has no bridge. The only runtime
import is `@capacitor/core` (`registerPlugin`, `Capacitor.getPlatform`). There are **no
attribution callbacks, deep-link handling, or IDFA/ID storage in the JS layer** — IDFA/ATT are
disabled and the native bridge owns the callback-parameter allowlist and egress.

Data flow (both copies): `AttributionService.<event>` → `await startupGate` →
`provider.track(name, params)`. In the Adjust provider: lazy deduped `init()` → native
`initialize(...)`; `track` stringifies params (dropping null/undefined), looks up the per-event
token (skips the event if the token is absent), calls native `trackEvent(...)` under a timeout.

### File inventory (READ-ONLY sources)

| core `packages/core/src/attribution/` | lines | FTD `games/find_the_dog/src/attribution/` | lines |
|---|---|---|---|
| `AttributionProvider.ts` | 16 | `AttributionProvider.ts` | 15 |
| `AdjustAttributionPlugin.ts` | 38 | `AdjustAttributionPlugin.ts` | 36 |
| `AdjustAttributionProvider.ts` | 145 | `AdjustAttributionProvider.ts` | 138 |
| `AdjustConfig.ts` | 174 | `AdjustConfig.ts` | 164 |
| `AttributionService.ts` | 105 | `AttributionService.ts` | 88 |
| `DisabledAttributionProvider.ts` | 30 | `DisabledAttributionProvider.ts` | 25 |
| `index.ts` (barrel) | 36 | — (no barrel) | — |
| `AdjustConfig.test.ts` | 138 | — (no tests) | — |
| `AdjustAttributionProvider.test.ts` | 243 | — | — |
| `AttributionService.test.ts` | 267 | — | — |
| `AdjustAttributionPlugin.test.ts` | 22 | — | — |
| `README.md` | 83 | — | — |
| — | — | `RewardedAttribution.ts` | 27 |

## Prior-art ledger — take / adapt / reject

| Source (READ-ONLY) | Verdict for v2 SDK |
|---|---|
| core `index.ts`, `AttributionProvider.ts`, `AdjustAttributionPlugin.ts`, `DisabledAttributionProvider.ts` | **TAKE AS-IS** (adjust import paths only) |
| core `AdjustAttributionProvider.ts` | **TAKE** — has retryable-timeout + privacy flags FTD lacks (below) |
| core `AttributionService.ts` | **TAKE** — instance-based, injectable, timeout-bounded startup gate |
| core `AdjustConfig.ts` | **TAKE, then ADAPT** — one change: default `environment` to `sandbox` (§ below) |
| core `*.test.ts` (all 4) | **TAKE** — adapt import paths; port the `with-timeout` mock reference |
| core `README.md` | **TAKE** — carry (update paths); it documents the native contract + ATT/IDFA posture |
| `../runtime/with-timeout` (core internal dep: `withTimeout`, `isTimeoutError`, `TimeoutError`) | **VENDOR** into `src/attribution/with-timeout.ts` + its test — not in v2 yet, and edits are confined to `packages/sdk/**` |
| FTD `AdjustAttributionProvider.ts` (`permanentlyDisabled = true` unconditionally) | **REJECT** — core's retryable-on-timeout is strictly better |
| FTD `AdjustConfig.ts` (raw `import.meta.env.PROD`, no fail-closed) | **REJECT** — core's defensive read is safer |
| FTD `AttributionService.ts` module-singleton `attribution` + `configure*Gate` free fns + `resetAttributionStartupGateForTest` | **REJECT** — keep core's instance/injectable model; a consumer game owns its own instance |
| FTD FTD-specific typed methods (`levelComplete({level_id,time_seconds,hints_used,wrong_taps})`, `appOpen(cohortBucket)`, …) | **REJECT from SDK** — game-specific; SDK keeps core's generic param bags. These belong in the game's own attribution glue. |
| FTD `RewardedAttribution.ts` (`trackRewardedWatchedIfGranted` / `…AfterGrant`) | **REJECT from SDK** — reward-grant *timing* is game-owned glue (core README lines 82-83 say so explicitly). The generic `rewardedWatched` **event** is already supported via its event token; only the grant-gating wrapper stays in the game. Documented as S3. |

**Net:** the port is essentially "carry core verbatim, vendor its one internal util, flip the
environment default to sandbox." The FTD copy contributes almost nothing the SDK should adopt —
its only unique additions are FTD-specific (event schemas, reward-grant glue, module singleton),
all of which belong in the game, not the shared SDK.

## The one behavioral change: env defaults to sandbox (AC)

This is the card's headline requirement and the **only** intentional divergence from core.
Today **neither** v1 copy defaults to sandbox — both *require* `VITE_ADJUST_IOS_ENVIRONMENT`
to be an explicit `sandbox | production`, and an unset/invalid value yields `enabled:false`:

- **core** additionally **fails closed to production**: absent `import.meta.env.PROD` ⇒
  `productionDefault()` returns `true` ⇒ a build treated as production ⇒ sandbox env rejected
  by the production guard (`AdjustConfig.ts:100-106`, tested at `AdjustConfig.test.ts:125-137`).
- **FTD** reads `import.meta.env.PROD` raw with no fallback; if `undefined`, the guard is
  skipped (does *not* fail closed).

Two distinct "environment" concepts must not be conflated:

1. **`isProductionBuild`** = Vite's `import.meta.env.PROD` — "is this a production build?"
2. **`AdjustEnvironment`** = `VITE_ADJUST_IOS_ENVIRONMENT` (`sandbox|production`) — "which Adjust
   backend does the SDK talk to?"

**The change (worked stage):** in `readAdjustIosConfig`, when `VITE_ADJUST_IOS_ENVIRONMENT` is
absent, **default `AdjustEnvironment` to `'sandbox'`** instead of counting it as a missing key
that disables attribution. **Keep the production guard unchanged** (`isProductionBuild &&
environment !== 'production'` ⇒ disabled) and **keep core's fail-closed `productionDefault`**
(absent `PROD` ⇒ treat as production). The combined behavior is exactly what the DECISIONS doc
asks for and stays safe:

- dev/pilot build (`PROD=false`), env unset → defaults to sandbox → **enabled in sandbox** ✓
  (this is the marble_run pilot path per DECISIONS §"SDK test credentials")
- production build, env unset (now defaults to sandbox) → production guard trips → **disabled**
  (safe: a prod app can't silently run against the sandbox backend)
- production build, env explicitly `production` → **enabled in production** ✓
- any build, `VITE_ADJUST_IOS_ENABLED` falsy or app token absent/not-12-chars → **Disabled
  provider** (unchanged; the sandbox default only picks the *backend* once enabled)

Tests to update/add for this (in the ported `AdjustConfig.test.ts`): a case asserting that an
otherwise-complete env with `VITE_ADJUST_IOS_ENVIRONMENT` **unset** resolves to
`environment: 'sandbox'` (not a `missingKeys` disable), and that the existing production-guard /
fail-closed cases still hold with the new default in place.

**Residual risk (carry to the card, per DECISIONS §"SDK test credentials"):** the pilot reuses
FTD's real Adjust credentials in sandbox mode. Sandbox events are segregated by Adjust, but
tag/verify the environment marker so pilot verification cannot pollute FTD production
attribution data. This is a release-gate note, not a code blocker.

## Behaviors to KEEP from core (do not "simplify" away)

- **Init timeout is transient, not permanent** (`AdjustAttributionProvider.ts:79`,
  `this.permanentlyDisabled = !isTimeoutError(err)`). A stuck native init retries next event.
  Explicitly covered by "times out stuck native initialization without permanently disabling"
  (`AdjustAttributionProvider.test.ts:161-181`). This is the reason `with-timeout` exports
  `isTimeoutError`; vendor all three symbols.
- **Privacy flags forwarded to native init** — core passes `disableIdfaReading` and
  `disableAppTrackingTransparencyUsage` in the `initialize(...)` payload
  (`AdjustAttributionProvider.ts:62-69`). FTD drops them. Keep core's payload.
- **Timeout-bounded startup gate** (`AttributionService.ts:48-104`, default 5000ms,
  warn-and-continue on reject/never-settle). Keep the injectable `AttributionServiceOptions`.
- **Token redaction in logs** (`redactAdjustToken`, last-4 only). Keep.
- **12-char app-token validation + missing-event-token → silently skip that event.** Keep.

## Scaffolding gaps the `worked` stage MUST close (else acceptance fails)

Verification command (card):
`npm run typecheck --workspace=packages/sdk && npm run test:unit --workspace=packages/sdk`

`packages/sdk/` is already scaffolded by the landed haptics/AudioBus card (Fw1NtsCr sibling):
`package.json` has `typecheck`/`test:unit` scripts + an `exports` map, `tsconfig.json` extends
the strict base (its `lib` includes `DOM` → `AudioContext` etc.; sufficient here), and
`@capacitor/core` is already an **optional peerDependency** with an ambient shim. That last
point removes the haptics card's biggest headache (S6 dependency-addition) — **no new
dependency is required for attribution.** Remaining gaps:

1. **`exports` map** — add `"./attribution": "./src/attribution/index.ts"` to
   `packages/sdk/package.json` (root of package; unavoidable, flagged in Constraints).
2. **Vendor `with-timeout`** — core imports `../runtime/with-timeout` (`withTimeout`,
   `isTimeoutError`, `TimeoutError`); this exists **nowhere in v2** (grep-confirmed). Because
   edits are confined to `packages/sdk/**`, copy it to `src/attribution/with-timeout.ts`
   (+ port its test if v1 has one; if not, the provider/service tests already exercise it
   through the timeout paths). Fix the two provider/service import paths to point at it. (A
   later card may promote it to `@fabrikav2/kernel` as a runtime primitive — **do not** do
   that here; kernel is outside this card's file boundary.)
3. **Extend the Capacitor shim** — `src/haptics/capacitor-shims.d.ts` currently declares only
   `Capacitor.getPlatform/isNativePlatform`. Attribution imports **`registerPlugin`** from
   `@capacitor/core`; add `export function registerPlugin<T>(name: string): T;` to the
   `declare module '@capacitor/core'` block so `tsc --noEmit` resolves the static import.
   (Same file both subpaths share; keep it minimal per its own header.)
4. **`index.ts` barrel** — carry core's `src/attribution/index.ts`. Optionally re-export from
   the package root `src/index.ts` (matches how haptics/audio are surfaced there); low-risk,
   consistent with the sibling pattern.
5. **`import.meta.env` typing** — core avoids needing `vite/client` types by casting
   (`(import.meta as unknown as { env?: AdjustImportMetaEnv }).env ?? {}`) and defining
   `AdjustImportMetaEnv` locally. Carry that cast verbatim; do **not** add `vite/client` to
   the tsconfig `types`.

### Test mocking approach (carry core's; it's already unit-friendly)

- `AdjustConfig.test.ts` — **pure function**, injects an env bag; no SDK mock. Add the new
  sandbox-default case here.
- `AdjustAttributionProvider.test.ts` — **no `vi.mock`**; injects a fake plugin via the
  provider's `options.plugin` seam (`makePlugin` with `vi.fn` for
  `initialize`/`trackEvent`/`getStatus`) + `vi.useFakeTimers()` for the timeout cases.
- `AttributionService.test.ts` — injects `factories` (`vi.fn`) and a fake provider; asserts
  routing (iOS-enabled ⇒ Adjust, non-iOS/disabled ⇒ Disabled), warn-once, gate timeout.
- `AdjustAttributionPlugin.test.ts` — the **only** file using `vi.doMock('@capacitor/core')`
  (to assert `registerPlugin('AdjustAttribution')`). With the ambient shim in place + the
  factory mock, this runs without `@capacitor/core` installed — **verify this specific file**,
  since it exercises the real import path rather than the injected-seam path.

## Acceptance criteria (restated) & how they'll be verified

- [ ] provider seam present & typed — `AttributionProvider` interface + `AdjustAttributionProvider`
      + `DisabledAttributionProvider`, selected by `createAttributionProvider(...)` — compiles
      (`npm run typecheck --workspace=packages/sdk`)
- [ ] ported vitest suite green (`npm run test:unit --workspace=packages/sdk`) — all 4 core
      test files, import paths reconciled
- [ ] **env defaults to sandbox** — new test asserts unset `VITE_ADJUST_IOS_ENVIRONMENT`
      resolves to `environment: 'sandbox'`; production guard + fail-closed cases still pass
- [ ] `package.json` `exports` exposes `./attribution`
- [ ] no FTD-specific event schemas, module singleton, or reward-grant glue copied into the SDK

## Surprises / open items to carry forward

- **S1 — "env defaults to sandbox" is a genuine behavioral change, not a carry.** Neither v1
  copy defaults to sandbox; core actively *fails closed to production*. The port keeps the
  production guard + fail-closed build detection and only changes the *unset AdjustEnvironment*
  default to `sandbox`. Net effect is correct + safe (see §"The one behavioral change"), but
  be honest that a v1 test (`AdjustConfig.test.ts` missing-env cases) must be updated, not just
  ported byte-for-byte.
- **S2 — no npm Adjust SDK exists; the JS layer is a native-bridge adapter.** Full
  Adjust behavior (attribution callbacks, deep links, IDFA) lives in Swift and can only be
  verified in a native shell. The unit-testable slice is config resolution + provider routing +
  the init/track state machine via injected fakes. The sdk README already flags "native-backed
  SDKs need a native shell to verify" — the `insitu`/`evidence` stages should treat device
  attribution proof as a release-gate, not a unit-test target.
- **S3 — RewardedAttribution stays in the game, by design.** Core deliberately omits FTD's
  `RewardedAttribution.ts` (reward-grant gating). The SDK ships the generic `rewardedWatched`
  event; the "only fire after a grant" wrapper is game-owned glue. Not porting it is correct,
  not an omission — flagged so a later reviewer doesn't file it as missing.
- **S4 — `@capacitor/core` is NOT installed in the monorepo** (optional peerDep; grep-confirmed
  absent from `node_modules`). Typecheck relies on `capacitor-shims.d.ts`; tests rely on
  `vi.mock`/`vi.doMock`. The shim must gain `registerPlugin` (gap #3) or typecheck fails.
- **S5 — the worktree currently has no `node_modules`** (no root install; `vitest`/`tsc` bins
  absent, so the verification command cannot run here as-is). The `worked` stage must ensure
  deps are installed (`npm install` at repo root) before the acceptance command will run. Not a
  design issue — an environment note for whoever executes verification.
- **S6 — `with-timeout` will be duplicated for now.** Vendoring it into the attribution subtree
  (rather than kernel) is dictated by the card's file boundary. A follow-up card should promote
  it to `@fabrikav2/kernel` and de-dupe; note it so the duplication is intentional and tracked,
  not accidental drift.
- **S7 — core's generic param bags (`AttributionParamBag<P>`) vs FTD's untyped `AttributionParams`.**
  Keep core's generics (typed per-call param bags, better DX + type safety). FTD's hard-coded
  FTD-shaped signatures are exactly the game-specific coupling the SDK should not inherit.
