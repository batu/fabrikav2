// Argument parsing for `npm run verify-device`. Kept as a pure function so the
// parse rules are unit-testable without spawning the CLI or touching a device.

export const HELP = `verify-device — ONE-COMMAND on-device capture + diff

Usage:
  npm run verify-device -- --game <name> [options]
  node tools/verify-device/cli.mjs --game <name> [options]

The forcing function for AGENTS.md #8: builds the harness bundle with the
allstates tour, installs on the plugged-in iOS device, captures each canonical
state via the committed XCUITest runner, and diffs the device captures against
the committed reference set into a device|reference|diff grid + PASS/FAIL verdict.

Options:
  --game <name>        required. games/<name>/refs/manifest.yaml must exist.
  --device <udid>      target device (default: auto-detect the single connected
                       device via 'xcrun devicectl list devices'). Never hardcoded.
  --captures <dir>     skip the device build/capture; diff PNGs (named
                       <state>.png) already in <dir>. Stamped
                       provided-captures + DEVICE-PROVENANCE-UNVERIFIED and
                       excluded from strict device-pass semantics.
  --xcresult <path>    skip build/run; extract device captures from this .xcresult.
  --out <dir>          output dir (default docs/evidence/<date>-device-verify).
  --date <YYYY-MM-DD>  stamp used in the default --out and the HTML header.
  --content-inset-top <px>
                       crop this many physical pixels from the TOP of device
                       captures before phash + panel judging. Overrides
                       games/<game>/refs/manifest.yaml verifyDevice.contentInsetTop.
                       Default: manifest value, else 0. Raw captures are still
                       preserved in the evidence dir.
  --threshold <0..1>   phash diff changed-fraction above which a state is a FAIL
                       (default 0.20, advisory). Secondary signal — the vision
                       panel is the primary verdict.
  --ensemble <name>    named judge set from tools/verify-device/judges.json:
                       'default' (proven-working opus/sonnet/gemini-flash) or
                       'kitchen-sink' (full roster incl. openai/gpt-5 Codex + more
                       claude/gemini variants). Default: default. A judge with no
                       key / no budget (401/402/403/404/429/timeout) is
                       skipped-and-recorded, never fatal.
  --models <a,b,c>     comma-separated OpenRouter model ids; OVERRIDES --ensemble
                       and the registry (e.g. anthropic/claude-opus-4.1,
                       google/gemini-3.5-flash). A model that 404s is skipped w/ note.
  --panel-threshold <n> panel fidelity floor 0..100; a state FAILs below it or on a
                       consensus blocker finding (default 85, advisory).
  --skip-panel         skip the vision panel (phash-only verdict).
  --strict             require a PASS verdict from a verified device lane; FAIL,
                       browser, or provided-captures lanes exit non-zero
                       (default: advisory).
  --skip-device        force the graceful device-absent skip (CI-safe).
  --lane <device|browser> capture lane (default: device). 'browser' drives a
                       vite-dev + Playwright/Chromium fallback via the game
                       harness's driveTo(state) instead of the iOS device, scored
                       by the SAME panel but stamped lane=browser and marked
                       DEVICE-UNVERIFIED (safe-area/notch fidelity is device-only).
                       Explicit only — the default lane stays device.
  --budget-floor <n>   OpenRouter credit floor in USD (default 5). Before every
                       billable model call, remaining credit is checked; below
                       the floor that judge/state is recorded as budget-halted
                       without making the model call.
  -h, --help           show this help.

The vision panel needs OPENROUTER_API_KEY (env or the sibling .env); without it
the panel skips gracefully (exit 0) and on-device fidelity stays UNVERIFIED.
`;

/**
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{game?:string, device?:string, captures?:string, xcresult?:string,
 *   out?:string, date?:string, contentInsetTop?:number, threshold:number, ensemble:string, models?:string[],
 *   panelThreshold:number, skipPanel:boolean, strict:boolean,
 *   skipDevice:boolean, lane:'device'|'browser', budgetFloor:number, help:boolean}}
 */
export function parseArgs(argv) {
  const args = {
    threshold: 0.2,
    ensemble: 'default',
    panelThreshold: 85,
    skipPanel: false,
    strict: false,
    skipDevice: false,
    lane: 'device',
    budgetFloor: 5,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--game') args.game = req(argv, ++i, a);
    else if (a === '--device') args.device = req(argv, ++i, a);
    else if (a === '--captures') args.captures = req(argv, ++i, a);
    else if (a === '--xcresult') args.xcresult = req(argv, ++i, a);
    else if (a === '--out') args.out = req(argv, ++i, a);
    else if (a === '--date') args.date = req(argv, ++i, a);
    else if (a === '--content-inset-top') args.contentInsetTop = parseContentInsetTop(req(argv, ++i, a));
    else if (a === '--threshold') args.threshold = parseThreshold(req(argv, ++i, a));
    else if (a === '--ensemble') args.ensemble = req(argv, ++i, a);
    else if (a === '--models') args.models = parseModels(req(argv, ++i, a));
    else if (a === '--panel-threshold') args.panelThreshold = parsePanelThreshold(req(argv, ++i, a));
    else if (a === '--skip-panel') args.skipPanel = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--skip-device') args.skipDevice = true;
    else if (a === '--lane') args.lane = parseLane(req(argv, ++i, a));
    else if (a === '--budget-floor') args.budgetFloor = parseBudgetFloor(req(argv, ++i, a));
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.help && !args.game) throw new Error('--game is required');
  return args;
}

function parseLane(v) {
  if (v !== 'device' && v !== 'browser') {
    throw new Error(`--lane must be "device" or "browser", got: ${v}`);
  }
  return v;
}

function parseBudgetFloor(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--budget-floor must be a non-negative number, got: ${v}`);
  }
  return n;
}

function parseContentInsetTop(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--content-inset-top must be a non-negative integer pixel value, got: ${v}`);
  }
  return n;
}

function req(argv, i, flag) {
  const v = argv[i];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
  return v;
}

function parseThreshold(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`--threshold must be a number in [0,1], got: ${v}`);
  }
  return n;
}

function parsePanelThreshold(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`--panel-threshold must be a number in [0,100], got: ${v}`);
  }
  return n;
}

function parseModels(v) {
  const models = v.split(',').map((s) => s.trim()).filter(Boolean);
  if (!models.length) throw new Error('--models needs at least one model id');
  return models;
}
