# Handoff: FTD renders a black level board on Android (Pixel 6a)

**Date:** 2026-07-28
**Game:** `games/find_the_dog` (FTD) in the fabrikav2 monorepo
**Status:** app boots on Android; gameplay scene runs; the level artwork never appears
**Approach requested by the user:** TDD — write a failing test that captures the defect before fixing it

---

## Mission

FTD now launches on a physical Android device, but entering a level shows a **black board with a
green diagonal staircase artifact**. The HUD and tutorial overlay draw correctly on top, so Phaser
is alive and the scene is running — only the level textures are missing. Find the root cause, write
a regression test that fails against current `main`, then fix it.

## Repo and starting point

- **Repo:** `/Users/base/dev/appletolye/fabrikav2` (git repo; the primary checkout sits on branch
  `feat/marble-run-ad-config-remote-gating` and has unrelated uncommitted work — **do not touch it**)
- **Base branch:** `main`, at `2079e9e9` (contains `ff9d7e7d`, the commit that made Android boot at all)
- **Create your own worktree off `main`.** Existing convention — worktrees live in
  `fabrikav2/.worktrees/<branch-with-dashes>`:

```sh
cd /Users/base/dev/appletolye/fabrikav2
git fetch origin main
git worktree add -b fix/ftd-android-black-level-art \
  .worktrees/fix-ftd-android-black-level-art main
cd .worktrees/fix-ftd-android-black-level-art
# node_modules are NOT installed in a fresh worktree — symlink, do not reinstall:
ln -s ../../node_modules node_modules
ln -sfn ../../../../games/find_the_dog/node_modules games/find_the_dog/node_modules
git status --short   # confirm both symlinks are ignored before any `git add -A`
```

The bare `node_modules` gitignore pattern exists, but verify — a symlink swept into a commit once
replaced the main checkout's real `node_modules` with a circular self-link.

## What is already known

### The symptom

On a Pixel 6a (`adb` device id `27091JEGR22183`, package `com.basegamelab.find_the_dog.dev`):

- Home menu renders perfectly (saga map, currency pills, Shop/Play/Settings bar).
- Tapping "Play Now" reaches GameScene: HUD reads `0/26`, 3 hearts, 3 hints, and the
  "Tap the dog" tutorial bubble renders — **but the board area is solid black with a green
  diagonal staircase pattern**.
- The same commit renders correctly on the iPhone 12. This is **Android-only**.

### The one hard clue

`adb logcat` from the app process:

```
I Capacitor/Console: ... Msg: [ads:disabled] FTD does not compose AdMob        <- expected, fine
W Capacitor/Console: File: .../bootstrap-Ds9VGB8X.js - Line 6579 -
                     Msg: Home level prewarm failed [object DOMException]
```

That warning comes from `games/find_the_dog/src/scenes/HomeScene.ts:308`. **The real exception
message is swallowed** by `[object DOMException]` stringification — recovering it (log
`error.name` + `error.message`, or catch it in DevTools) is probably the single highest-value
first move.

Note the code comment at `HomeScene.ts:291-295`: prewarm is explicitly *best-effort*, and any
failure is supposed to fall back to `GameScene.preload` loading textures normally. **That fallback
is also failing** — so the prewarm error is likely a symptom of a shared root cause, not the cause
itself. Do not fix only the prewarm path.

### What has been ruled out

- **Not missing assets.** `bg_01.webp` and `color.webp` are present and are 1170x2560. The APK is
  66 MB with 70 MB of `android/app/src/main/assets/public`, and `assets/public/levels/` contains
  the level directories. Assets ship.
- **Not the CDN.** `VITE_CDN_ENABLED=false` means `getCdnOrigin()` returns `null`
  (`src/config/cdn.ts:36,47-48`) and the game serves levels from the bundled `public/levels/` path.
- **Probably not a max-texture-size limit** — the shipped images are 1170x2560, well inside any
  modern GPU limit. Note that `level.json` declares a *logical* level space of `width: 2560,
  height: 5600`, which is NOT the texture size; don't confuse the two. That said,
  `RuntimeTexturePolicy.ts` does gate on `gl.MAX_TEXTURE_SIZE`
  (`GameScene.resolveRuntimeTextureLongEdge`, `GameScene.ts:3463-3466`) and picks `color.png` over
  `color.webp` on high-limit devices — worth confirming which variant Android actually requests,
  since a `.png` at source resolution is a much bigger upload than the `.webp`.

### Code seams worth reading first

- `src/scenes/HomeScene.ts:296-320` — `schedulePrewarmCurrentLevel` / `prewarmCurrentLevel`
- `src/scenes/GameScene.ts:415-460` — the `preload` texture-loading path (`this.load.image('color', ...)`,
  per-section `bg_N`, per-dog sprite textures)
- `src/scenes/GameScene.ts:530-550` — the `new Image()` + `textures.addImage(key, img)` manual path
- `src/scenes/RuntimeTexturePolicy.ts` — `resolveRuntimeTextureLongEdge` and
  `selectRuntimeColorImageUrl`; both are **pure functions and trivially unit-testable**, which makes
  them the natural place to land a TDD regression test if the bug lives there
