---
title: "AUDIT #15 — AdMob interstitial: ready-only display + re-arm (requirements)"
date: 2026-07-10
trello: https://trello.com/c/VWLRgHuu
card: VWLRgHuu
stage: todo → brainstormed
status: requirements-locked
task_class: ads-lifecycle-contract
touches:
  - packages/sdk/src/ads/AdMobProvider.ts
  - packages/sdk/src/ads/AdMobProvider.test.ts
  - packages/sdk/src/ads/AdProvider.ts (contract — read; extend only if forced)
---

# AdMob interstitial: ready-only + re-arm — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. **No code is
written at this stage.** This doc front-loads what the plan and worked stages need: the
prior-art parity target, the exact behavioral contract, the AdMob-specific mechanics that
make this *not* a copy-paste of AppLovin, and the open decisions the plan must resolve
before implementation.

## The headline that reframes the card

**The correct behavior already ships in the sibling provider.** `AppLovinMaxProvider`
already implements exactly the ready-only + re-arm semantics this card asks for:

- `maybeShowInterstitial` (`AppLovinMaxProvider.ts:166-209`): checks the frequency cap,
  and if no ad is loaded it fires a **background** `void preloadInterstitial()` and
  **returns `false` immediately** — it never awaits the network. It shows only an
  **already-loaded** ad, and in `finally` it consumes the ad (`interstitialLoaded = false`)
  and **re-arms** with another `void preloadInterstitial()`.

AdMob's `maybeShowInterstitial` (`AdMobProvider.ts:369-416`) is the **divergent** one:

- On the not-loaded path it does `await this.preloadInterstitial()` (line 383) — a blocking
  network wait — then shows whenever it resolves, potentially long after the caller's
  intended moment (level already started, audio already playing).
- There is **no re-arm** after dismissal/failure: `finally` sets `interstitialLoaded = false`
  (line 414) but never triggers a fresh preload. The next opportunity pays the full blocking
  load again.
- There is **no startup/eligibility prewarm**: the first ad opportunity is always a cold load.

So the real job is **bring AdMob's interstitial into parity with AppLovin's already-shipped
ready-only contract**, honoring AdMob-specific mechanics that AppLovin does not have. This is
a *converge-to-sibling*, not a *design-from-scratch*. Naming it this way keeps the worked
stage from re-inventing a contract that already survived contact with a shipping game — and
points every design question at "what does AppLovin do, and where must AdMob legitimately
differ?"

### Note: the card's contract path is wrong

The card body cites `packages/sdk/src/ads/provider.ts` as the consumer contract. That file
does not exist; the actual provider-agnostic interface is **`packages/sdk/src/ads/AdProvider.ts`**.
The plan stage should treat `AdProvider.ts` as the contract of record.

## Goal

Make AdMob's interstitial **ready-only and self-re-arming**, matching AppLovin's contract:

1. `maybeShowInterstitial` makes an **immediate** ready / not-ready decision — it never
   awaits a network preload, and it can never display an ad after its call context has passed.
2. A ready ad displays **once**; dismissal or show-failure **re-arms exactly once**;
   concurrent `maybeShowInterstitial` calls do **not** duplicate a show.
3. Background prewarm exists so the first eligible opportunity can find a ready ad.
4. Re-preload after dismissal/failure has **bounded retry / backoff** (not an unbounded
   retry storm).

## The behavioral contract (what "done" means)

Restated and sharpened from the card's acceptance criteria, with parity source and the
AdMob-specific delta each one carries:

| # | Requirement | Parity source | AdMob delta the plan must handle |
|---|---|---|---|
| AC1 | `showInterstitial` never waits on network; cannot display after its call context passed. | AppLovin `:180-183` (background preload + immediate `return false`). | Replace the `await preloadInterstitial()` at `:383` with a fire-and-forget background arm + immediate `false`. |
| AC2 | Ready ad shows once; dismissal/failure re-arms exactly once; concurrent shows don't duplicate. | AppLovin `finally` re-arm `:205-207`. | AdMob's `showInterstitial()` resolves on **present, not dismiss** (see below) → re-arm must be driven off the **Dismissed / FailedToShow lifecycle events**, and a **show-in-flight guard** is needed since `lastInterstitialShownAt` is only set *after* present. |
| AC3 | Tests cover: init, load failure/backoff, dismissal, app background/foreground, disposal. | AppLovin/AdMob test suites (fake adapter + injected clock). | Backoff, app-lifecycle, and disposal are **new seams with no existing coverage** — see open decisions. |
| AC4 | Later stages need native-device proof or an explicit release gate; mocks are not native proof. | — | This stage and the plan/worked stages are mock-only. The pipeline **must** carry a native-proof or explicit-release-gate task downstream (recorded as a Remaining item). |

### The pivotal AdMob-specific mechanic: show resolves on *present*, not *dismiss*

