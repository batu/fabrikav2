# verify-device

**ONE command** to capture the real iOS device and diff it against the committed
reference set. The forcing function for **AGENTS.md #8**: on-device verification
was OPTIONAL + MULTI-STEP, so it got skipped for a proxy. This makes the correct
check the path of least resistance.

```sh
npm run verify-device -- --game marble_run
```

## What it does (in order)

1. **Build the harness bundle with the allstates tour** —
   `VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=allstates vite build` + `npx cap
   sync ios`. The `allstates` tour (`games/<g>/src/testing/insituTour.ts`) drives
   menu→level→settings→pause→win→fail, each state CONFIRMED via `snapshot().scene`
   before a 6s dwell.
2. **Build + install on the device** — `xcodebuild` the Capacitor app + `devicectl
   install`. Keychain unlocked from `MAC_PASSWORD` (env, or a sibling `.env`). The
   device serial is **read from `xcrun devicectl list devices`** (or `--device`) —
   never hardcoded.
3. **Run the committed XCUITest runner** (`runner/`) — launches the installed app
   by bundle id, waits for each `tourstate:<state>` accessibility marker, captures
   the PNGs from the `.xcresult`, and still exports attachments when XCTest fails.
4. **Prepare judged captures** — copy raw device PNGs to `raw-captures/`, then
   crop the configured top content inset into `judged-captures/` before phash +
   panel judging. Raw is the integrity/evidence artifact; judged is the artifact
   sent to diff/panel.
5. **Diff judged device captures vs the committed reference set** (`games/<g>/refs/`,
   via the same manifest `tools/refcap-compare` uses) → a
   **device|reference|pixel-diff grid** at
   `docs/evidence/<date>-device-verify/grid.html` + `summary.json` with stable
   per-state `{score, majorConsensusCount, verdict}` entries + a **PASS/FAIL**
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

## Non-device paths (what CI + unit tests exercise)

- `--captures <dir>` — diff pre-extracted shots (`<state>.png`) with no build.
  This lane is stamped `provided-captures` and `DEVICE-PROVENANCE-UNVERIFIED`;
  it is excluded from strict device-pass semantics.
- `--xcresult <path>` — extract + diff from an existing `.xcresult` (no build/run).
- `--content-inset-top <px>` — crop this many physical pixels from the top of
  device captures before phash + panel. Overrides `verifyDevice.contentInsetTop`
  in the game manifest; default is manifest value, otherwise `0`.

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
the configured top content inset has already been applied. Reference crops are
cut from committed refs only when that reference is available and trusted;
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

`--game <name>` (required) · `--device <udid>` · `--captures <dir>` ·
`--xcresult <path>` · `--out <dir>` · `--date <YYYY-MM-DD>` ·
`--content-inset-top <px>` ·
`--threshold <0..1>` (default 0.20) · `--ensemble <name>` (default `default`;
`kitchen-sink` for the full roster) · `--models <a,b,c>` (overrides the ensemble) ·
`--panel-threshold <0..100>` (default 85) · `--skip-panel` · `--strict` (FAIL or
non-device lane → non-zero exit; default advisory) · `--skip-device` ·
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

The **device path is conductor-run** on the Mac+device — the worker builds and
unit-tests the non-device glue only.
