import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lintTokenConsumers } from '../src/token-consumers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'token-consumers', name);
const cliPath = join(here, '..', 'src', 'cli.js');

describe('token-consumers', () => {
  it('passes tokens consumed by shared UI, game source, and a live alias dependency', () => {
    const { violations } = lintTokenConsumers(fixture('pass'));
    expect(violations).toEqual([]);
  });

  it('warns on tokens with no source consumer and ignores comment-only references', () => {
    const { violations } = lintTokenConsumers(fixture('warn'));
    const orphans = violations.filter((v) => v.kind === 'orphaned-token');
    expect(orphans.map((v) => v.token).sort()).toEqual([
      '--fab-color-comment-only',
      '--fab-color-unused',
    ]);
    for (const orphan of orphans) {
      expect(orphan.severity).toBe('warn');
      expect(orphan.detail).toContain('orphaned token');
      expect(orphan.file).toMatch(/games\/demo\/design\/tokens\.css/);
      expect(orphan.line).toBeGreaterThan(0);
    }
  });

  it('resolves alias dependencies only when the chain reaches a real consumer', () => {
    const { violations } = lintTokenConsumers(fixture('alias'));
    expect(violations.map((v) => v.token).sort()).toEqual([
      '--fab-color-dead-alias',
      '--fab-color-dead-base',
    ]);
  });

  it('honors intentional-orphan allowlist entries and warns on stale ones', () => {
    const root = fixture('allowlist');
    const { violations } = lintTokenConsumers(root, {
      allowlistPath: join(root, 'tools', 'audit', 'allowlist.json'),
    });

    expect(violations.find((v) => v.token === '--fab-color-intentional')).toBeUndefined();
    const stale = violations.filter((v) => v.kind === 'stale-allowlist');
    expect(stale.map((v) => v.token).sort()).toEqual([
      '--fab-color-live',
      '--fab-color-removed',
    ]);
    expect(stale.every((v) => v.severity === 'warn')).toBe(true);
  });

  it('warns on invalid allowlist entries', () => {
    const root = fixture('invalid-allowlist');
    const { violations } = lintTokenConsumers(root, {
      allowlistPath: join(root, 'tools', 'audit', 'allowlist.json'),
    });

    expect(violations).toEqual([
      expect.objectContaining({
        kind: 'invalid-allowlist',
        game: 'demo',
        token: '--fab-color-intentional',
        severity: 'warn',
      }),
    ]);
    expect(violations[0].detail).toContain('reason');
  });

  it('prints orphaned-token warnings in the CLI while exiting successfully', () => {
    const result = spawnSync(process.execPath, [cliPath, '--root', fixture('cli-warn')], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('⚠ token-consumers: 1 warning(s)');
    expect(result.stdout).toContain('orphaned token');
    expect(result.stdout).toContain('audit passed (with warnings');
  });
});
