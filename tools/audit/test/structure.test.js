import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintStructure } from '../src/structure.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'structure', name);

describe('structure', () => {
  it('passes a canonical game dir (whitelist entries + gitignored .work)', () => {
    const { violations } = lintStructure(fixture('pass'));
    expect(violations).toEqual([]);
  });

  it('fails on the three banned top-level entries, each with a redirect home', () => {
    const { violations } = lintStructure(fixture('fail'));

    const entries = violations.map((v) => v.entry).sort();
    expect(entries).toEqual(['marketing/', 'scripts/', 'test-results/']);

    const byEntry = Object.fromEntries(violations.map((v) => [v.entry, v.home]));
    expect(byEntry['marketing/']).toMatch(/docs\/marketing/);
    expect(byEntry['scripts/']).toMatch(/tools\//);
    expect(byEntry['test-results/']).toMatch(/gitignored/);

    // Every violation names the offending game so the message is actionable.
    for (const v of violations) expect(v.game).toBe('games/badgame');
  });

  it('allows generated ios/ and android/ when the fixture .gitignore covers them', () => {
    const { violations } = lintStructure(fixture('native-pass'));
    expect(violations).toEqual([]);
  });

  it('flags ios/ and android/ when NOT gitignored (must be cap-generated + ignored)', () => {
    const { violations } = lintStructure(fixture('native-fail'));
    const entries = violations.map((v) => v.entry).sort();
    expect(entries).toEqual(['android/', 'ios/']);
    for (const v of violations) {
      expect(v.game).toBe('games/badgame');
      expect(v.home).toMatch(/native-resources|gitignore/);
    }
  });

  // Lane authoring home (card qWCv9tUo): `authoring/` is an EXACT top-level
  // allowance for the dual-design-frontends proof/lane games — not a broad
  // relaxation. A game may carry an editor-native `authoring/` project…
  it('allows the exact authoring/ lane-authoring directory', () => {
    const { violations } = lintStructure(fixture('authoring-pass'));
    expect(violations).toEqual([]);
  });

  // …but a near-miss name is still rejected, proving the allowance is a single
  // literal entry and not a prefix/relaxed match.
  it('still flags a near-miss authoring-* directory (exact allowance only)', () => {
    const { violations } = lintStructure(fixture('authoring-fail'));
    const entries = violations.map((v) => v.entry).sort();
    expect(entries).toEqual(['authoring-plugins/']);
    expect(violations[0].game).toBe('games/badgame');
    expect(violations[0].home).toMatch(/not an allowed top-level game entry/);
  });
});
