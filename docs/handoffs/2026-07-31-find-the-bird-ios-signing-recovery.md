# Find the Bird iOS signing recovery

## Mission

Recover headless iOS signing for Find the Bird on the existing Mac, build the
normal player artifact, install it on Batu's physical iPhone 12, and prove it
does not run the automated verification tour.

## Repository state

- Repo: `/Users/base/dev/appletolye/fabrikav2`
- Worktree: `/Users/base/dev/appletolye/fabrikav2/.worktrees/feat-find-the-bird-reskin`
- Branch: `feat/find-the-bird-reskin`
- Recorded HEAD: `c63bf2da0795378c5760e70c427ce09431778486`
- Game: `games/find_the_bird`
- The worktree contains substantial unrelated in-progress changes. Do not
  clean, reset, revert, or broadly stage them.

## Proven diagnosis

The Mac already had usable signing material. The misleading failure came from
treating the parenthesized suffix in the `Apple Development` identity display
name as the provisioning team ID. It was not the correct `DEVELOPMENT_TEAM` for
the cached profile.

The proven local pairing is:

- Development team: `42L77JAX72`
- Cached development profile/bundle slot: `com.baseardahan.hiddenobj`
- Physical device UDID: `00008101-000410EC3EF9001E`

Read the shared diagnostic reference first:

`/Users/base/dev/appletolye/agency/src/agency/catalog/skills/compound-engineering/common-debugging-problems/references/ios-signing-identity-team-mismatch.md`

Do not start with a new Apple login, CSR, certificate, or provisioning profile.
Inspect the last known-good signed app and cached profile metadata first. Never
print, log, store, or repeat passwords or private key material.

## Automation artifact trap

`tools/verify-device` deliberately builds with:

```text
VITE_ENABLE_TEST_HARNESS=true
VITE_INSITU_TOUR=allstates
```

That artifact installs and renders successfully but drives the game by itself.
A valid signature does not prove it is a player build. Build the normal artifact
with those variables explicitly absent.

## Proven build and install sequence

From `games/find_the_bird`:

```sh
env -u VITE_ENABLE_TEST_HARNESS \
    -u VITE_INSITU_TOUR \
    -u VITE_INSITU_TOUR_STATE \
    npx vite build

env -u VITE_ENABLE_TEST_HARNESS \
    -u VITE_INSITU_TOUR \
    -u VITE_INSITU_TOUR_STATE \
    npx cap sync ios

xcodebuild -quiet \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination id=00008101-000410EC3EF9001E \
  -derivedDataPath ios/App/build \
  build \
  DEVELOPMENT_TEAM=42L77JAX72 \
  PRODUCT_BUNDLE_IDENTIFIER=com.baseardahan.hiddenobj \
  CODE_SIGN_STYLE=Automatic
```

Verify and install only the produced artifact:

```sh
APP=ios/App/build/Build/Products/Debug-iphoneos/App.app
codesign --verify --deep --strict "$APP"
plutil -extract CFBundleIdentifier raw -o - "$APP/Info.plist"
xcrun devicectl device install app \
  --device 00008101-000410EC3EF9001E "$APP"
xcrun devicectl device process launch \
  --device 00008101-000410EC3EF9001E \
  --terminate-existing com.baseardahan.hiddenobj
```

The bundle ID check must return `com.baseardahan.hiddenobj`.

## Physical-device acceptance

1. Capture the real iPhone through the repository's device lane or DVT.
2. Open and inspect the full-resolution capture.
3. Wait at least eight seconds and capture again.
4. Confirm both captures show the same user-controlled screen; animation deltas
   are acceptable, automatic navigation is not.
5. Inspect installed apps. If a mistaken automated build exists under a second
   bundle ID, resolve the exact target before removing only that install. State
   that uninstalling deletes its app data.

The prior successful correction removed the mistaken
`com.basegamelab.find_the_bird.dev` install after the normal
`com.baseardahan.hiddenobj` build was verified.

## Definition of done

- Normal player bundle builds successfully with the existing cached signing
  context.
- Signature and bundle ID are verified before install.
- That exact artifact is installed and launched on Batu's iPhone 12.
- Two timed physical-device captures prove the app remains under user control.
- No duplicate automated Find the Bird icon remains.
- Unrelated dirty worktree changes remain untouched.

If any gate is missing, report the task as blocked or partial, not complete.
