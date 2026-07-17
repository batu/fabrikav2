---
title: "FTD-PARITY-1b [fix]: gate native Firebase behind config presence"
date: 2026-07-17
type: fix
slug: gate-native-firebase
origin: card:PFeMMmrh (card description — no brainstorm doc)
trello: https://trello.com/c/PFeMMmrh
status: planned
---

# FTD-PARITY-1b — Gate native Firebase behind config presence

## Problem

On a real iPhone, `com.basegamelab.find_the_dog.dev` crashes at launch with a
SIGABRT `NSException` in `+[FIRApp configure]` (crash captured 2026-07-17 during
`verify-device`). The SDK composition landed by commit `1b495f94` wires the
native `@capacitor-firebase/analytics` sink whenever `platform === 'ios'`, with
no check that Firebase is actually configured for the build. The dev bundle ships
**no** Firebase config — no `VITE_FIREBASE_*` env vars and no
`GoogleService-Info.plist` (gitignored, not downloaded for the dev bundle id) —
so the native Firebase SDK aborts at `configure()`.

## V1 semantics to restore

Read-only reference (V1, other repo):
`/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/analytics/firebaseApp.ts`
and `FirebaseAnalyticsSink.ts`.

V1 gates **every** native Firebase touch on `firebaseOptions()` returning
non-null — i.e. `VITE_FIREBASE_API_KEY` **and** `VITE_FIREBASE_PROJECT_ID` **and**
`VITE_FIREBASE_APP_ID` all present and non-empty. When config is absent it
selects a disabled no-op sink and makes **zero** native plugin calls; the app
boots fine.

## Current (buggy) behaviour

`games/find_the_dog/src/sdk/SdkContext.ts`:

```ts
if (platform === 'ios') {
  sinks.push(createFirebaseSink(createLazyFirebaseTransport(
    deps.firebaseAnalyticsLoader ?? (() => import('@capacitor-firebase/analytics')),
  )));
}
```

The gate is `platform === 'ios'` only. It ignores:
- Firebase env-config completeness (the V1 `firebaseOptions()` non-null check).
- `isNativePlatform` (native vs. web-served iOS).

Note: `createLazyFirebaseTransport` does **not** import the plugin at
construction — the `import('@capacitor-firebase/analytics')` only fires on the
first `logEvent`. So the JS composition itself does not eagerly import the
plugin. The device crash is the native `@capacitor-firebase` pod calling
`FirebaseApp.configure()` at app load; the JS-side contract this card owns is to
never construct or exercise the sink when config is absent. Whether the pod also
needs a native-side guard is an `ios/**` concern **out of scope** here (see Open
Questions) — this card restores the JS gate + proves it with a unit test, and
the conductor re-verifies on device.

## Fix

**File: `games/find_the_dog/src/sdk/SdkContext.ts`** (single functional change)

1. Add a small local helper that mirrors V1 `firebaseOptions()` completeness —
   read `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
   from the composition `env` (the already-threaded `Env` map, not
   `import.meta.env` directly, so tests can inject). Return a boolean
   `firebaseConfigPresent`.

   Reuse the existing `envString(...)` helper for trim/empty handling. Keep it a
   plain deterministic function — no LLM, no new module unless a transport module
   is warranted (see step 3).

2. Change the sink gate from `platform === 'ios'` to:

   ```ts
   if (platform === 'ios' && isNativePlatform && firebaseConfigPresent) {
     sinks.push(createFirebaseSink(createLazyFirebaseTransport(...)));
   }
   ```

   When the branch is skipped, no `createFirebaseSink`, no transport, and the
   dynamic `import('@capacitor-firebase/analytics')` is never reachable → zero
   plugin calls.

3. Confirm no top-level/eager plugin touch elsewhere: the loader stays lazy
   inside `createLazyFirebaseTransport` (already the case). Do **not** add a new
   transport module unless review shows the gating logic doesn't fit cleanly
   inline — prefer the smallest change (inline gate in `SdkContext.ts`).

**Audit (same crash class), report findings even if no change needed:**
- `createFirebaseRemoteConfigProvider()` — already gated on
  `platform === 'ios' && isNativePlatform`. Firebase Remote Config also depends
  on a configured Firebase app; if it makes a native call at construction it is
  the *same* crash class. Verify whether it is lazy and whether it too should
  require `firebaseConfigPresent`. Flag in the handoff.
- Adjust (`createAttributionProvider` + `readAdjustIosConfig`) — confirm the
  provider is only constructed/active when `adjustConfig.enabled` (config
  present). Currently `createAttributionProvider(platform, resolvedAdjustConfig)`
  runs regardless; confirm it no-ops without config rather than making a native
  call at boot.
- AppLovin (`createAdProvider` + `readAppLovinConfigForPlatform`) — confirm the
  provider does not make a native SDK init call at construction when the AppLovin
  key is absent.
- RevenueCat — already gated on `platform === 'ios' && isNativePlatform &&
  revenueCatKey !== null` and lazy-loaded; no change expected.

## Test

**File: `games/find_the_dog/tests/unit/sdk-context.test.ts`** (extend existing)

Add a case: compose on `platform: 'ios'`, `isNativePlatform: true`, `env: {}`
(empty — no `VITE_FIREBASE_*`), passing a spy `firebaseAnalyticsLoader`.
Assert:
- `context.selection.analyticsSinks` does **not** include `'firebase'`.
- the spy loader is never called (zero native plugin touches), even after
  emitting an event through `context.analytics.track(...)`.

Keep the existing "forwards iOS events through the lazy Firebase transport" case
passing by giving it a **complete** Firebase env (add `VITE_FIREBASE_API_KEY` /
`_PROJECT_ID` / `_APP_ID` to that test's `env`), since firebase now requires
config presence. Verify the other iOS composition test (line ~45) likewise
supplies config or is updated to expect no firebase sink — match its intent.

## Verify (must terminate)

```
cd games/find_the_dog && npx tsc --noEmit && npx vitest run
```

Device re-verify (launch dev bundle on iPhone, confirm no `+[FIRApp configure]`
crash) is the **conductor's** step, not this worker's.

## Contract / guardrails

- Touch only: `games/find_the_dog/src/sdk/**`,
  `games/find_the_dog/src/analytics/**` (firebase transport only if a module is
  truly needed), `games/find_the_dog/tests/unit/**`.
- **No** `package.json` edits. **No** `ios/**`. No other subsystems.
- Baseline: card HuNL2T8A merged onto local `main` awaiting gate; work on top of
  current `main` (HEAD `121b132d` at spawn).

## Open questions / risks

1. **Does the native pod still configure Firebase regardless of the JS gate?**
   The `@capacitor-firebase/analytics` iOS plugin may call
   `FirebaseApp.configure()` in its native `load()` independent of JS. If so, the
   JS gate alone will not stop the device crash and a native-side guard (in
   `ios/**`, a separate card) is required. This card delivers the JS gate + unit
   proof; the conductor's device re-verify will reveal whether a native follow-up
   is needed. Flag this explicitly in the handoff.
2. **Existing iOS tests** assume firebase sink present on iOS — they must be
   updated to supply Firebase config or expect absence, or they'll break.
