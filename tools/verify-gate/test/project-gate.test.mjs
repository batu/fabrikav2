import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readConfig,
  resolveGateCommands,
  runGate,
  configFileFor,
  CONFIG_PATH,
} from '../src/project-gate.mjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-gate-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeConfig(obj) {
  const file = path.join(dir, CONFIG_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

describe('readConfig + resolveGateCommands (config-read)', () => {
  it('reads twf_gate and returns pre then cmds in order', () => {
    const file = writeConfig({
      twf_gate: {
        pre: ['npm install'],
        cmds: ['npm run typecheck', 'npm run test:unit', 'npm run audit'],
      },
    });
    const cmds = resolveGateCommands(readConfig(file));
    expect(cmds).toEqual([
      'npm install',
      'npm run typecheck',
      'npm run test:unit',
      'npm run audit',
    ]);
  });

  it('tolerates a missing pre block', () => {
    const file = writeConfig({ twf_gate: { cmds: ['npm run test:unit'] } });
    expect(resolveGateCommands(readConfig(file))).toEqual(['npm run test:unit']);
  });

  it('drops blank/non-string entries', () => {
    const file = writeConfig({ twf_gate: { pre: ['', '  '], cmds: ['npm run audit', 5] } });
    expect(resolveGateCommands(readConfig(file))).toEqual(['npm run audit']);
  });

  it('throws when the twf_gate block is absent', () => {
    const file = writeConfig({ trello: {} });
    expect(() => resolveGateCommands(readConfig(file))).toThrow(/no `twf_gate` block/);
  });

  it('throws when twf_gate resolves to zero commands', () => {
    const file = writeConfig({ twf_gate: { pre: [], cmds: [] } });
    expect(() => resolveGateCommands(readConfig(file))).toThrow(/zero commands/);
  });

  it('throws a clear error when the config file is missing', () => {
    expect(() => readConfig(path.join(dir, 'nope.json'))).toThrow(/gate config not found/);
  });

  it('throws a clear error on invalid JSON', () => {
    const file = path.join(dir, CONFIG_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    expect(() => readConfig(file)).toThrow(/not valid JSON/);
  });

  it('configFileFor joins the repo root to the canonical config path', () => {
    expect(configFileFor('/repo')).toBe(path.join('/repo', 'agents/config.json'));
  });
});

describe('runGate (pass/fail orchestration)', () => {
  const gate = {
    twf_gate: { pre: ['npm install'], cmds: ['npm run typecheck', 'npm run test:unit'] },
  };

  it('runs every command in order and PASSES when all are green', () => {
    const seen = [];
    const res = runGate({
      configFile: 'x',
      readConfigImpl: () => gate,
      runner: (cmd) => {
        seen.push(cmd);
        return { ok: true };
      },
    });
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['npm install', 'npm run typecheck', 'npm run test:unit']);
    expect(res.commands).toEqual(seen);
  });

  it('FAILS on the first non-zero command and stops (does not run the rest)', () => {
    const seen = [];
    const res = runGate({
      configFile: 'x',
      readConfigImpl: () => gate,
      runner: (cmd) => {
        seen.push(cmd);
        return cmd === 'npm run typecheck' ? { ok: false, code: 2 } : { ok: true };
      },
    });
    expect(res.ok).toBe(false);
    expect(res.failed).toBe('npm run typecheck');
    expect(res.code).toBe(2);
    // stopped after the failing command — test:unit never ran
    expect(seen).toEqual(['npm install', 'npm run typecheck']);
  });

  it('propagates a config-read failure as a thrown error (fail-closed)', () => {
    expect(() =>
      runGate({
        configFile: 'x',
        readConfigImpl: () => {
          throw new Error('gate config not found: x');
        },
        runner: () => ({ ok: true }),
      }),
    ).toThrow(/gate config not found/);
  });
});
