---
title: "packages/sdk — ads: provider-agnostic AdProvider + AdMob & AppLovin MAX adapters (requirements)"
date: 2026-07-06
trello: https://trello.com/c/M3ngFJXt
card: M3ngFJXt
depends_on: Fw1NtsCr
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika
---

# packages/sdk: ads — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. No code is written
at this stage. This doc front-loads what the `worked` stage needs: (1) a prior-art ledger
mapping every v1 READ-ONLY source to take/adapt/reject, (2) the one interface + N adapters
shape with the lifecycle state machine each adapter runs, (3) the cadence policy factored as
a **pure, unit-testable function** from FTD's evidence, and (4) the scaffolding + dependency
decisions the acceptance command depends on.

## The headline that reframes the card

The card says "generalize core's AdMob-only `AdMobAdapter` into a provider-agnostic
`AdProvider`." **That generalization already exists in v1 — stranded in find_the_dog.**
`games/find_the_dog/src/ads/AdProvider.ts` (20 lines) is already the provider-agnostic
lifecycle interface, and FTD already wrote all three adapters against it
(`AppLovinMaxProvider` 425, `AdMobProvider` 57, `DisabledAdProvider` 50) plus a
platform-selection factory (`Service.ts` 110). Research `04` claim 5 confirms: 899 lines
"parallel to (not built on) core," AppLovin refs zero in the other 3 games.

So the real job is **not** to invent an abstraction — it's to **lift FTD's already-correct
`AdProvider` interface + its adapters into `@fabrikav2/sdk/ads`, decoupled from FTD-specific
imports** (`@fabrika/core/ads`, `../audio/AudioManager`, `../analytics/AnalyticsService`,
`../config/KeymasterConfig`), and to fold the two "adapter" layers that today sit at
different altitudes into one clean stack. This is a *carry-and-decouple*, like haptics —
not a *design-from-scratch*. Naming the failure precisely (adoption/stranding, not absence)
keeps the worked stage from re-deriving an interface that already survived contact with a
shipping game.

### Two "adapter" concepts live at different altitudes — reconcile them

| Layer | v1 artifact | What it is |
|---|---|---|
| **High-level lifecycle interface** | FTD `AdProvider.ts` (20) | `init / preload{Interstitial,Rewarded} / maybeShowInterstitial / show{Banner,RewardedAd} / hideBanner / showPrivacyOptions?`. **This is the SDK's `AdProvider`.** |
| **Low-level native-bridge wrapper** | core `AdService.ts` `AdMobAdapter` (line 41, 11 methods) | Thin 1:1 map onto `@capacitor-community/admob` calls, injected into `AdService` for testing. **This becomes the AdMob adapter's private seam**, not the public interface. |

FTD's `AdMobProvider` (57) is a *shim*: it dynamic-imports `@fabrika/core/ads` and delegates
to `createAdService`. In v2 there is no `@fabrika/core`, so the AdMob adapter must **carry
core's `AdService.ts` state-machine logic directly** (the 547-line interstitial/rewarded/
banner lifecycle + its injectable `AdMobAdapter` native seam), presenting the `AdProvider`
face. The shim collapses into the adapter.

## Goal

Stand up `@fabrikav2/sdk/ads`:

- **`AdProvider`** interface (lifted from FTD `AdProvider.ts`) — rewarded + interstitial
  (+ banner, which both adapters already implement for free) lifecycles.
- **`admob` adapter** — core `AdService.ts` logic carried behind `AdProvider`, with its
  injectable native `AdMobAdapter` seam preserved for unit tests.
- **`applovin-max` adapter** — FTD `AppLovinMaxProvider.ts` carried, with `AppLovinConfig`,
  `AppLovinMaxPlugin`, and the `withTimeout` util it depends on.
- **`disabled` adapter** — FTD `DisabledAdProvider.ts` carried as-is (dev/tests/web).
- **cadence policy** — a pure `shouldShowInterstitial(...)` function extracted from FTD's
  `triggerLevelFinale` (research `07` R28): `everyNLevels / minLevel / minIntervalS`.
- **`DeathAdCoordinator`** — core's (90 lines) carried; it's already provider-agnostic.
- a generic **`createAdProvider(platform, config, factories)`** selection function (FTD's
  `Service.ts` logic, decoupled from FTD audio/analytics).

