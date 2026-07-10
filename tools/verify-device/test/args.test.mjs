import { describe, it, expect } from 'vitest';
import { parseArgs, HELP } from '../src/args.mjs';

// HELP is part of the proof contract (KTD9): the exported source string and the
// executable (cli.test.mjs) must both describe the enforced verdict truthfully so
// operator guidance cannot drift from behavior.
describe('HELP proof contract', () => {
  it('says a panel-skipped run is strict-nonzero and phash is advisory-only', () => {
    expect(HELP).toMatch(/phash is ADVISORY only and can never\s+be a verified pass/);
    expect(HELP).toMatch(/exits non-zero under --strict/);
  });

  it('marks detached --xcresult provenance unverified pending AUDIT #7 attestation', () => {
    expect(HELP).toMatch(/Detached artifact: provenance is UNVERIFIED/);
    expect(HELP).toContain('AUDIT #7');
  });

  it('describes strict as requiring a complete primary vision-panel pass with live provenance', () => {
    expect(HELP).toMatch(/complete primary vision-\s*panel pass/);
    expect(HELP).toContain('live-device provenance');
  });

  it('names the typed run-verdict kinds', () => {
    for (const kind of ['verified-pass', 'verified-fail', 'unverified', 'skipped', 'no-applicable-evidence']) {
      expect(HELP).toContain(kind);
    }
  });
});

