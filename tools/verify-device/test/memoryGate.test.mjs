import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMORY_LIMIT_MB,
  evaluateMemoryGate,
  formatMemoryGate,
  parseSampleLines,
  parseSysmonProcesses,
  selectGameWebContent,
} from '../src/memoryGate.mjs';

const MB = 1024 * 1024;

const SYSMON = [
  { pid: 1, name: 'App', execName: '/private/var/containers/Bundle/Application/X/App.app/App', physFootprint: 16 * MB },
  { pid: 2, name: 'com.apple.WebKit.WebContent', execName: '/x/WebContent', physFootprint: 52 * MB },
  { pid: 3, name: 'com.apple.WebKit.WebContent', execName: '/x/WebContent', physFootprint: 1389 * MB },
  { pid: 4, name: 'SpringBoard', execName: '/x/SpringBoard', physFootprint: 200 * MB },
  { pid: 'bad' },
];

describe('sysmon parsing', () => {
  it('parses process rows and drops malformed ones', () => {
    const rows = parseSysmonProcesses(JSON.stringify(SYSMON));
    expect(rows.map((r) => r.pid)).toEqual([1, 2, 3, 4]);
  });

  it('selects the largest WebContent as the game page, not the ad WebViews', () => {
    const web = selectGameWebContent(parseSysmonProcesses(SYSMON));
    expect(web?.pid).toBe(3);
    expect(selectGameWebContent([])).toBeNull();
  });

  it('parses sampler JSONL and ignores broken lines', () => {
    const samples = parseSampleLines('{"at":"t1","pid":3,"footprintMb":700}\nnot json\n\n{"at":"t2","error":"boom"}\n');
    expect(samples).toHaveLength(2);
    expect(samples[1].error).toBe('boom');
  });
});

describe('evaluateMemoryGate', () => {
  it('passes when every sample is at or under the limit and reports the peak', () => {
    const gate = evaluateMemoryGate({ samples: [
      { at: 't1', pid: 3, footprintMb: 680 }, { at: 't2', pid: 3, footprintMb: 960.4 }, { at: 't3', pid: 3, footprintMb: 772 },
    ] });
    expect(gate.status).toBe('pass');
    expect(gate.peakMb).toBe(960);
    expect(gate.peakAt).toBe('t2');
    expect(gate.limitMb).toBe(DEFAULT_MEMORY_LIMIT_MB);
  });

  it('fails on the 2026-09-10 shipped numbers (1.3 GB at home, 1.6 GB at level)', () => {
    const gate = evaluateMemoryGate({ samples: [
      { at: 'home', pid: 3, footprintMb: 1310 }, { at: 'level', pid: 3, footprintMb: 1682 },
    ] });
    expect(gate.status).toBe('fail');
    expect(gate.peakMb).toBe(1682);
    expect(gate.reason).toContain('> 1024 MB');
  });

  it('is unavailable, not a pass, when the tunnel is down or samples are missing', () => {
    expect(evaluateMemoryGate({ samples: [] }).status).toBe('unavailable');
    const gate = evaluateMemoryGate({ samples: [
      { at: 't1', error: 'InvalidServiceError: tunneld' }, { at: 't2', footprintMb: 700 },
    ] });
    expect(gate.status).toBe('unavailable');
    expect(gate.reason).toContain('tunneld');
  });

  it('honours a custom limit', () => {
    expect(evaluateMemoryGate({ samples: [{ footprintMb: 900 }, { footprintMb: 901 }], limitMb: 900 }).status).toBe('fail');
  });

  it('formats one stdout line per status', () => {
    expect(formatMemoryGate(null)).toContain('SKIPPED');
    expect(formatMemoryGate({ status: 'fail', reason: 'x' })).toContain('FAIL');
    expect(formatMemoryGate({ status: 'unavailable', reason: 'x' })).toContain('UNAVAILABLE');
  });
});