Acceptance: both adapters compile behind one interface; lifecycle state machines unit-tested
(loading/ready/showing/dismissed/failed incl. reward-grant); cadence policy unit-tested;
`typecheck` + `test:unit` green for `packages/sdk`.

## Constraints (inherited, non-negotiable)

- **v1 is READ-ONLY.** Read from `/Users/base/dev/appletolye/fabrika`; never edit it.
- **Files touched: `packages/sdk/**` (ads/ subtree only).**
- **Native verification is NOT this card.** No Capacitor shell exists yet — unit-level only,
  with mocked plugins. Both adapters already inject their native seam (`AdMobAdapter` /
  `AppLovinMaxPlugin`), so fakes plug in with zero production-code changes.
- Test creds: FTD's config values are sandbox/test-only and are a *later* concern — this card
  ships no real IDs (DECISIONS §SDK test credentials; use each SDK's test mode).
- Advance exactly one column; no PRs (conductor merges); no secrets.
- UI guardrail #2 (zero literal colors/copy/asset paths in `packages/ui`) is **N/A here** —
  this is `packages/sdk`, no rendering surface. Noted so the next worker doesn't chase it.

## Prior-art ledger — take / adapt / reject

| Source (READ-ONLY) | Lines | Verdict |
|---|---|---|
| `games/find_the_dog/src/ads/AdProvider.ts` | 20 | **TAKE AS-IS** → `src/ads/AdProvider.ts` (the interface; already provider-agnostic) |
| `games/find_the_dog/src/ads/AppLovinMaxProvider.ts` | 425 | **TAKE**, retarget imports (`@fabrika/core/ads` → local `FullScreenAdLifecycle`; keep injected `plugin`/`now`/`logger`/`lifecycle`/`onAdRevenuePaid` seams) |
| `games/find_the_dog/src/ads/AppLovinConfig.ts` | 171 | **ADAPT** — decouple from `KeymasterConfig`/`LegalLinks` (FTD-specific IDs & URLs); keep the env-parsing + discriminated-union `AppLovinConfigResult` shape. Ship **no real keys** (test/sandbox only). |
| `games/find_the_dog/src/ads/AppLovinMaxPlugin.ts` | 66 | **TAKE AS-IS** (`registerPlugin<AppLovinMaxPlugin>('AppLovinMax')` + option/result types) |
| `games/find_the_dog/src/ads/DisabledAdProvider.ts` | 50 | **TAKE AS-IS** → `src/ads/DisabledAdProvider.ts` |
| `packages/core/src/ads/AdService.ts` | 547 | **TAKE the state machine**, inline into the `admob` adapter presenting `AdProvider`; keep the injectable `AdMobAdapter` native seam + `FullScreenAdLifecycle`. **ADAPT**: inject `now: () => number` (see S1). |
| `packages/core/src/ads/AdConfig.ts` | 124 | **ADAPT** — keep the shape (`AdConfig`, unit-id getters); the hard-coded values here are **Google's public test IDs** (`ca-app-pub-3940256099942544/*`) — safe to carry as test defaults. |
| `packages/core/src/ads/DeathAdCoordinator.ts` | 90 | **TAKE AS-IS** — depends only on `DeathAdService = {maybeShowInterstitial, preloadInterstitial}` + a `game:over` event bus. Retarget the bus type to `@fabrikav2/kernel/emitter`. |
| `games/find_the_dog/src/ads/AdMobProvider.ts` | 57 | **REJECT as a file** — it's a dynamic-import shim over `@fabrika/core/ads`; its role is absorbed by the `admob` adapter carrying the AdService logic directly. |
| `games/find_the_dog/src/ads/Service.ts` | 110 | **ADAPT the selection logic only** → generic `createAdProvider(platform, config, factories)`; **reject** FTD couplings (`setMusicPausedForAd` → becomes an injected `FullScreenAdLifecycle`; `AnalyticsService.adRevenuePaid` → the injected `onAdRevenuePaid` callback; the module-level `adService` singleton). |
| `games/find_the_dog/src/utils/withTimeout.ts` | 37 | **TAKE** (`withTimeout` + `TimeoutError` + `isTimeoutError`) — AppLovin provider depends on it. Home decision in S3. |

## Part 1 — The `AdProvider` interface (lift, don't invent)

Carried verbatim from FTD `AdProvider.ts` (the naming already matches the card):

```ts
export interface RewardedAdResult { granted: boolean; }
export interface MaybeShowInterstitialOptions { minIntervalMs?: number; }

export interface AdProvider {
  readonly providerName: string;                 // 'admob' | 'applovin-max' | 'disabled'
  init(): Promise<void>;
  preloadInterstitial(): Promise<void>;
  maybeShowInterstitial(options?: MaybeShowInterstitialOptions): Promise<boolean>;
  showBanner(): Promise<boolean>;
  hideBanner(): Promise<void>;
  preloadRewarded(): Promise<void>;
  showRewardedAd(): Promise<RewardedAdResult>;
  showPrivacyOptions?(): Promise<boolean>;        // optional; AppLovin has it, AdMob returns false
}

export type FullScreenAdType = 'interstitial' | 'rewarded';
export interface FullScreenAdLifecycle {          // lifted from core AdService (injected hook)
  onFullScreenAdStarted?(adType: FullScreenAdType): void;
  onFullScreenAdFinished?(adType: FullScreenAdType): void;
}
```

**Non-blocking contract (load-bearing, keep it):** every method swallows its own errors and
resolves to a safe value (`false` / `{granted:false}` / void). Both v1 providers document
this repeatedly — "gameplay must not be blocked by ad failure." The worked stage must NOT
"improve" this into throwing; callers `void`-fire these.

## Part 2 — The lifecycle state machine each adapter runs (the AC's core)

Both `admob` (core `AdService`) and `applovin-max` (FTD provider) run the **same state
machine shape**, which is exactly what the AC wants unit-tested
(loading → ready → showing → dismissed/failed, incl. the reward-grant path):

Per-fullscreen-slot state (interstitial, rewarded, banner):
- `initialized` + a single in-flight `initPromise` (dedup; double `init()` → one native init)
- `<slot>Loaded` boolean + a single in-flight `<slot>PreloadPromise` (dedup)
- `lastInterstitialShownAt` (frequency cap)
- `bannerVisible` / `bannerRequestInFlight`

Transitions to test (with an **injected fake plugin/adapter**, no native runtime):

| Behavior | AdMob evidence | AppLovin evidence |
|---|---|---|
| **init idempotent** | `initPromise` guard L201–239 | `initPromise` guard L84–133 |
| **init failure → not initialized** (swallowed) | L229–232 | L109–125 (+ `permanentlyDisabled` on non-timeout only, tolerant of transient timeout) |
| **preload → loaded=true; failure → false** | L264–276 / L419–431 | L144–157 / L260–273 |
| **maybeShowInterstitial: not-loaded → false** (+ bg preload) | preloads then shows L359–365 | returns fast + bg preload L181–184 |
| **within cap → false** | L354–357 (`Date.now()`) | L171–173 (injected `now`) |
| **past cap + loaded → show, set lastShownAt, consume load** | L374–392 | L186–209 |
| **showRewardedAd granted path** | `reward.amount > 0` L471–472 | `result.granted === true` L302 |
| **cancel/fail → {granted:false}, load consumed** | L475–484 | L303–309 |
| **dismissal wait** (reward can arrive before dismiss) | `createFullScreenAdDismissalWaiter` L487–540 | native show resolves on dismiss (comment L17–28) |
| **lifecycle hooks fire once, start+finish, errors swallowed** | `beginFullScreenAd` L142–159 | `beginFullScreenAd` L331–348 |

**Test seam:** inject a fake `AdMobAdapter` (11 async methods) resp. fake `AppLovinMaxPlugin`
(8 async methods) via the constructor — both are **already injectable** in v1 (AdService
`adapter` param; AppLovin `options.plugin`). Fakes return scripted results / throw to drive
each branch. No jsdom, no Capacitor.

## Part 3 — Cadence policy (pure function, from FTD evidence R28)

The card names the policy explicitly: `interstitialEveryNLevels / interstitialMinLevel /
interstitialMinIntervalS`. Its **decision** today is inline in FTD `GameScene.ts:1716–1721`
(read directly), tangled with `remoteConfigService` + `gameState`:

```ts
const shouldTry =
  everyNLevels > 0 &&
  levelsCompletedThisSession % everyNLevels === 0 &&
  currentLevelIndex + 1 >= minLevelNumber;                       // level floor
// …then: maybeShowInterstitial({ minIntervalMs: minIntervalS * 1000 })  // frequency cap
```

Extract the **level-cadence decision** as a pure function (the card's "cadence policy
unit-tested"), leaving the *time* cap where it belongs (inside `maybeShowInterstitial`'s
`lastInterstitialShownAt` gate):

```ts
export interface InterstitialCadencePolicy {
  everyNLevels: number;   // 0 disables entirely
  minLevel: number;       // 1-based level floor
  minIntervalS: number;   // → minIntervalMs passed to maybeShowInterstitial
}
/** Pure: does the level counter alone permit an interstitial attempt? */
export function shouldShowInterstitial(
  policy: Pick<InterstitialCadencePolicy, 'everyNLevels' | 'minLevel'>,
  state: { levelsCompletedThisSession: number; currentLevel: number },  // currentLevel 1-based
): boolean;
```

Cadence tests (pure, deterministic):
- `everyNLevels=3` → fires at completed-count 3,6,9; not 1,2,4,5.
- `currentLevel < minLevel` → never (floor), even on an every-Nth completion.
- `everyNLevels=0` → never (disabled).
- combined: floor + modulo both required.
- the **time cap** is tested separately on the adapter via injected `now`: two shows inside
  `minIntervalMs` → second returns `false`; past the interval → allowed.

This keeps the pure decision testable with plain arithmetic and the time cap testable with a
fake clock — no fake timers needed.

## Part 4 — Provider selection + DeathAdCoordinator

- **`createAdProvider(platform, config, factories)`** — generalize FTD `Service.ts`'s
  ios→applovin, android→applovin-or-admob-fallback, web→disabled selection. Drop the three
  FTD couplings (audio pause, analytics revenue report, singleton) — they become injected
  (`FullScreenAdLifecycle`, `onAdRevenuePaid`) or the game's concern. Factories stay injected
  so selection is unit-testable without instantiating real providers.
- **`DeathAdCoordinator`** (core, 90 lines) **fits and is kept.** It depends only on
  `DeathAdService = {maybeShowInterstitial, preloadInterstitial}` (any `AdProvider` satisfies
  it) + a `game:over` event bus with double-fire guard and per-step timeout. Retarget its
  `GameOverEventBus` to `@fabrikav2/kernel`'s typed emitter. Its existing tests
  (`DeathAdCoordinator.test.ts`) port with import-path edits. block_blast consumed it cleanly
  (research `04`: "cleanest") — evidence it's already game-agnostic.

## Scaffolding gaps the `worked` stage MUST close (else acceptance fails)

Verification command (card):
`npm run typecheck --workspace=packages/sdk && npm run test:unit --workspace=packages/sdk`

Unlike the haptics card, `packages/sdk` **already has** `scripts` (`typecheck`/`test:unit`)
and an `exports` map (haptics/audio landed them) + a `tsconfig.json` extending
`configs/tsconfig.base.json`. Remaining:

1. **Add `"./ads": "./src/ads/index.ts"`** to `packages/sdk/package.json` `exports`, and
   re-export from `src/index.ts` (match haptics/audio).
2. **DECISION — AdMob native dep.** The `admob` adapter's native seam imports from
   `@capacitor-community/admob` (types: `AdOptions`, `RewardAdOptions`, the
   `*AdPluginEvents` enums, `AdMobRewardItem`). It is **not** a declared dep today.
   `@capacitor/core` **is** already an optional peer (haptics added it) and covers AppLovin's
   `registerPlugin`. Options:
   - **(A)** add `@capacitor-community/admob` as an **optional peer dep** (matches the
     haptics precedent: native shell supplies it, unit tests mock it). **Dependency addition
     — flag for conductor/Batu** per CLAUDE.md. Recommended.
   - **(B)** hand-declare the ~6 admob types locally so the SDK core stays dep-light. Avoids
     the dep but risks drift from the real plugin's types. Fallback if (A) is blocked.
   Either way, tests inject a fake `AdMobAdapter` and never import the real plugin — so AC is
   reachable under both. The `@capacitor-community/admob` runtime is only reached via the
   `createDefaultAdMobAdapter` factory (dynamic `import()`), which no unit test exercises.
3. **`withTimeout` home** (S3) — carry into `src/ads/` (minimal, matches "surgical"); flag
   `@fabrikav2/kernel` as its eventual shared home (attribution/analytics/iap will all want
   it). Do not add a kernel dependency for it in *this* card.
4. **No `vitest.config.ts` needed** — kernel/haptics ship none; the default `**/*.test.ts`
   glob + root `vitest ^4` / `typescript ^5.7` cover it. `happy-dom` is a root dev dep if a
   DOM global is ever needed (it isn't for the mocked-plugin unit slice).

## Acceptance criteria (restated) & how they'll be verified

- [ ] `AdProvider` interface + `admob`, `applovin-max`, `disabled` adapters all **compile
      behind one interface** — `npm run typecheck --workspace=packages/sdk`.
- [ ] **lifecycle state machines unit-tested** for both adapters: loading/ready/showing/
      dismissed/failed **incl. the reward-grant path** — via injected fake plugin/adapter.
- [ ] **cadence policy unit-tested** — pure `shouldShowInterstitial` (every-N + floor +
      disabled) and the adapter time-cap via injected `now`.
- [ ] `DisabledAdProvider` no-ops every method (`showRewardedAd → {granted:false}`).
- [ ] `package.json` `exports` exposes `./ads`; no real ad-unit IDs / SDK keys committed
      (Google public test IDs only).

## Surprises / open items to carry forward

- **S1 — core `AdService` uses `Date.now()` directly (L354, L377), so its frequency cap is
  not deterministically unit-testable.** FTD's AppLovin provider already fixed this by
  injecting `now: () => number` (L77). The v2 `admob` adapter should **adopt the injected-now
  pattern** so the time-cap test needs no fake timers. Minimal, well-precedented adaptation —
  not a redesign.
- **S2 — the interface the card asks us to "generalize into" already exists.** FTD did the
  generalization; it's stranded, not absent (research `04` claim 5). The work is carry +
  decouple, not design. Guard against the worked stage re-inventing `AdProvider` from
  `AdMobAdapter` and diverging from the shape FTD already shipped and tested.
- **S3 — `withTimeout` is a cross-SDK primitive.** Ads, attribution, analytics, and IAP all
  bound native-bridge calls with it (its own doc comment lists all four). This card carries it
  locally into `ads/`; the attribution/analytics/iap cards will want it too → real home is
  `@fabrikav2/kernel`. Flag so a later card promotes it instead of quadruplicating.
- **S4 — banner is in the interface but outside the card's headline AC** (rewarded +
  interstitial). Both adapters implement `showBanner`/`hideBanner` for free, so they carry
  along; banner gets light lifecycle coverage (visible/in-flight guards) but is not the focus.
- **S5 — AppLovin's `permanentlyDisabled` is deliberately more tolerant than its siblings.**
  It stays retryable after a *timeout* (transient cold-start) but hard-disables on a
  *definitive* plugin error (L109–125, with a paragraph explaining why ads differ from
  analytics/attribution). Preserve this asymmetry verbatim — it's a revenue-protection
  decision, and it's a distinct tested branch (timeout vs non-timeout init failure).
- **S6 — AdMob dep addition is the one decision the worked stage can't make unilaterally.**
  Same class as haptics' Capacitor decision (that card's S6). Pre-flag `@capacitor-community/
  admob` to Batu/conductor; recommendation (A) optional-peer, tests mock it.
- **S7 — provider selection couples to game concerns in v1; those become injections.** FTD's
  `Service.ts` hard-wires music-pause, analytics revenue reporting, and a module singleton.
  In v2 these are `FullScreenAdLifecycle` (already injected in both providers via
  `onFullScreenAdStarted/Finished`) and the `onAdRevenuePaid` callback. The SDK ships
  primitives + a selection function; the *game* wires audio ducking (via `@fabrikav2/sdk/
  audio`'s `duck`/`unduck` — S1 of the AudioBus doc) and analytics.
- **S8 — the ad-revenue-paid normalizer travels with the AppLovin adapter.**
  `normalizeAdRevenuePaidEvent` (L383–425) validates + shapes AppLovin's revenue events for
  analytics. It's provider-specific (AppLovin-only signal), so it stays in the adapter and
  surfaces via the injected `onAdRevenuePaid` callback — the analytics *sink* is the analytics
  card's job, not this one.
