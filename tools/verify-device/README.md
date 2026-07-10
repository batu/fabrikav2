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
   (`@fabrikav2/testkit/testing` `maybeRunInsituTour`) is expected to expose the
   states declared in `games/<game>/refs/manifest.yaml` `states:` order; each
   state is CONFIRMED via `snapshot()` before its dwell. Those manifest states
   are discovered at ingestion and human-ratified per game; the six familiar
   names are only scaffold defaults. After local `cap sync`, `verify-device` reapplies committed
   native-shell recipe files from `games/<g>/native-resources/ios/App` or
   `games/<g>/native-resources/android/app` into the generated shell.
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
   using the same manifest states that `tools/refcap-compare` uses) → a
   **device|reference|pixel-diff grid** at
   `docs/evidence/<date>-device-verify/grid.html` + `summary.json` with stable
   per-state `{score, majorConsensusCount, verdict, capture}` entries plus an
   additive reserved `__run` member carrying the typed run verdict (see below).
   The phash pass/fail is advisory; run status is the typed verdict, not the diff.
6. **Emit named-region crops** under `<out>/crops/` when
   `games/<g>/refs/manifest.yaml` declares `verifyDevice.regions`. Each crop run
   writes device/reference/diff PNGs where possible plus `crops/inventory.json`
   with explicit skip reasons for missing captures or documented reference gaps.
7. **Print the grid path, summary path, crop directory when present, one-line
   per-state table, and verdict.**

## Strict verification & the typed run verdict (minimum proof)

`verify-device` emits ONE typed run verdict (`tools/verify-device/src/verdict.mjs`,
`classifyRunVerdict`) that owns run status **and** the process exit code. The CLI
exit, the grid's top banner, the stdout `run verdict:` line, and `summary.json`'s
additive `__run` member all read that same object — there is no second success
boolean that can disagree with it.

`kind` describes the **evidence** and is independent of `--strict`; `enforcement`
(`strict`/`exploratory`) plus hard-integrity gates decide the **exit**. The five
evidence kinds:

| kind | meaning | strict exit | exploratory exit |
|---|---|---|---|
| `verified-pass` | ≥1 applicable state, **live-device** provenance, complete primary (panel) fidelity pass, every required applicable state covered, no failed gate | 0 | 0 |
| `verified-fail` | live provenance + applicable evidence, but a missing capture, an applicable panel fidelity fail, or a viewport assertion failed | nonzero | 0 (advisory) |
| `unverified` | captures exist but provenance is untrusted (`browser`, `provided-captures`, detached `--xcresult`) **or** primary panel fidelity is absent/incomplete/duplicated/unscored for a captured applicable state | nonzero | 0 (advisory) |
| `skipped` | capture was not attempted (`--skip-device`, no device/toolchain) | nonzero | 0 (degrade) |
| `no-applicable-evidence` | zero states have a trusted reference — empty, skipped-only, no-reference-only, or dual device+reference gaps | nonzero | 0 |

**Minimum strict proof:** a `verified-pass` requires (1) a current-invocation
live iOS/Android capture (provenance `live-device`), (2) at least one applicable
state — a state with a trusted, non-skipped reference, (3) exactly one complete,
passing primary **vision-panel** result for each captured applicable state,
(4) every required applicable state covered (a trusted-reference state with no
capture is `verified-fail`), and (5) no failed strict gate (viewport assertions).
The **phash** pixel-diff is advisory only — it can never, on its own, produce a
`verified-pass`; a panel-skipped run is `unverified`.

Applicability is **reference-first**: a row missing both its device capture and a
trusted reference is `no-reference` (never a false `missing`) and cannot inflate
coverage. Inapplicable or extra panel rows are reported as ignored diagnostics and
can neither help nor hurt the applicable fidelity aggregate.

Hard-integrity gates (capture-runner failure, blind/ungated captures without
`--allow-ungated`, blocking indistinguishable states) exit nonzero in **both**
strict and exploratory modes — they are process gates, not an evidence kind.

**Detached provenance boundary:** `--captures`, `--lane browser`, and a detached
`--xcresult` are `unverified` and strict-nonzero. Freshness is **never** inferred
from a path, label, or file timestamp. A validated run/commit/device attestation
that could upgrade a detached artifact to trusted provenance is owned by
**AUDIT #7**; until it lands and this verifier validates it, detached artifacts
fail closed.

## Gating / graceful degrade

Device/keychain/Mac-only steps are gated. With no connected device (or
`--skip-device`, or no Xcode), the tool **skips with a clear message**, routes the
skip through the typed run verdict (`skipped`), and says plainly that on-device
rendering stays **UNVERIFIED**. In the default exploratory mode this degrades to
**exit 0** so CI passes; under `--strict` a skipped run fails closed and **exits
non-zero** (absence is never a verified pass).

