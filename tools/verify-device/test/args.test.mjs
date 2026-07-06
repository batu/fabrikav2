import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/args.mjs';

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
    expect(a.strict).toBe(false);
    expect(a.skipDevice).toBe(false);
  });

  it('parses all flags', () => {
    const a = parseArgs([
      '--game', 'marble_run', '--device', 'UDID-1', '--captures', 'cap/',
      '--out', 'o/', '--date', '2026-07-06', '--threshold', '0.05',
      '--strict', '--skip-device',
    ]);
    expect(a).toMatchObject({
      game: 'marble_run', device: 'UDID-1', captures: 'cap/', out: 'o/',
      date: '2026-07-06', threshold: 0.05, strict: true, skipDevice: true,
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
