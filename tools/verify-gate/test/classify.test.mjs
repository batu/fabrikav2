import { describe, it, expect } from 'vitest';
import {
  hasDoneLanguage,
  detectUnverified,
  isVisualFile,
  isDocsMarkdownFile,
  isRubberStampExempt,
  decideRubberStamp,
  gamesFromVisualFiles,
  evidenceIsFresh,
} from '../src/classify.mjs';

describe('hasDoneLanguage', () => {
  it('detects each done-language token/phrase (case-insensitive)', () => {
    for (const s of [
      'All done.',
      'This is VERIFIED on device',
      'it works now',
      'the menu renders correctly',
      'render correctly on the phone', // renders? -> optional s
      'looks right to me',
      'the screen matches the reference',
      'pixel-perfect against the mock',
      'fidelity pass against the reference',
      'shipped it',
      'complete on device',
      'Implemented the menu and tested it on device',
      'Validated the interaction on the phone',
      'Confirmed working after the fix',
    ]) {
      expect(hasDoneLanguage(s), s).toBe(true);
    }
  });

  it('does NOT fire on a refactor with no done-claim (the precision that matters)', () => {
    for (const s of [
      'Refactored the scoring loop into a pure function; no behavior change.',
      'Extracted the HUD layout constants into a shared module.',
      'Renamed variables for clarity and updated imports.',
      'pixel issue still unresolved',
      'Needs testing on a Pixel 8 before we call it done.',
      'The fidelity diff still fails.',
      'Implemented the menu, but not tested on device.',
      '', // empty
    ]) {
      expect(hasDoneLanguage(s), s).toBe(false);
    }
  });

  it('word boundaries avoid substring false positives', () => {
    expect(hasDoneLanguage('I abandoned that approach')).toBe(false); // "done" inside "abandoned"
    expect(hasDoneLanguage('using several frameworks here')).toBe(false); // "works" inside "frameworks"
  });
});

describe('detectUnverified', () => {
  it('captures the marker and reason', () => {
    const r = detectUnverified('Changed the HUD.\nUNVERIFIED: no device plugged in right now');
    expect(r.present).toBe(true);
    expect(r.reason).toBe('no device plugged in right now');
  });
  it('present with a fallback reason when none given', () => {
    expect(detectUnverified('UNVERIFIED:').reason).toBe('(no reason given)');
  });
  it('is absent when no marker', () => {
    expect(detectUnverified('all done, looks right').present).toBe(false);
  });
  it('is case-sensitive — lowercase does not trigger the escape hatch', () => {
    expect(detectUnverified('this is unverified: whatever').present).toBe(false);
  });
});

describe('isVisualFile', () => {
  it('matches the three visual globs', () => {
    expect(isVisualFile('games/marble_run/src/main.ts')).toBe(true);
    expect(isVisualFile('games/marble_run/src/scenes/Boot.ts')).toBe(true);
    expect(isVisualFile('games/marble_run/design/tokens.json')).toBe(true);
    expect(isVisualFile('packages/ui/Button.tsx')).toBe(true);
    expect(isVisualFile('packages/ui/nested/deep/thing.css')).toBe(true);
    expect(isVisualFile('./games/marble_run/src/main.ts')).toBe(true); // leading ./
  });
  it('does NOT match non-visual paths', () => {
    expect(isVisualFile('tools/verify-gate/src/classify.mjs')).toBe(false);
    expect(isVisualFile('games/marble_run/README.md')).toBe(false);
    expect(isVisualFile('games/marble_run/tests/scoring.test.ts')).toBe(false);
    expect(isVisualFile('packages/engine/index.ts')).toBe(false);
    expect(isVisualFile('docs/AGENT-HANDOFF.md')).toBe(false);
  });
  it('narrowly excludes games/_template because it is scaffold, not an installable game', () => {
    expect(isVisualFile('games/_template/src/main.ts')).toBe(false);
    expect(isVisualFile('games/_template/design/tokens.json')).toBe(false);
    expect(isVisualFile('games/marble_run/src/main.ts')).toBe(true);
  });
});

