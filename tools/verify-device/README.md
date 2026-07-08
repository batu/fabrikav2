# verify-device

**ONE command** to capture the real device and diff it against the committed
reference set. The forcing function for **AGENTS.md #8**: on-device verification
was OPTIONAL + MULTI-STEP, so it got skipped for a proxy. This makes the correct
check the path of least resistance.

```sh
npm run verify-device -- --game marble_run
```

## What it does (in order)

1. **Build the harness bundle with the allstates tour** —
   `VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=allstates vite build` + Capacitor
   sync for the selected device platform. The `allstates` tour
   (`@fabrikav2/testkit/testing` `maybeRunInsituTour`) drives
   menu→level→settings→pause→win→fail, each state CONFIRMED via `snapshot().scene`
   before a 6s dwell.
2. **Build + install on the device** — iOS uses `xcodebuild` + `devicectl install`.
   Android uses generated Capacitor `android/`, `./gradlew assembleDebug`, then
   `adb install -r` via the configured adb command prefix. Android build commands
   can be wrapped with `VERIFY_DEVICE_BUILD_PREFIX` / `--build-prefix` when the
   Gradle/JDK toolchain lives on a separate build host.
3. **Run the platform capture driver** — iOS runs the committed XCUITest runner
   (`runner/`). Android polls `adb logcat -d -v epoch` for fresh
   `[insituTour] state=<state>` console lines since app launch, falls back to
   `adb shell uiautomator dump` for exact `tourstate:<state>` markers, captures
   PNGs with `adb exec-out screencap -p`, and waits for exact
   `state=<state>-DONE` / `tourstate:<state>-DONE` retire markers before
   advancing.
4. **Prepare judged captures** — copy raw device PNGs to `raw-captures/`, then
   crop the configured content inset into `judged-captures/` before phash +
   panel judging. Raw is the integrity/evidence artifact; judged is the artifact
   sent to diff/panel.
5. **Diff judged device captures vs the committed reference set** (`games/<g>/refs/`,
   via the same manifest `tools/refcap-compare` uses) → a
   **device|reference|pixel-diff grid** at
   `docs/evidence/<date>-device-verify/grid.html` + `summary.json` with stable
   per-state `{score, majorConsensusCount, verdict, capture}` entries + a **PASS/FAIL**
   summary (FAIL if a state is missing or its diff exceeds `--threshold`, default
   advisory).
6. **Emit named-region crops** under `<out>/crops/` when
   `games/<g>/refs/manifest.yaml` declares `verifyDevice.regions`. Each crop run
   writes device/reference/diff PNGs where possible plus `crops/inventory.json`
   with explicit skip reasons for missing captures or documented reference gaps.
7. **Print the grid path, summary path, crop directory when present, one-line
   per-state table, and verdict.**

## Gating / graceful degrade

Device/keychain/Mac-only steps are gated. With no connected device (or
`--skip-device`, or no Xcode), the tool **skips with a clear message and exits 0**
so CI degrades instead of failing — and says plainly that on-device rendering
stays **UNVERIFIED**.

If the iOS runner exports a `*-MISSING` inspection screenshot, that state is
recorded in `summary.json` as `capture: { "gated": false }`, the state table marks
it `BLIND`, and the command exits non-zero by default with
`<state> CAPTURED BLIND (marker never appeared)`. Pass `--allow-ungated` only when
replaying historical or forensic captures where the non-zero gate is intentionally
disabled.

## Android lane (`--platform android`)

Android keeps the evidence lane stamped `lane=device`; `platform=android` is the
device backend. Select it explicitly with `--platform android`, or set
`verifyDevice.platform: android` in `games/<game>/refs/manifest.yaml` and leave
the CLI on `--platform auto`.

Ubuntu Pixel 6a build-host recipe:

```sh
rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.work/' \
  --exclude 'docs/evidence/' \
  --exclude 'games/*/.work/' \
  --exclude 'games/*/test-results/' \
  --exclude 'games/*/ios/' \
  --exclude 'games/*/android/' \
  ./ ubuntu-server:/home/batu/Desktop/utolye/fabrikav2/

ssh ubuntu-server '
set -euo pipefail
export ANDROID_HOME=/home/batu/android-sdk
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$HOME/.nvm/versions/node/v25.0.0/bin:$PATH
cd /home/batu/Desktop/utolye/fabrikav2
npm ci
node tools/verify-device/cli.mjs \
  --game <game> \
  --platform android \
  --device 27091JEGR22183 \
  --android-sdk /home/batu/android-sdk \
  --content-inset-top <pixel-6a-statusbar-px> \
  --content-inset-bottom <pixel-6a-navbar-px>
'
```

When only adb is remote, pass `--adb-prefix 'ssh ubuntu-server adb'`; the driver
runs commands such as `ssh ubuntu-server adb -s 27091JEGR22183 exec-out screencap
-p`. The generated `games/<game>/android/` directory remains an ignored build
artifact; the first live build/capture is conductor-run on the device host.

When the CLI is run from a host without local Gradle/Java but the Android build
checkout exists on the build host, pass `--build-prefix 'ssh ubuntu-server'` or
set `VERIFY_DEVICE_BUILD_PREFIX='ssh ubuntu-server'`. The Android build steps are
assembled as `<prefix> cd <gameDir> && env ANDROID_HOME=... VITE_INSITU_TOUR=allstates <command>`,
while install/launch/capture still use `--adb-prefix` / `VERIFY_DEVICE_ADB_PREFIX`.
For remote-build runs, the local APK existence check is skipped because the APK
is produced on the build host.

## Non-device paths (what CI + unit tests exercise)

- `--captures <dir>` — diff pre-extracted shots (`<state>.png`) with no build.
  This lane is stamped `provided-captures` and `DEVICE-PROVENANCE-UNVERIFIED`;
  it is excluded from strict device-pass semantics.
- `--xcresult <path>` — extract + diff from an existing `.xcresult` (no build/run).
- `--content-inset-top <px>` / `--content-inset-bottom <px>` — crop physical
  pixels from the top/bottom of device captures before phash + panel. Overrides
  `verifyDevice.contentInsetTop` / `verifyDevice.contentInsetBottom`; platform
  keys `iosContentInsetTop`, `androidContentInsetTop`, `iosContentInsetBottom`,
  and `androidContentInsetBottom` are also supported.

## Browser-fallback lane (`--lane browser`)

