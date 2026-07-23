import { describe, it, expect } from 'vitest';
import { buildLandGateSteps, parseLandGateArgs, runLandGate } from '../src/land-gate.mjs';

describe('parseLandGateArgs', () => {
  it('parses optional landed-gate selectors', () => {
    expect(parseLandGateArgs(['--branch', 'trello-abc12345-x', '--onto', 'main'])).toMatchObject({
      branch: 'trello-abc12345-x',
      shortid: null,
      onto: 'main',
    });
    expect(parseLandGateArgs(['--shortid', 'abc12345'])).toMatchObject({
      branch: null,
      shortid: 'abc12345',
      onto: 'HEAD',
    });
  });

  it('rejects ambiguous selectors', () => {
    expect(() => parseLandGateArgs(['--branch', 'b', '--shortid', 'abc12345'])).toThrow(/EITHER/);
  });
});

describe('buildLandGateSteps', () => {
  it('runs project and landed gates in order when a branch is supplied', () => {
    const steps = buildLandGateSteps({
      scriptDir: '/repo/tools/verify-gate',
      args: parseLandGateArgs(['--branch', 'trello-abc12345-x']),
    });
    expect(steps.map((s) => s.name)).toEqual(['project-gate', 'verify-landed-gate']);
    expect(steps[1].args).toContain('trello-abc12345-x');
  });

  it('omits landed-gate when no branch/shortid was supplied', () => {
    const steps = buildLandGateSteps({ scriptDir: '/repo/tools/verify-gate', args: parseLandGateArgs([]) });
    expect(steps.map((s) => s.name)).toEqual(['project-gate']);
  });

  it('tolerates the retired --skip-merge flag from old callers', () => {
    const steps = buildLandGateSteps({
      scriptDir: '/repo/tools/verify-gate',
      args: parseLandGateArgs(['--skip-merge']),
    });
    expect(steps.map((s) => s.name)).toEqual(['project-gate']);
  });
});

describe('runLandGate', () => {
  it('stops on the first failing child and returns its exit code', () => {
    const seen = [];
    const spawnImpl = (cmd, args) => {
      seen.push(args[0].split('/').pop());
      return seen.length === 2 ? { status: 7 } : { status: 0 };
    };
    const result = runLandGate({
      projectDir: '/repo',
      scriptDir: '/repo/tools/verify-gate',
      args: parseLandGateArgs(['--branch', 'trello-abc12345-x']),
      spawnImpl,
      stdout: { write() {} },
      stderr: { write() {} },
    });
    expect(result).toMatchObject({ ok: false, failed: 'verify-landed-gate', code: 7 });
    expect(seen).toEqual(['project-gate.mjs', 'landed-gate.mjs']);
  });

  it('passes when every child exits 0', () => {
    const seen = [];
    const result = runLandGate({
      projectDir: '/repo',
      scriptDir: '/repo/tools/verify-gate',
      args: parseLandGateArgs(['--shortid', 'abc12345']),
      spawnImpl: (_cmd, args) => {
        seen.push(args[0].split('/').pop());
        return { status: 0 };
      },
      stdout: { write() {} },
      stderr: { write() {} },
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['project-gate.mjs', 'landed-gate.mjs']);
  });
});
