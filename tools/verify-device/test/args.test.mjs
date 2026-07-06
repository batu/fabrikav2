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
    expect(a.panelThreshold).toBe(85);
    expect(a.skipPanel).toBe(false);
    expect(a.ensemble).toBe('default'); // registry ensemble selected when unset
    expect(a.models).toBeUndefined(); // undefined -> panel.mjs DEFAULT_MODELS
    expect(a.strict).toBe(false);
    expect(a.skipDevice).toBe(false);
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