describe('parseArgs', () => {
  it('requires --game (unless --help)', () => {
    expect(() => parseArgs([])).toThrow(/--game is required/);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('applies advisory defaults', () => {
    const a = parseArgs(['--game', 'marble_run']);
    expect(a.game).toBe('marble_run');
    expect(a.threshold).toBe(0.2);
    expect(a.panelThreshold).toBe(85);
    expect(a.skipPanel).toBe(false);
    expect(a.ensemble).toBe('default'); // registry ensemble selected when unset
    expect(a.models).toBeUndefined(); // undefined -> panel.mjs DEFAULT_MODELS
    expect(a.strict).toBe(false);
    expect(a.allowUngated).toBe(false);
    expect(a.skipDevice).toBe(false);
    expect(a.lane).toBe('device'); // default lane stays device (never auto-browser)
    expect(a.platform).toBe('auto'); // auto preserves existing iOS manifests unless configured
    expect(a.budgetFloor).toBe(5);
    expect(a.contentInsetTop).toBeUndefined(); // undefined -> manifest value, then 0
    expect(a.contentInsetBottom).toBeUndefined();
  });

  it('parses --content-inset-top and rejects non-integer/negative values', () => {
    expect(parseArgs(['--game', 'g', '--content-inset-top', '130']).contentInsetTop).toBe(130);
    expect(parseArgs(['--game', 'g', '--content-inset-top', '0']).contentInsetTop).toBe(0);
    expect(() => parseArgs(['--game', 'g', '--content-inset-top', '-1'])).toThrow(/non-negative integer/);
    expect(() => parseArgs(['--game', 'g', '--content-inset-top', '1.5'])).toThrow(/non-negative integer/);
    expect(() => parseArgs(['--game', 'g', '--content-inset-top', 'x'])).toThrow(/non-negative integer/);
    expect(() => parseArgs(['--game', 'g', '--content-inset-top'])).toThrow(/--content-inset-top needs a value/);
  });

  it('parses --content-inset-bottom and rejects non-integer/negative values', () => {
    expect(parseArgs(['--game', 'g', '--content-inset-bottom', '96']).contentInsetBottom).toBe(96);
    expect(parseArgs(['--game', 'g', '--content-inset-bottom', '0']).contentInsetBottom).toBe(0);
    expect(() => parseArgs(['--game', 'g', '--content-inset-bottom', '-1'])).toThrow(/non-negative integer/);
    expect(() => parseArgs(['--game', 'g', '--content-inset-bottom', '1.5'])).toThrow(/non-negative integer/);
    expect(() => parseArgs(['--game', 'g', '--content-inset-bottom'])).toThrow(/--content-inset-bottom needs a value/);
  });

  it('parses Android platform/build flags', () => {
    const a = parseArgs([
      '--game', 'g',
      '--platform', 'android',
      '--device', '27091JEGR22183',
      '--adb-prefix', 'ssh ubuntu-server adb',
      '--build-prefix', 'ssh ubuntu-server',
      '--android-sdk', '/home/batu/android-sdk',
      '--android-activity', 'com.example/.MainActivity',
    ]);
    expect(a.platform).toBe('android');
    expect(a.device).toBe('27091JEGR22183');
    expect(a.adbPrefix).toBe('ssh ubuntu-server adb');
    expect(a.buildPrefix).toBe('ssh ubuntu-server');
    expect(a.androidSdk).toBe('/home/batu/android-sdk');
    expect(a.androidActivity).toBe('com.example/.MainActivity');
    expect(() => parseArgs(['--game', 'g', '--platform', 'linux'])).toThrow(/auto.*ios.*android/);
    expect(() => parseArgs(['--game', 'g', '--platform'])).toThrow(/--platform needs a value/);
    expect(() => parseArgs(['--game', 'g', '--build-prefix'])).toThrow(/--build-prefix needs a value/);
  });

  it('parses --lane and rejects anything but device/browser', () => {
    expect(parseArgs(['--game', 'g', '--lane', 'browser']).lane).toBe('browser');
    expect(parseArgs(['--game', 'g', '--lane', 'device']).lane).toBe('device');
    expect(() => parseArgs(['--game', 'g', '--lane', 'android'])).toThrow(/"device" or "browser"/);
    expect(() => parseArgs(['--game', 'g', '--lane'])).toThrow(/--lane needs a value/);
  });

  it('parses --budget-floor and rejects negative/non-numeric values', () => {
    expect(parseArgs(['--game', 'g', '--budget-floor', '10']).budgetFloor).toBe(10);
    expect(parseArgs(['--game', 'g', '--budget-floor', '0']).budgetFloor).toBe(0);
    expect(() => parseArgs(['--game', 'g', '--budget-floor', '-1'])).toThrow(/non-negative/);
    expect(() => parseArgs(['--game', 'g', '--budget-floor', 'x'])).toThrow(/non-negative/);
  });

  it('parses --compare previous run dir', () => {
    expect(parseArgs(['--game', 'g', '--compare', 'docs/evidence/prev']).compare).toBe('docs/evidence/prev');
    expect(() => parseArgs(['--game', 'g', '--compare'])).toThrow(/--compare needs a value/);
  });

  it('parses the panel flags', () => {
    const a = parseArgs([
      '--game', 'g', '--models', 'anthropic/claude-opus-4.1, google/gemini-3.5-flash',
      '--panel-threshold', '70', '--skip-panel',
    ]);
    expect(a.models).toEqual(['anthropic/claude-opus-4.1', 'google/gemini-3.5-flash']);
    expect(a.panelThreshold).toBe(70);
    expect(a.skipPanel).toBe(true);
  });

  it('parses --ensemble (kitchen-sink selects the full roster)', () => {
    expect(parseArgs(['--game', 'g', '--ensemble', 'kitchen-sink']).ensemble).toBe('kitchen-sink');
    expect(() => parseArgs(['--game', 'g', '--ensemble'])).toThrow(/--ensemble needs a value/);
  });

  it('validates the panel-threshold range and non-empty models', () => {
    expect(() => parseArgs(['--game', 'g', '--panel-threshold', '101'])).toThrow(/\[0,100\]/);
    expect(() => parseArgs(['--game', 'g', '--panel-threshold', 'x'])).toThrow(/\[0,100\]/);
    expect(() => parseArgs(['--game', 'g', '--models', ' , '])).toThrow(/at least one model/);
  });

  it('parses all flags', () => {
    const a = parseArgs([
      '--game', 'marble_run', '--device', 'UDID-1', '--captures', 'cap/',
      '--out', 'o/', '--date', '2026-07-06', '--content-inset-top', '10',
      '--content-inset-bottom', '20', '--threshold', '0.05',
      '--strict', '--allow-ungated', '--skip-device',
    ]);
    expect(a).toMatchObject({
      game: 'marble_run', device: 'UDID-1', captures: 'cap/', out: 'o/',
      date: '2026-07-06', contentInsetTop: 10, contentInsetBottom: 20,
      threshold: 0.05, strict: true, allowUngated: true, skipDevice: true,
    });
  });

  it('validates the threshold range', () => {
    expect(() => parseArgs(['--game', 'g', '--threshold', '2'])).toThrow(/\[0,1\]/);
    expect(() => parseArgs(['--game', 'g', '--threshold', 'abc'])).toThrow(/\[0,1\]/);
    expect(parseArgs(['--game', 'g', '--threshold', '0']).threshold).toBe(0);
    expect(parseArgs(['--game', 'g', '--threshold', '1']).threshold).toBe(1);
  });

  it('rejects unknown args and missing values', () => {
    expect(() => parseArgs(['--game', 'g', '--bogus'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['--game'])).toThrow(/--game needs a value/);
    expect(() => parseArgs(['--game', '--device'])).toThrow(/--game needs a value/);
  });
});