For iOS signing, set `DEVELOPMENT_TEAM=<team id>` in the environment. The device
path passes it to both app and runner `xcodebuild` invocations and uses
`-allowProvisioningUpdates`; the committed recipe must not contain a literal
team id.

If the iOS runner exports a `*-MISSING` inspection screenshot, that state is
recorded in `summary.json` as `capture: { "gated": false }`, the state table marks
it `BLIND`, and the command exits non-zero by default with
`<state> CAPTURED BLIND (marker never appeared)`. Pass `--allow-ungated` only when
replaying historical or forensic captures where the non-zero gate is intentionally
disabled.

After raw captures are preserved, `verify-device` also perceptually hashes each
different state against every other state. Near-identical raw captures are
reported as `INDISTINGUISHABLE STATES` in stdout and `summary.json`, and force a
non-zero exit even when the fidelity verdict is advisory. If two states are
legitimately similar, document the exception in `games/<game>/refs/manifest.yaml`:

```yaml
verifyDevice:
  indistinguishableStates:
    allow:
      - states:
          - win
          - fail
        reason: "same terminal shell is expected for this game"
```

## Device registry (`devices.json`)

Prefer selecting devices by a stable registry name:

```sh
npm run verify-device -- --game block_blast --device pixel-remote
```

`verify-device` looks for a local `devices.json` at the repo root, then at
`tools/verify-device/devices.json`. Set `VERIFY_DEVICE_REGISTRY=/path/to/devices.json`
to use another file. Real registries are gitignored because they contain
host-specific UDIDs, adb serials, and ssh aliases; copy
`tools/verify-device/devices.example.json` as a starting point.

Registry shape:

```json
{
  "devices": [
    {
      "name": "pixel-remote",
      "platform": "android",
      "serial": "27091JEGR22183",
      "ssh": "ubuntu-server",
      "androidSdk": "/home/batu/android-sdk",
      "contentInsets": { "top": 72, "bottom": 96 }
    },
    {
      "name": "iphone-local",
      "platform": "ios",
      "udid": "00000000-0000000000000000",
      "contentInsets": { "top": 130, "bottom": 0 }
    }
  ]
}
```

For Android, `ssh: "ubuntu-server"` expands to `adbPrefix:
"ssh ubuntu-server adb"` and `buildPrefix: "ssh ubuntu-server"`. You can set
`adbPrefix` / `buildPrefix` explicitly when the adb and build hosts differ.

A game manifest can pin the normal device:

```yaml
verifyDevice:
  defaultDevice: pixel-remote
```

Selection precedence is: `--device` registry name, then `VERIFY_DEVICE_NAME`,
then `verifyDevice.defaultDevice` / `verifyDevice.device`, then legacy auto
selection. With no registry present, `--device` remains backward-compatible as a
raw iOS UDID or Android serial.

Value precedence is: CLI flags, then env overrides, then the selected registry
entry, then manifest defaults. Supported env overrides include
`VERIFY_DEVICE_UDID`, `VERIFY_DEVICE_SERIAL`, `ANDROID_SERIAL`,
`VERIFY_DEVICE_ADB_PREFIX`, `VERIFY_DEVICE_BUILD_PREFIX`,
`VERIFY_DEVICE_ANDROID_SDK`, `VERIFY_DEVICE_PLATFORM`,
`VERIFY_DEVICE_CONTENT_INSET_TOP`, and `VERIFY_DEVICE_CONTENT_INSET_BOTTOM`.

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

- `--captures <dir>` — diff pre-extracted shots (`<state>.png`, for states named
  in the per-game manifest) with no build.
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
a manifest state it can't confirm is a documented gap, never a guess). Results are scored
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
`--device <registry-name>` · `--adb-prefix <cmd>` ·
`--build-prefix <cmd>` · `--android-sdk <path>` ·
`--android-activity <component>` · `--captures <dir>` · `--xcresult <path>` ·
`--out <dir>` · `--date <YYYY-MM-DD>` · `--content-inset-top <px>` ·
`--content-inset-bottom <px>` ·
`--threshold <0..1>` (default 0.20) · `--ensemble <name>` (default `default`;
`kitchen-sink` for the full roster) · `--models <a,b,c>` (overrides the ensemble) ·
`--panel-threshold <0..100>` (default 85) · `--skip-panel` (phash advisory only →
strict `unverified`) · `--strict` (only a live-device `verified-pass` exits 0;
`verified-fail`, `unverified`, `skipped`, and `no-applicable-evidence` are
non-zero; default exploratory/advisory) · `--skip-device` ·
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
