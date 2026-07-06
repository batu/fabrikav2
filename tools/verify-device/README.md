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
   by bundle id, captures each canonical state on the tour's dwell cadence, exports
   the PNGs from the `.xcresult`.
4. **Diff device vs the committed reference set** (`games/<g>/refs/`, via the same
   manifest `tools/refcap-compare` uses) → a **device|reference|pixel-diff grid** at
   `docs/evidence/<date>-device-verify/grid.html` + a **PASS/FAIL** summary (FAIL if
   a state is missing or its diff exceeds `--threshold`, default advisory).
5. **Print the grid path + a one-line verdict.**

## Gating / graceful degrade

Device/keychain/Mac-only steps are gated. With no connected device (or
`--skip-device`, or no Xcode), the tool **skips with a clear message and exits 0**
so CI degrades instead of failing — and says plainly that on-device rendering
stays **UNVERIFIED**.

## Non-device paths (what CI + unit tests exercise)

- `--captures <dir>` — diff pre-extracted device shots (`<state>.png`) with no build.
- `--xcresult <path>` — extract + diff from an existing `.xcresult` (no build/run).

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
`--threshold <0..1>` (default 0.20) · `--ensemble <name>` (default `default`;
`kitchen-sink` for the full roster) · `--models <a,b,c>` (overrides the ensemble) ·
`--panel-threshold <0..100>` (default 85) · `--skip-panel` · `--strict` (FAIL →
non-zero exit; default advisory) · `--skip-device` · `-h/--help`.

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
