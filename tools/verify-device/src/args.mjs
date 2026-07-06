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
  --captures <dir>     skip the device build/capture; diff pre-extracted device
                       PNGs (named <state>.png) already in <dir>. The non-device
                       path the AC/unit tests exercise.
  --xcresult <path>    skip build/run; extract device captures from this .xcresult.
  --out <dir>          output dir (default docs/evidence/<date>-device-verify).
  --date <YYYY-MM-DD>  stamp used in the default --out and the HTML header.
  --threshold <0..1>   diff changed-fraction above which a state is a FAIL
                       (default 0.20, advisory).
  --strict             make a FAIL verdict a non-zero exit (default: advisory —
                       verdict is printed, exit stays 0 while the gate beds in).
  --skip-device        force the graceful device-absent skip (CI-safe).
  -h, --help           show this help.
`;

/**
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{game?:string, device?:string, captures?:string, xcresult?:string,
 *   out?:string, date?:string, threshold:number, strict:boolean,
 *   skipDevice:boolean, help:boolean}}
 */
export function parseArgs(argv) {
  const args = {
    threshold: 0.2,
    strict: false,
    skipDevice: false,
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
    else if (a === '--threshold') args.threshold = parseThreshold(req(argv, ++i, a));
    else if (a === '--strict') args.strict = true;
    else if (a === '--skip-device') args.skipDevice = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.help && !args.game) throw new Error('--game is required');
  return args;
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