describe('rubber-stamp docs-only gate', () => {
  it('recognizes only Markdown under docs/', () => {
    expect(isDocsMarkdownFile('docs/brainstorms/example.md')).toBe(true);
    expect(isDocsMarkdownFile('docs/plans/nested/example.md')).toBe(true);
    expect(isDocsMarkdownFile('games/marble_run/README.md')).toBe(false);
    expect(isDocsMarkdownFile('docs/assets/example.png')).toBe(false);
  });

  it('exempts doc/research/spike cards by label or title prefix', () => {
    expect(isRubberStampExempt({ cardLabels: ['research'] })).toBe(true);
    expect(isRubberStampExempt({ cardLabels: [{ name: 'Documentation' }] })).toBe(true);
    expect(isRubberStampExempt({ cardTitle: 'RESEARCH: measure funnel drift' })).toBe(true);
    expect(isRubberStampExempt({ cardTitle: 'PROCESS: land implementation guard' })).toBe(false);
  });

  it('fails non-exempt docs-only implementation diffs', () => {
    const decision = decideRubberStamp({
      changedFiles: ['docs/brainstorms/example.md', 'docs/plans/example.md'],
      cardTitle: 'MACHINERY 4: land gate',
      cardLabels: [],
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/rubber-stamp/);
  });

  it('passes docs-only diffs for explicit doc/research work and passes mixed diffs', () => {
    expect(decideRubberStamp({
      changedFiles: ['docs/research/example.md'],
      cardLabels: ['research'],
    }).ok).toBe(true);
    expect(decideRubberStamp({
      changedFiles: ['docs/brainstorms/example.md', 'tools/verify-gate/src/classify.mjs'],
      cardTitle: 'MACHINERY 4: land gate',
    }).ok).toBe(true);
  });
});

describe('gamesFromVisualFiles', () => {
  it('extracts unique game slugs', () => {
    expect(gamesFromVisualFiles([
      'games/marble_run/src/a.ts',
      'games/marble_run/design/b.json',
      'games/tower/src/c.ts',
      'packages/ui/x.tsx',
    ])).toEqual(['marble_run', 'tower']);
  });
});

describe('evidenceIsFresh', () => {
  it('fresh when a panel is newer than the newest visual change', () => {
    expect(evidenceIsFresh(1000, [500, 1500])).toBe(true);
  });
  it('stale when every panel is older than the change', () => {
    expect(evidenceIsFresh(1000, [200, 800])).toBe(false);
  });
  it('stale when there are no panels at all', () => {
    expect(evidenceIsFresh(1000, [])).toBe(false);
  });
  it('equal mtime is NOT fresh (strictly newer required)', () => {
    expect(evidenceIsFresh(1000, [1000])).toBe(false);
  });
  it('no stat-able visual change time => not fresh (deleted files fail closed)', () => {
    expect(evidenceIsFresh(null, [])).toBe(false);
  });
  it('requires a matching fresh passing device panel for each affected game', () => {
    const panels = [
      { valid: true, game: 'other', lane: 'device', verdictPass: true, generatedAtMs: 2000 },
      { valid: true, game: 'marble_run', lane: 'browser', verdictPass: true, generatedAtMs: 2000 },
      { valid: true, game: 'marble_run', lane: 'device', verdictPass: false, generatedAtMs: 2000 },
      { valid: true, game: 'marble_run', lane: 'device', verdictPass: true, generatedAtMs: 500 },
    ];
    expect(evidenceIsFresh(1000, panels, ['marble_run'])).toBe(false);
    expect(evidenceIsFresh(1000, [
      ...panels,
      { valid: true, game: 'marble_run', lane: 'device', verdictPass: true, generatedAtMs: 2000 },
    ], ['marble_run'])).toBe(true);
  });
});
