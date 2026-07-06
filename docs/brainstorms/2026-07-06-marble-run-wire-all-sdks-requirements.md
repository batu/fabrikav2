---
title: "games/marble_run — wire ALL SDKs (ads, analytics, iap, attribution): full implementation test (requirements)"
date: 2026-07-06
trello: https://trello.com/c/xhVERsUf
card: xhVERsUf
depends_on: [9SbVZcm7, M3ngFJXt, X50H87vS, GE3h3u1F, d44nVkm2]
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika
---

# games/marble_run: wire ALL SDKs — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. No code is written
at this stage. This doc front-loads what `planned`/`worked` need: (1) the exact wiring seams
in the already-booting marble_run shell, (2) the four SDK public entry points a game calls
(all already landed), (3) the three narrow `packages/sdk` touch-ups the conductor absorbed
into this card (comment 2, findings A/B/C), (4) the CI/test strategy using Disabled/Fake
providers, and (5) the `TEST-CREDENTIALS.md` contract (paths + modes, **zero secret values**).

## The headline that reframes the card

The card reads like a from-scratch SDK build. It is not. **Every SDK is already a shipped,
tested `@fabrikav2/sdk` subpath, and marble_run already boots and already wires four of the
platform packages** (`@fabrikav2/kernel`, `@fabrikav2/ui`, `@fabrikav2/sdk/haptics`,
`@fabrikav2/sdk/audio`). This card is a **composition / wiring** card: hook four more SDK
surfaces into the one boot seam that already exists, and fulfil the intent the game manifest
already declares.

Concrete evidence the sockets are pre-cut:

- `games/marble_run/game.config.ts` already declares the wiring targets:
  `economy.softCurrency: 'coins'`, `adPlacements: ['rewarded_fail_save']`,
  `productCatalog: []` (empty — to fill), `analyticsEvents: ['level_start','level_complete','level_fail']`.
- `games/marble_run/src/shell/App.ts:335` has a **stubbed** `requestFailSave()` whose own
  comment says *"No ad provider is wired in the v2 pilot (ads deferred)"* — it just shows a
  "save unavailable" toast and returns `false`. This is the rewarded-ad socket, pre-labelled.
- The lose screen (`App.ts:205-218`) already renders a **"watch ad"** primary action wired to
  `requestFailSave()`.
- Hints already exist and already cost coins: `Constants.ts` `HINT_COIN_COST = 125`,
  `App.ts:422 showHint()`. The card's "rewarded ad on hint" = *watch-ad-instead-of-pay*.
- `@fabrikav2/ui` already exports `mountShopPage` (+ `ShopPageOptions/Handle/Section/Copy`),
  and `mountSettingsPage` is already mounted by the shell — so the shop **screen** and the
  settings surface exist; the game injects copy/products/handlers.

So the real job is **carry the four provider factories into the shell boot, inject
Disabled/Fake providers on web/CI, drive the canonical analytics event set off the existing
flow-machine hooks, add an IAP catalog fixture + shop page, and document the reused test
creds** — plus three named `sdk` reconciliations the conductor folded in. Nothing here
invents an abstraction; the abstractions are all upstream and green.

## Scope & file boundaries (a real tension to resolve up front)