- `src/data/levels.ts` — level/asset URL construction

## The fast diagnostic path

Attach Chrome DevTools to the Android WebView over CDP and read the actual exception. On this
project that technique previously found three bugs where shared CSS silently overrode correct
values, so it is proven here:

1. With the app running on the Pixel, open `chrome://inspect/#devices` in desktop Chrome
   (or drive CDP directly via the `localabstract:webview_devtools_remote_<pid>` socket).
2. Reproduce: tap Play Now.
3. Read the real `DOMException` name/message in the console, plus any failed network entries for
   `levels/**` URLs and any WebGL warnings.

Do not skip this in favor of guessing from logcat — logcat is stringifying the error away.

## Constraints

- **TDD.** Write the failing test first. It must fail against `main` for the right reason, then pass
  after the fix. Prefer a unit test over anything device-dependent; the pure functions in
  `RuntimeTexturePolicy.ts` and `src/data/levels.ts` are unit-testable with `vitest`.
- **Do not "fix" this by silencing the prewarm warning.** The board must actually render.
- **Do not run browser e2e as verification.** Project policy (`.claude/CLAUDE.md`): browser
  Playwright checks are never device verification for a mobile game.
- **Device-first.** Per project policy, the real device is the target. A passing unit test is
  necessary but NOT sufficient — the fix is not done until you have looked at an on-device
  screenshot of a level board rendering its artwork.
- Keep the change surgical. Do not refactor adjacent code, and do not start the "Find the Bird"
  reskin — that is separate, much larger work.
- Do not touch the primary checkout's working tree or its branch.

## Build / run / verify commands

All from your worktree's `games/find_the_dog` directory.

**Required first:** `.env.android.local` is gitignored and does **not** exist in a fresh worktree.
The android build fails validation without it. Create it with exactly:

```sh
cat > .env.android.local <<'EOF'
# Local-only dev config for Android device builds (never committed).
VITE_APPLOVIN_ANDROID_ENABLED=false
VITE_CDN_ENABLED=false
VITE_FTD_DISABLE_REMOTE_CONFIG=true
EOF
```

Code health:

```sh
npm run typecheck     # tsc --noEmit
npm run test:unit     # vitest; baseline on main is 33 files / 233 tests passing
npm run lint
```

Android device build → install → launch → screenshot:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21          # /usr/bin/java is a stub; no JDK on PATH
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH

npm run build:android                                   # vite build --mode android (validates env first)
npx cap add android                                     # ONLY in a fresh worktree; android/ is gitignored
npx cap sync android                                    # after every rebuild
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop com.basegamelab.find_the_dog.dev
adb shell monkey -p com.basegamelab.find_the_dog.dev -c android.intent.category.LAUNCHER 1
sleep 15 && adb exec-out screencap -p > /tmp/ftd-pixel.png
adb logcat -d --pid=$(adb shell pidof com.basegamelab.find_the_dog.dev) | grep -i console
```

Reaching a level: tap Play Now at roughly `adb shell input tap 540 1862` on a 1080x2400 screen
(the tap target moves with progress state; screenshot first and aim at the green button).

**Signature gotcha:** if `adb install` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, a build
signed with a different debug key is installed. Uninstalling wipes that app's local save data —
**ask the user before `adb uninstall`.**

## Definition of done

1. A test exists that fails on `main` for this defect and passes with the fix, committed alongside it.
2. `npm run typecheck`, `npm run test:unit`, and `npm run lint` all pass in the worktree.
3. An on-device Pixel screenshot shows a level board **rendering its actual artwork** — not black,
   no green staircase artifact. You must open and look at the screenshot yourself; a green build is
   not evidence.
4. iOS is not regressed (the iPhone path renders correctly today — do not break it).
5. The root cause is stated in one or two sentences in the commit message.

## If you get blocked

Report the blocker explicitly rather than declaring success. "Blocked" and "complete" are different
outcomes. In particular: if the shared iPhone or Pixel is being used by another agent's device run
(`ps aux | grep -E "devicectl|adb"`), coordinate rather than clobbering the install.

## Related context

- `ff9d7e7d` — the commit that made Android boot at all: FTD's SDK context used to *throw* from the
  AdMob factory slot, and the shared selector (`packages/sdk/src/ads/createAdProvider.ts:28-42`)
  routes Android to AdMob whenever AppLovin was not requested. The throw escaped bootstrap and hung
  the app on the splash screen. It now returns the disabled provider instead.
- Android has never been a supported FTD target before this: there was no `@capacitor/android`
  dependency, no `native-resources/android/`, and `tools/native-shell` is iOS-only. Treat any
  Android-specific breakage as first-run territory, not regression.
- Three `Error injecting safe area CSS: TypeError: Cannot read properties of null (reading 'style')`
  errors also fire on Android at boot. Separate, lower-priority defect — note it, don't chase it.
