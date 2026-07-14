# REALGAME U0 Android build/install/capture proof

Status: **PASS for the build/install/launch/menu-capture preflight lane.** This is not a fidelity verdict.

## Provenance

- Source repository: `https://github.com/batu/fabrikav2.git`
- Source commit: `b53b9b04e7dbfdda9404f55cb12047e02af5af80`
- Remote source path: `/home/batu/realgame-u0-b53b9b04-sparse-223602`
- Acquisition: new disposable partial clone with `--filter=blob:none --sparse --branch main --single-branch`, then an exact `HEAD` equality check against the required SHA.
- Sparse paths needed for this build: `configs`, `games/marble_run`, `games/arrow`, `packages`, `tools/verify-device`.
- Tracked source diff after the run: clean (`git diff --quiet`). Generated `dist/` and `android/` remain ignored build products; proof files and `SOURCE_COMMIT` are untracked evidence only.
- Lockfile SHA-256: `ce6e228b737f230f757b2b73989a07ffb48b33fe8cae7f30b4ae3564edc80d9e`.

The first full `git archive` approach was abandoned because the commit tree is about 8 GB. No existing Ubuntu checkout was used. The partial clone still checks out every tracked source and asset required by the Marble Run build from the exact commit.

## Build commands

Environment:

```text
node v25.0.0
npm 11.6.2
ANDROID_HOME=/home/batu/android-sdk
```

Commands, from the fresh snapshot:

```sh
npm ci
npm run build --workspace @fabrikav2/marble_run
cd games/marble_run
npx cap add android
npx cap sync android
cd android
./gradlew --no-daemon assembleDebug
```

Vite transformed 152 modules and Gradle completed 123 tasks successfully. Full output is in `npm-ci.log` and `build.log`.

`@capacitor/android` is not declared by Marble Run itself at this commit. To avoid mutating the source or lockfile, the exact tracked `games/arrow` workspace was included in the sparse checkout before the final `npm ci`; that workspace causes the lockfile-pinned Android package to be installed. This is a reproducibility seam worth fixing later.

## APK and install

- APK path on Ubuntu: `/home/batu/realgame-u0-b53b9b04-sparse-223602/games/marble_run/android/app/build/outputs/apk/debug/app-debug.apk`
- The APK was copied into the disposable proof directory for hashing, then intentionally omitted from committed evidence because it is a 7.6 MB build product. Its exact hash and install metadata are retained here and in `install-launch.log`.
- APK SHA-256: `692b21d528e33a45fc3a3d08bd5bc5928eb28026f5528f8b9c9211854e696e30`
- APK size: 7,641,440 bytes
- Package: `com.appletolye.marblerun.dev`
- Version: `versionCode=1`, `versionName=1.0`, min SDK 24, target/compile SDK 36
- Install: `adb install -r`, followed by `pm clear` to prevent prior app data from affecting the baseline
- Install completed: `2026-07-14T22:38:21Z` (`2026-07-15 01:38:21` Europe/Istanbul)
- Package manager recorded first install/update at `2026-07-15 01:38:20` device local time

## Device, launch, and capture

- ADB binary: `/home/batu/android-sdk/platform-tools/adb`
- Serial: `27091JEGR22183`
- Device: Google Pixel 6a
- Android: 16
- Build fingerprint: `google/bluejay/bluejay:16/CP1A.260405.005/15001963:user/release-keys`
- Physical display: 1080 x 2400
- Launch: explicit cold start of `com.appletolye.marblerun.dev/.MainActivity`
- Android launch result: `Status: ok`, `LaunchState: COLD`, `TotalTime: 1461 ms`
- Delayed-UI dwell before capture: 12 seconds
- Capture timestamp: `2026-07-14T22:38:35Z`
- Foreground proof: PID 11430 and `topResumedActivity` both resolve to the expected package/activity
- Screenshot: `menu.png`, 1080 x 2400 RGBA PNG, 918,634 bytes
- Screenshot SHA-256: `df4bb57bfdb651cb2bab725741ba71799a676a9d84c4593bcbe982a6f092754e`

Visual inspection confirms the actual Marble Run primary menu is fully rendered after the dwell: coin/settings HUD, Marble Run banner, board artwork, level path, and Level 1 CTA are present. It is not a browser capture or stale installed build.

## Runtime evidence and visible warning

- `install-launch.log` records device identity, APK metadata, install, package timestamps, cold launch, wait, PID, and resumed activity.
- `app-logcat.txt` records Capacitor starting the bridge, loading `https://localhost`, serving the hashed bundle and exact Marble Run assets, and the `session_start` console event.
- `window.xml` is the post-dwell UIAutomator hierarchy.

Non-blocking but real current-main warning: logcat reports AdMob initialization falling back to the native-only web stub:

```text
[ads:admob] AdMob initialization failed Error: @capacitor-community/admob is native-only (web stub)
```

The menu still renders and the requested preflight lane passes, but this means the generated Android shell at this SHA is not a complete production SDK integration proof.

## Evidence inventory

- `REPORT.md` — this report
- `menu.png` — real-device post-dwell menu capture
- `app-debug.apk` — intentionally omitted from committed evidence; exact hash and install metadata are retained above
- `install-launch.log` — install/device/package/launch proof
- `app-logcat.txt` — app process logcat after launch
- `window.xml` — post-dwell UI hierarchy
- `capture-metadata.log` — screenshot hash/dimensions/byte counts
- `build.log` — Vite, Capacitor, and Gradle build output (including the first failed attempts and final success)
- `npm-ci.log` — dependency install evidence