AppLovin's `showInterstitial` promise resolves on **dismiss**, so re-arming in `finally` is
correct — the ad is genuinely finished. AdMob's native `showInterstitial()` resolves on
**present**; AdMob already compensates with `createFullScreenAdDismissalWaiter` (`:513-566`)
that awaits `Dismissed` / `FailedToShow`. But that waiter is **only constructed when
lifecycle hooks are present** (`:390`). This is the crux of "lifecycle events must re-arm
**exactly once**": re-arm cannot simply live in `finally` (which, on the no-lifecycle-hooks
path, runs right after *present* while the ad is still on screen). The plan must decide how
re-arm is triggered so it fires **once per completed ad** regardless of whether lifecycle
hooks are injected.

## Open decisions the plan stage must resolve (do NOT decide here)

These are genuine forks, each with a recommended default drawn from AppLovin parity + the
CLAUDE.md "reuse compatible AppLovin semantics without forcing provider-specific internals
into the common API" guidance. The plan picks and justifies.

1. **Re-arm trigger & "exactly once."** Persistent `Dismissed`/`FailedToShow` listener that
   re-preloads, vs. re-arm in `finally` after `dismissal.wait()`. *Recommended:* drive re-arm
   off the dismissal path so it is one-per-ad; ensure the dismissal waiter (or an equivalent
   always-on listener) exists even without lifecycle hooks. Must not double-arm when both a
   listener and `finally` could fire.

2. **Prewarm-on-init vs. lazy background arm.** The card says "prewarm on
   initialization/eligibility"; AppLovin arms **lazily** on the first `maybeShow` (not on
   init). *Recommended:* add a background arm on init success **and** keep the lazy arm, so
   the first opportunity is warm without changing the shared contract. Decide whether AppLovin
   should gain the same prewarm for parity or whether AdMob's addition stays local (leaning
   local to keep blast radius on AdMob only).

3. **Backoff policy (AC3 "load failure/backoff").** AppLovin has **no** backoff — it just
   re-preloads once. AdMob's `FailedToLoad` listener (`:204-207`) only clears the flag.
   *Recommended:* bounded exponential-ish backoff with a small max-attempt count, resetting
   on any success. Needs an **injectable timer/scheduler** for deterministic tests — match
   the existing "inject `now`, no fake timers" convention (`AdMobProviderOptions.now`,
   `:113-119`). Define: base delay, multiplier, max attempts, reset condition.

4. **App background/foreground (AC3).** No provider handles Capacitor `App` resume/pause
   today. AdMob interstitials can go stale after long backgrounding. *Recommended:* on
   resume, if not loaded, trigger a background arm; do **not** show anything automatically.
   Decide whether to depend on `@capacitor/app` (a new seam that needs the same injectable-
   adapter treatment) or to treat foreground re-arm as out of scope with a documented reason.

5. **Disposal (AC3).** No provider has `dispose()`/teardown today; listeners are registered
   and never removed (except the dismissal waiter). *Recommended:* add an AdMob-internal
   `dispose()` that removes registered listeners and cancels any pending backoff timer.
   Decide whether `dispose` joins the shared `AdProvider` interface (affecting AppLovin +
   Disabled) or stays AdMob-local. *Lean AdMob-local* per the "don't force provider-specific
   internals into the common API" rule, unless a shared consumer needs it.

6. **Concurrent-show guard (AC2).** Add an in-flight `showInProgress` flag so a second
   `maybeShowInterstitial` during an active show returns `false` immediately. Note AppLovin
   has the same latent gap; keep the fix AdMob-local unless the plan opts to fix both.

## Scope boundaries / non-goals

- **AdMob only.** Do not refactor AppLovin except where a shared-contract decision (dec. 5)
  forces a consistent change; if it does, that is a kit-blast-radius change and every shared
  consumer must be re-covered.
- **Interstitial only.** Rewarded and banner lifecycles are out of scope; rewarded already
  awaits-then-shows by design (`:476-479`) because the caller *wants* to wait for a hint.
- **No native rendering / device work in the mock stages.** No new dependencies without
  explicit approval (`@capacitor/app` in dec. 4 is a proposal, not a decision).
- **No API surface expansion** unless a decision above forces it; prefer AdMob-internal
  mechanics.

## Risks & things that will fight the worker

- **"Exactly once" re-arm is subtle** because of the present-vs-dismiss asymmetry and the
  conditional dismissal waiter — the most likely place for a double-arm or a never-arm bug.
- **Backoff + app-lifecycle + disposal are three new testable seams** with no prior art in
  this repo; each needs an injected clock/timer/adapter to stay deterministic (no fake
  timers, per convention).
- **AC4 native proof is unavoidable downstream.** Mocked green suites are necessary but not
  sufficient; the pipeline must not close this card on mock evidence alone.

## Acceptance command (unchanged from card)

SDK ad tests + typecheck, plus root unit / audit / eslint. Commit only. No PR, no native
device work at these stages.