The card body says **"Files: games/marble_run/** only."** The conductor's comment 2 then
**absorbs three findings that live in `packages/sdk`** (env resolver, DeathAdCoordinator
rename, AdFormat union). These conflict. Resolution (state it, don't silently pick):

> **Effective scope = `games/marble_run/**` PLUS exactly three named, surgical `packages/sdk`
> changes** (§A, §B, §C below). The later conductor instruction overrides the older card
> line; the `sdk` edits are additive/narrow and each is independently justified. The `worked`
> stage must touch **nothing else** in `packages/sdk` and must NOT vendor utilities into the
> game (conductor comment 1: shared code lives in `sdk`/`kernel`, named in handoff).

If the conductor prefers to keep this card game-only, §A/§B/§C split into a tiny sibling
`packages/sdk` card and this card consumes them — flag at `planned`. Default assumption:
they stay here (that is what "absorb into this card" means).

## Prior-art / current-state ledger — what exists, what to wire

| Surface | State today | This card |
|---|---|---|
| `@fabrikav2/sdk/ads` | landed (M3ngFJXt): `AdProvider`, `createAdProvider(platform, appLovinConfig, factories, lifecycle)`, `DisabledAdProvider`, `createDeathAdCoordinator`, `shouldShowInterstitial` cadence, `AD_CONFIG` (Google public test IDs) | wire rewarded (hint + fail-save) + interstitial cadence; **web/CI → `DisabledAdProvider`** via factory selection |
| `@fabrikav2/sdk/analytics` | landed (X50H87vS): `createAnalytics({env, sessionId, sinks, globalParams})`, `CANONICAL_EVENT_NAMES`, `AnalyticsEnvironment`, sinks (`createConsoleSink`, `createFirebaseSink`, `createOwnedMirrorSink`), **`wire.ts` reconciled contract** (`OWNED_ANALYTICS_WIRE_SCHEMA`) | emit canonical set (level/economy/ad/purchase) with `env: 'development'`; CI sink = console + a capture/fake sink; Firebase/mirror sinks are native-only |
| `@fabrikav2/sdk/iap` | landed (GE3h3u1F): `IapService<TPayload>`, catalog schema (`Catalog`, `CatalogProduct`, `validateCatalog`, `visibleProducts`), `PurchaseProvider` port, **`FakePurchaseProvider`**, `RevenueCatProvider`, restore machine, `isSandboxApiKey` | define a **marble_run catalog fixture** (no-ads entitlement + coin-pack consumables), build the service on `FakePurchaseProvider` for CI, wire `mountShopPage` |
| `@fabrikav2/sdk/attribution` | landed (d44nVkm2): `createAttributionProvider(platform, adjustConfig, factories)`, `AttributionService`, `AdjustEnvironment`, `DisabledAttributionProvider` | init in sandbox; **web/CI → disabled** (factory returns disabled for non-iOS by construction) |
| `@fabrikav2/services/remote-config` | landed: `createRemoteConfigService(schema, {provider})`, `numberField/booleanField/stringField`, typed `value()` | declare marble_run's ad-cadence flags; feed `shouldShowInterstitial` + hint/offer gating; provider = default/static on web, Firebase adapter on native |
| marble_run shell (`src/shell/App.ts`, `src/main.ts`) | boots kernel flow-machine + ui screens; haptics/audio wired; `requestFailSave` stubbed | the single wiring seam — construct an `SdkContext` at boot and inject into `App`/`GameController` |

## §A — UNIFIED ENV RESOLVER (conductor finding 2 — MUST build)

**Confirmed absent.** `grep resolveSdkEnvironments|SdkEnvironments` across `packages/` and
`games/` returns nothing. Today three parallel env vocabularies exist and a game would
hand-map each independently — the exact inconsistency risk the conductor flagged (an untagged
or prod-tagged event polluting FTD's live data):

| SDK | Env vocabulary | Source |
|---|---|---|
| analytics | `AnalyticsEnvironment` = `'production' \| 'development' \| 'test'` (MANDATORY `env` field on `createAnalytics`) | `sdk/analytics/contract.ts:31` |
| attribution | `AdjustEnvironment` = `'sandbox' \| 'production'` (reader defaults to `sandbox` when unset) | `sdk/attribution/AdjustAttributionPlugin.ts:3`, `AdjustConfig.ts:50` |
| ads (AdMob) | `AdConfig.isTesting` from `VITE_ADMOB_TEST_MODE` (defaults to `env.DEV`); `AD_CONFIG` Google public test IDs | `sdk/ads/AdMobConfig.ts:14,73` |
| iap (RevenueCat) | sandbox detection `isSandboxApiKey(apiKey)` = `apiKey.startsWith('test_')` | `sdk/iap/service.ts:140` |

**Build `resolveSdkEnvironments(buildEnv)` in `packages/sdk`** (new tiny module, e.g.
`src/env/resolveSdkEnvironments.ts`, exported at `@fabrikav2/sdk` root or a `./env` subpath).
One call in the wiring, four consistent outputs:

```ts
export type SdkBuildEnv = 'development' | 'production';
export interface SdkEnvironments {
  analytics: AnalyticsEnvironment;   // 'development' | 'production'
  adjust: AdjustEnvironment;         // 'sandbox'     | 'production'
  admobTestMode: boolean;            // true in dev  → forces Google test unit ids
  revenuecatSandbox: boolean;        // true in dev  → expect a sandbox api key
}
export function resolveSdkEnvironments(buildEnv: SdkBuildEnv): SdkEnvironments;
```

- Pilot always resolves to the dev row (`{analytics:'development', adjust:'sandbox',
  admobTestMode:true, revenuecatSandbox:true}`). `buildEnv` is derived once in the game from
  `import.meta.env.PROD ? 'production' : 'development'`.
- Pure, deterministic, table-driven → unit-testable with zero mocks (both rows).
- **Load-bearing invariant to test:** dev row must NEVER yield `analytics:'production'` or
  `adjust:'production'`. This one assertion is the guardrail against prod-data pollution.
- The wiring makes **one** call and reads fields off the result — never re-derives per-SDK.

## §B — DeathAdCoordinator `withTimeout` footgun (conductor finding 2B — reconcile)

Confirmed at `packages/sdk/src/ads/DeathAdCoordinator.ts:40`: a **local** `withTimeout` that
`resolve()`s void on success **and** on failure **and** on timeout (settle-on-anything, never
throws). The shared `packages/sdk/src/with-timeout.ts` `withTimeout(promise, ms, label)`
does the **opposite** — resolves the value or **rejects with `TimeoutError`**. Same name,
opposite contract = the footgun.

**Decision: rename the local helper to `settleWithin` (do NOT collapse onto the shared one).**
The death-ad coordinator *intentionally* wants "run this step, but continue no matter what
after N ms" (an ad step must never wedge the game-over flow). The shared reject-semantics
would change behavior (an unhandled rejection / different control flow). So this is a **rename
+ clarifying doc comment**, not a behavioral reconcile. The shared helper's own doc even
explains the reject rationale (distinguish transient timeout from real rejection) — different
job. Keep both; make the names honest. Existing `DeathAdCoordinator` tests should stay green
(pure rename).

## §C — `AdFormat` ⊇ `FullScreenAdType` (conductor finding 2C — enforce containment)

Today (`sdk/analytics/contract.ts:113`): `AdFormat = 'banner' | 'interstitial' | 'rewarded'`
is a standalone literal union; `FullScreenAdType` (`sdk/ads/AdProvider.ts`) =
`'interstitial' | 'rewarded'`. The containment (`FullScreenAdType ⊂ AdFormat`) is *lucky*,
not *enforced* — a future edit to one won't error the other.

**Change to** `type AdFormat = FullScreenAdType | 'banner';` importing `FullScreenAdType`
(type-only) from `../ads/AdProvider.ts`. Verify no import cycle (analytics → ads type-only is
fine; ads does not import analytics). This makes the analytics ad-event `ad_format` provably a
superset of what the ad provider can show. Surgical: one `import type` + one line.

## Per-SDK wiring plan (the `worked` stage's checklist)

Wire at a single boot seam. Recommended shape: a small game-local `src/sdk/SdkContext.ts`
(a *composition root*, NOT vendored utilities — it only *calls* SDK factories) built in
`main.ts` and passed into `App`. `App`/`GameController` receive injected ports so tests pass
Fake/Disabled providers with zero production-code branches.

### 1. Ads — `sdk/ads`
- `const ads = createAdProvider(platform, appLovinConfig, factories, lifecycle)`.
  On web `platform === 'web'` → `DisabledAdProvider` by construction; native shell (later,
  out of scope) supplies real AppLovin/AdMob. CI/dev inject `factories` whose selection yields
  `DisabledAdProvider`.
- **Rewarded on hint:** in the hint path, if a rewarded ad is available, `await
  ads.showRewardedAd()`; on `{granted:true}` give the hint free (skip `HINT_COIN_COST`);
  else fall back to the coin cost / "unavailable" path. Non-blocking contract preserved.
- **Rewarded fail-save:** replace the `App.ts:335` stub — `await ads.showRewardedAd()`, grant
  the retry/continue on `granted`, keep the existing "unavailable" toast on `false`.
- **Interstitial cadence:** feed `shouldShowInterstitial(policy, state)` from remote-config
  flags (level-count decision) and `maybeShowInterstitial({minIntervalMs})` (time cap). Prefer
  driving off `createDeathAdCoordinator` (game:over → interstitial, time-bounded) since the
  shell already emits win/fail; OR gate on `level:complete`. Decide at `planned`.
- **Placement naming:** `game.config.ts` already commits `adPlacements: ['rewarded_fail_save']`.
  Card also says "rewarded on hint" → add `'rewarded_hint'` (and `'interstitial_level'`).
  Keep placements as analytics `placement` strings; reconcile the manifest list at `worked`.

### 2. Analytics — `sdk/analytics`
- `const analytics = createAnalytics({ env: envs.analytics /* 'development' */, sessionId:
  crypto.randomUUID(), sinks, globalParams: { app_version, platform } })`.
- **Env tag is mandatory and MUST be `'development'`** for all pilot traffic (conductor
  comment 1). Sourced from `resolveSdkEnvironments` (§A) — never hand-typed.
- **Sinks:** CI/web → `createConsoleSink()` + a capture/fake sink (assert emitted events in
  tests). Firebase (`createFirebaseSink(nativeFirebaseTransport)`) and owned-mirror
  (`createOwnedMirrorSink`) sinks are native/worker-only — constructed but their transports
  are no-op/absent on web. The **wire contract** for the mirror path is
  `OWNED_ANALYTICS_WIRE_SCHEMA` from `wire.ts` (single source of truth — do NOT re-declare).
- **Canonical event coverage** (drive off existing flow-machine hooks in `App.ts`):
  - `level_start` on `level:start`; `level_complete` on `level:complete`; `level_fail` on
    `level:fail` (typed `LevelStart/Complete/FailParams`).
  - **economy** (`resource_change`, `ResourceFlow` source/sink): coin reward on win (`source`),
    hint spend / shop spend (`sink`) — the game already has `saveState.addCoins` /
    `recordWin(levelId, reward)` and `HINT_COIN_COST`.
  - **ad** (`AdParams`/`AdRewardParams`, `ad_format` per §C): ad shown / rewarded granted.
  - **purchase** (`PurchaseParams`): on IAP success.
  - `session_start`/`session_end` at boot/teardown.

### 3. IAP — `sdk/iap`
- **Catalog fixture** (game-local, e.g. `src/sdk/catalog.ts`) using the SDK schema:
  a **no-ads `entitlement`** product + N **coin-pack `consumable`** products. Run
  `assertValidCatalog` at construction. Payload type carries the game's grant semantics
  (coins amount / no-ads flag) via injected mappers. **Copy the pattern from
  `packages/sdk/src/iap/ftd-fixture.ts`** (`ftdCatalogProducts` + `FtdGrant` +
  `ftdGrantForProduct`/`ftdRestoreGrantForProduct` — restore recovers only the entitlement
  half) — that is the reference shape; marble_run ships a *minimal* variant (no-ads + coins).
- `const iap = new IapService(deps)` with `deps.provider` → `FakePurchaseProvider` on
  web/CI (scripted purchase/restore outcomes), `RevenueCatProvider` on native (later).
  `isSandboxApiKey` guard asserts we never ship a prod key in the pilot.
- **Shop page:** `mountShopPage({...})` from `@fabrikav2/ui` — inject product view-models,
  copy, prices, purchase/restore handlers. Add a `menu.shop` entry point on `HomeMenu`
  (alongside play/levels/settings). Wire buy → `iap.purchase(productId)` → grant via mapper →
  analytics `purchase` + economy events.
- **No-ads entitlement** should suppress interstitials once owned (cadence checks the
  entitlement). Restore flow via the restore machine.

### 4. Attribution — `sdk/attribution`
- `const attribution = createAttributionProvider(platform, adjustConfig, factories)`.
  `createAttributionProvider` returns `DisabledAttributionProvider` for any non-iOS platform
  **by construction** (`AttributionService.ts:38`) — so web/CI is disabled with no branching.
- `adjustConfig` env is `'sandbox'` (from §A). Wrap in `AttributionService` with a
  `startupGate` so attribution init doesn't block first paint. Track first-open / key events.

### 5. Remote-config — `@fabrikav2/services/remote-config`
- Declare marble_run's flags once (game-local schema), e.g.
  `interstitialEveryNLevels: numberField(3, {remoteKey:'interstitial_every_n_levels', validate: v=>v>=0})`,
  `interstitialMinLevel: numberField(2, …)`, `interstitialMinIntervalS: numberField(60, …)`,
  `hintRwEnabled: booleanField(true, …)`, `noAdsProductId: stringField(<from catalog>, …)`.
- `createRemoteConfigService(schema, {provider})`: provider = a static/default provider on
  web/CI (typed defaults, deterministic tests); Firebase Remote Config adapter on native
  (game-side seam, later). Feeds ad cadence + offer visibility.

## CI / test strategy (the AC's teeth)

AC: *"all four sdks initialized in dev build without runtime errors (verify via vite dev +
unit/integration tests with Disabled/Fake providers for CI); ad/iap/analytics flows exercised
in tests."* Native verification is explicitly **out of scope** (Blocked-on-Batu).

- **Provider injection, not env branching:** the `SdkContext` composition root takes injected
  factories; CI/web resolve to `Disabled*`/`Fake*`. No `if (test)` littered through gameplay.
- **Integration tests** (game `vitest`, headless, no jsdom needed for the SDK layer):
  - analytics: drive a level start→complete→fail sequence, assert the capture sink saw the
    canonical events with `env:'development'` and correct params (incl. `ad_format`, economy
    `flow`).
  - ads: with a fake rewarded provider, assert hint-free-on-granted and fail-save-on-granted;
    with disabled provider, assert graceful "unavailable" (returns `false`, shows toast).
  - iap: with `FakePurchaseProvider`, assert purchase → grant (coins / no-ads entitlement) →
    analytics `purchase`; assert restore; assert `assertValidCatalog` passes; assert no-ads
    suppresses interstitials.
  - env resolver (§A): both rows; dev-row-never-production invariant.
- **`vite dev` smoke:** the AC's "dev build without runtime errors" — the wiring must not
  throw at boot on web (all providers disabled/fake). A short Playwright or manual `vite`
  boot check. (Existing `tests/e2e/play.spec.ts` is the harness precedent.)

## TEST-CREDENTIALS.md contract (games/marble_run/TEST-CREDENTIALS.md)

Per DECISIONS §"SDK test credentials": reuse find_the_dog's v1 (READ-ONLY) config as **TEST**
creds, **sandbox/test mode only**, env tag mandatory. The doc records **paths + which mode**,
and **copies NO secret values**. Confirmed v1 source paths (READ-ONLY):

| SDK | v1 source (READ-ONLY, do not edit; do not copy values) | Mode this pilot uses |
|---|---|---|
| AppLovin MAX (ads) | `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/ads/AppLovinConfig.ts` | test/sandbox; AdMob uses Google public test unit ids (`admobTestMode:true`) |
| Firebase (analytics) | `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/analytics/firebaseApp.ts` | `env: 'development'` tag on every event |
| Adjust (attribution) | `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/attribution/AdjustConfig.ts` | `AdjustEnvironment: 'sandbox'` |
| RevenueCat (iap) | `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/shop/IapService.ts` (+ `src/bootstrap.ts`) — worked stage confirms exact key site | sandbox api key (`isSandboxApiKey` guard); Fake provider in CI |

The doc must also state the **residual risk** (untagged/misresolved events could pollute FTD
production data — mitigated by §A's dev-row invariant + the mandatory `env` tag) and that
**real marble_run app IDs are a separate Blocked-on-Batu item**.

## Acceptance criteria (restated) & verification

Verification command (card):
`npm run typecheck --workspace=games/marble_run && npm run test:unit --workspace=games/marble_run && npm run build --workspace=games/marble_run`

- [ ] All four SDKs constructed at boot with **no runtime error** on the web/dev build
      (Disabled/Fake providers).
- [ ] Rewarded (hint + fail-save) and interstitial cadence wired; ad flow exercised in tests.
- [ ] Canonical analytics events (level / economy / ad / purchase / session) emitted with
      `env:'development'`; analytics flow asserted in tests.
- [ ] IAP catalog fixture (no-ads entitlement + coin packs) valid; purchase + restore
      exercised with `FakePurchaseProvider`; shop page mounts; no-ads suppresses interstitials.
- [ ] Attribution init in sandbox (disabled on web by construction).
- [ ] `resolveSdkEnvironments` (§A) built + unit-tested; DeathAdCoordinator local helper
      renamed `settleWithin` (§B); `AdFormat = FullScreenAdType | 'banner'` (§C).
- [ ] `games/marble_run/TEST-CREDENTIALS.md` complete — paths + modes, **no secret values**.
- [ ] `typecheck` + `test:unit` + `build` green for `games/marble_run`; `sdk` typecheck/tests
      still green after §A/§B/§C.

## Scaffolding gaps the `worked` stage MUST close

1. **Add `@fabrikav2/services` as a marble_run dependency** — it is NOT one today, and
   remote-config lives there. This is a **dependency addition → flag for conductor/Batu**
   (CLAUDE.md). It's an internal workspace pkg (`*` version), low-risk, but state it.
2. `game.config.ts`: fill `productCatalog` (or reference the fixture), extend `adPlacements`
   (`rewarded_hint`, `interstitial_level`), extend `analyticsEvents` to the canonical set,
   add a `Shop` screen id if the manifest gates screens. Keep it `satisfies GameConfig`.
   **`tests/unit/game-config.test.ts` currently asserts `productCatalog.length === 0` and the
   3-event analytics list** — it must be updated in lockstep, not left to fail.
3. `HomeMenu` needs a shop entry point + `copy['menu.shop']` (design/copy — literal-free).
4. `main.ts` builds the `SdkContext` (composition root) and passes it into `App`;
   `App`/`GameController` gain injected ports (no vendored utils — conductor comment 1).
5. `packages/sdk`: new `resolveSdkEnvironments` module + export; DeathAdCoordinator rename;
   AdFormat union — the **only** three `sdk` edits allowed.
6. Firebase Remote Config + Firebase analytics transport + RevenueCat provider are **native
   seams** — construct-and-inject shape only. Note: v2 has **no `firebaseApp.ts`/`initializeApp`
   module** — `createFirebaseSink(transport)` takes an *injected* native transport, and
   remote-config's Firebase backend is a game-supplied `RemoteConfigProvider` adapter. Their
   real transports are Blocked-on-Batu.

## Surprises / open items to carry forward

- **S1 — file-scope conflict is real.** Card says "games/marble_run/** only"; conductor
  comment 2 mandates three `packages/sdk` edits. Resolved here as game + three named sdk
  changes; if the conductor disagrees, split §A/§B/§C into a sibling sdk card. Decide at
  `planned` before writing sdk code.
- **S2 — `resolveSdkEnvironments` does not exist.** Confirmed by grep. It is net-new work in
  `sdk`, not a helper to reuse (card's "if a claimed helper doesn't exist, build minimal +
  report"). It is the single most important pollution guard — build + test it first.
- **S3 — `withTimeout` name collision** (`DeathAdCoordinator.ts:40` settle-on-anything vs
  `with-timeout.ts` reject-on-timeout). Rename local to `settleWithin`; do NOT reconcile
  onto the shared helper — the semantics are deliberately different.
- **S4 — "rewarded on hint" vs manifest `rewarded_fail_save`.** marble_run has BOTH a hint
  (coin-priced, `HINT_COIN_COST=125`) and a fail-save (lose-screen "watch ad"). The card's
  "hint" placement is additive; wire both, reconcile the `adPlacements` list.
- **S5 — analytics native sinks are out of runtime scope.** `createFirebaseSink` /
  `createOwnedMirrorSink` need native/worker transports; on web they're constructed but inert.
  CI asserts against console/capture sinks. Do NOT claim Firebase/mirror delivery was verified.
- **S6 — no-ads entitlement ↔ cadence coupling.** The interstitial cadence must consult the
  IAP entitlement (owning no-ads suppresses interstitials). This is a cross-SDK invariant
  (iap → ads) worth an explicit integration test.
- **S7 — RevenueCat key site not yet pinned.** v1 FTD RevenueCat config is in
  `src/shop/IapService.ts` / `src/bootstrap.ts` (not a standalone `*Config.ts`). The worked
  stage confirms the exact sandbox-key site for TEST-CREDENTIALS.md — **path only, no value**.
- **S8 — native/device verification is explicitly Blocked-on-Batu.** Capacitor shells, live
  ad fill, sandbox purchases, real Adjust/Firebase delivery. This card ships web/dev + Fake/
  Disabled CI only. Do not claim device behavior.
- **S9 — `wire.ts` is the single source of truth for the owned-mirror payload** (conductor
  comment 1 + the resolved analytics wire-contract memory). Wiring consumes
  `OWNED_ANALYTICS_WIRE_SCHEMA`; it does NOT re-declare the batch/event shape.
