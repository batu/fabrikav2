import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintNoLiterals } from '../src/no-literals.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'no-literals', name);

describe('no-literals', () => {
  it('passes token-only packages/ui code', () => {
    const { violations } = lintNoLiterals(fixture('pass'));
    expect(violations).toEqual([]);
  });

  it('fails on hex, rgba, copy, and asset-path literals', () => {
    const { violations } = lintNoLiterals(fixture('fail'));
    const kinds = new Set(violations.map((v) => v.kind));
    expect(kinds).toContain('color');
    expect(kinds).toContain('copy');
    expect(kinds).toContain('asset');
    // hex + rgba + copy + asset = at least four distinct hits
    expect(violations.length).toBeGreaterThanOrEqual(4);
    for (const v of violations) {
      expect(v.file).toMatch(/packages\/ui\/(Bad\.ts|bad\.css)/);
      expect(v.line).toBeGreaterThan(0);
    }
  });

  it('permits hex/rgb only as direct --fab-* token declaration values in .css', () => {
    // pass fixture ships tokens.css with :root{--fab-*: #hex / rgba(...)} — no hits.
    const { violations } = lintNoLiterals(fixture('pass'));
    expect(violations).toEqual([]);
  });

  it('still flags direct css property values and var() fallbacks', () => {
    const { violations } = lintNoLiterals(fixture('fail'));
    const cssColors = violations.filter(
      (v) => v.kind === 'color' && /bad\.css/.test(v.file),
    );
    // `color: #fff` (direct value) AND `var(--fab-color-accent, #fff)` (fallback)
    // both remain violations; the token carve-out must not rescue them.
    expect(cssColors.length).toBe(2);
  });

  it('honors the literals allowlist', () => {
    const withList = lintNoLiterals(fixture('fail'), {
      allowlistPath: join(here, 'fixtures', 'no-literals', 'allowlist.json'),
    });
    // allowlist permits the hex value, so no 'color' hit for '#ff0000' remains
    const hexHits = withList.violations.filter((v) => v.value === '#ff0000');
    expect(hexHits).toEqual([]);
  });

  it('passes a game.config.ts that uses a copy KEY for the title', () => {
    const { violations } = lintNoLiterals(fixture('config-pass'));
    expect(violations).toEqual([]);
  });

  it('warns on a raw user-facing title literal in game.config.ts', () => {
    const { violations } = lintNoLiterals(fixture('config-fail'));
    const copy = violations.filter((v) => v.kind === 'copy');
    expect(copy).toHaveLength(1);
    expect(copy[0]).toMatchObject({ value: 'Marble Madness Deluxe', severity: 'warn' });
    expect(copy[0].file).toMatch(/games\/badgame\/game\.config\.ts/);
  });
});