Explicit only — the **default lane stays device** (a phone pass is what actually
confirms fidelity; browser never becomes the default scorer). When the phone is
unavailable, `--lane browser` drives a `vite` dev server + Playwright/Chromium
against the game harness's `driveTo(state)` (`window.__<GAME>_HARNESS__`) instead
of building/installing on the iOS device — same capture-integrity discipline
(`driveTo` only resolves `true` once its own `snapshot()` poll confirms arrival;
a state it can't confirm is a documented gap, never a guess). Results are scored
by the **same vision panel** but every capture is stamped `lane=browser` and the
grid carries a **DEVICE-UNVERIFIED** banner — safe-area/notch insets can't be
validated off-device. Lets fidelity work + panel-scoring progress when the phone
is down; a device pass later is what actually confirms the result.

## Named-region crops

Crops are default-on when the refs manifest declares regions; there is no flag a
runner must remember for normal evidence. Regions live under `verifyDevice`:

```yaml
verifyDevice:
  contentInsetTop: 130
  androidContentInsetTop: 72
  androidContentInsetBottom: 96
  regions:
    - name: result_ribbon
      label: Result screen headline ribbon
      coords: normalized
      states:
        - win
        - fail
      box:
        x: 0.07
        y: 0.19
        width: 0.86
        height: 0.14
```

`coords: normalized` means `x`, `y`, `width`, and `height` are 0..1 fractions
of the source image. Device/current crops are cut from `judged-captures/`, after
the configured content inset has already been applied. Reference crops are cut
from committed refs only when that reference is available and trusted;
documented gaps and `at-rest:false` entries become skipped inventory rows. When
both sides exist, `verify-device` also writes a region-level diff crop using the
same perceptual diff semantics as the full-state grid.

## Budget-guard (OpenRouter credit floor)

Before every billable model call, `verify-device` checks remaining OpenRouter
credit (`GET /credits`). Below `--budget-floor` (default `$5`), that judge/state
is recorded as budget-halted and no model call is made — never a silent drain of
the shared OpenRouter budget to $0 mid-overnight-run. A failed credit *check*
(network blip, bad response) does not halt; it proceeds and relies on the panel's
own per-judge credit-skip as the backstop.

## Vision panel & judge registry (primary verdict)

The PRIMARY fidelity verdict is a **multi-model vision panel**: for each state it
sends the (device, reference) pair to N judges via OpenRouter and takes the MEDIAN
fidelity + majority-consensus findings (phash is now a secondary advisory signal).
Aggregation is **count-agnostic** — the panel scores with whoever answered.

Judges live in [`judges.json`](judges.json) as `{id, model, provider, enabled,
weight?}` (`model` = OpenRouter id; `provider` defaults to `openrouter` and is the
seam for a future direct-provider adapter). Named ensembles select a roster:

- `default` — proven-working `anthropic/claude-opus-4.1`, `anthropic/claude-sonnet-5`,
  `google/gemini-3.5-flash`.
- `kitchen-sink` — the full roster incl. `openai/gpt-5` (Codex) + more claude/gemini
  variants. Judges without budget/key are auto-skipped (see below).

**Credit-skip:** a judge that is absent (404), out of credit / keyless /
rate-limited (**401/402/403/429**), or times out is **skipped-and-recorded**
(`{judge, skipped, reason}`), never fatal — Gemini's real failure mode is 402/429,
and Codex is registered-but-broke until it has budget. The grid lists **participated
vs skipped** per state explicitly.

The panel needs `OPENROUTER_API_KEY` (env or sibling `.env`); without it, it skips
gracefully (exit 0) and on-device fidelity stays **UNVERIFIED**.

## Flags

`--game <name>` (required) · `--platform <auto|ios|android>` ·
`--device <udid-or-adb-serial>` · `--adb-prefix <cmd>` ·
`--build-prefix <cmd>` · `--android-sdk <path>` ·
`--android-activity <component>` · `--captures <dir>` · `--xcresult <path>` ·
`--out <dir>` · `--date <YYYY-MM-DD>` · `--content-inset-top <px>` ·
`--content-inset-bottom <px>` ·
`--threshold <0..1>` (default 0.20) · `--ensemble <name>` (default `default`;
`kitchen-sink` for the full roster) · `--models <a,b,c>` (overrides the ensemble) ·
`--panel-threshold <0..100>` (default 85) · `--skip-panel` · `--strict` (FAIL or
non-device lane → non-zero exit; default advisory) · `--skip-device` ·
`--allow-ungated` (forensic replay escape hatch for `*-MISSING` iOS attachments) ·
`--lane <device|browser>` (default `device`) · `--budget-floor <n>` (default 5) ·
`--compare <prev-run-dir>` (print per-state score / consensus / verdict deltas
against a previous run's `summary.json`, falling back to `panel.json`) · `-h/--help`.

## Reuse

The PNG codec (zero-dep `node:zlib`) and the perceptual pixel-diff come straight
from `tools/refcap-compare` — this tool adds the device lane + verdict, it does not
re-implement image handling.

## Verify

```sh
npm run test:unit --workspace=tools/verify-device   # parse/extract/verdict/compare/grid
npm run lint --workspace=tools/verify-device
# non-device end-to-end (grid from committed reference PNGs used as stand-in device shots):
node tools/verify-device/cli.mjs --game marble_run --captures <dir-of-state-pngs>
```

The **device path is conductor-run** on the Mac/iPhone or ubuntu-server/Pixel —
the worker builds and unit-tests the non-device glue only. Android's first live
run is conductor-run on `ubuntu-server` + Pixel; worker verification covers the
parser, driver command construction, build step orchestration, and
provided-capture grid path.
