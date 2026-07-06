import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintHooks } from '../src/hooks.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'hooks', name);

describe('hooks', () => {
  it('passes when interactive components thread a data-fab-* hook (and ignores non-interactive ones)', () => {
    const { violations } = lintHooks(fixture('pass'));
    expect(violations).toEqual([]);
  });

  it('warns (non-failing) on an interactive component with no stable hook', () => {
    const { violations } = lintHooks(fixture('fail'));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ severity: 'warn' });
    expect(violations[0].file).toMatch(/packages\/ui\/src\/BadButton\.ts$/);
  });

  it('emits every violation as a warning so the gate never hard-fails on it', () => {
    const { violations } = lintHooks(fixture('fail'));
    expect(violations.every((v) => v.severity === 'warn')).toBe(true);
  });
});
