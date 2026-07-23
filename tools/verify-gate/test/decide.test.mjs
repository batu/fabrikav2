import { describe, it, expect } from 'vitest';
import { decideStop, decideMerge, buildBlockMessage } from '../src/classify.mjs';

// Baseline inputs for a gated situation: a done-claim, a changed game src file,
// a stale panel. Individual tests override one axis at a time.
const base = {
  message: 'All done — the marble menu renders correctly on device.',
  changedFiles: ['games/marble_run/src/menu.ts'],
  newestVisualMtimeMs: 2000, // change newer than the panel below
  panelEvidence: [{ valid: true, game: 'marble_run', lane: 'device', verdictPass: true, generatedAtMs: 1000 }], // stale
  toolPresent: true,
  gamesDirPresent: true,
};

describe('decideStop — the block gate', () => {
  it('BLOCKS on claim + visual + stale-evidence + no-UNVERIFIED', () => {
    const d = decideStop(base);
    expect(d.action).toBe('block');
    expect(d.visualFiles).toEqual(['games/marble_run/src/menu.ts']);
    expect(d.games).toEqual(['marble_run']);
  });

  it('PASSES when the branch visual diff was not authored by this session', () => {
    const d = decideStop({ ...base, sessionFiles: ['docs/plan.md', 'tools/x.mjs'] });
    expect(d.action).toBe('pass');
    expect(d.reason).toMatch(/not authored by this session/);
  });

  it('PASSES a planning-only session (no edits at all) despite a dirty shared tree', () => {
    const d = decideStop({ ...base, sessionFiles: [] });
    expect(d.action).toBe('pass');
  });

  it('still BLOCKS when this session edited one of the visual files', () => {
    const d = decideStop({
      ...base,
      changedFiles: ['games/marble_run/src/menu.ts', 'games/arrow/src/main.ts'],
      sessionFiles: ['games/marble_run/src/menu.ts'],
    });
    expect(d.action).toBe('block');
    expect(d.visualFiles).toEqual(['games/marble_run/src/menu.ts']);
  });

  it('gates the whole diff when session attribution is unknown (sessionFiles null)', () => {
    const d = decideStop({ ...base, sessionFiles: null });
    expect(d.action).toBe('block');
  });

  it('PASSES a refactor: visual change but NO done-claim (gate on the claim, not the file)', () => {
    const d = decideStop({ ...base, message: 'Refactored menu layout into a pure helper. No behavior change.' });
    expect(d.action).toBe('pass');
  });

  it('PASSES when fresh evidence covers the change', () => {
    const d = decideStop({
      ...base,
      panelEvidence: [{ valid: true, game: 'marble_run', lane: 'device', verdictPass: false, generatedAtMs: 3000 }],
    });
    expect(d.action).toBe('pass');
    expect(d.reason).toMatch(/fresh/);
  });

  it('BLOCKS the false-miss probe: implemented and tested on device', () => {
    const d = decideStop({
      ...base,
      message: 'Implemented the menu and tested it on device.',
    });
    expect(d.action).toBe('block');
  });

  it('PASSES false-fire probes with no final done-claim', () => {
    for (const message of ['pixel issue still unresolved', 'Test pending on Pixel 8.']) {
      const d = decideStop({ ...base, message });
      expect(d.action, message).toBe('pass');
    }
  });

  it('NO-OP when no changed file is visual (a pure engine change with a done-claim)', () => {
    const d = decideStop({ ...base, changedFiles: ['packages/engine/index.ts', 'docs/x.md'] });
    expect(d.action).toBe('noop');
  });

  it('LEDGER (no block) when the UNVERIFIED escape hatch is present', () => {
    const d = decideStop({ ...base, message: base.message + '\nUNVERIFIED: no signed device on this runner' });
    expect(d.action).toBe('ledger');
    expect(d.ledgerReason).toBe('no signed device on this runner');
    expect(d.visualFiles).toEqual(['games/marble_run/src/menu.ts']);
  });

  it('SELF-DISABLES to no-op when the verify-device tool is absent', () => {
    expect(decideStop({ ...base, toolPresent: false }).action).toBe('noop');
  });

  it('SELF-DISABLES to no-op when games/ is absent', () => {
    expect(decideStop({ ...base, gamesDirPresent: false }).action).toBe('noop');
  });
});

describe('buildBlockMessage', () => {
  it('names the files, the exact command, and cites AGENTS.md #8', () => {
    const msg = buildBlockMessage({ visualFiles: ['games/marble_run/src/menu.ts'], games: ['marble_run'] });
    expect(msg).toContain('games/marble_run/src/menu.ts');
    expect(msg).toContain('npm run verify-device -- --game marble_run');
    expect(msg).toContain('AGENTS.md #8');
    expect(msg).toContain('UNVERIFIED:');
  });
  it('falls back to a <game> placeholder when no game slug (packages/ui change)', () => {
    const msg = buildBlockMessage({ visualFiles: ['packages/ui/Button.tsx'], games: [] });
    expect(msg).toContain('npm run verify-device -- --game <game>');
  });
});

describe('decideMerge — the ship-time backstop', () => {
  const mbase = {
    changedFiles: ['games/marble_run/src/menu.ts'],
    newestVisualMtimeMs: 2000,
    panelEvidence: [{ valid: true, game: 'marble_run', lane: 'device', verdictPass: true, generatedAtMs: 1000 }], // stale
    ledgerEntryCount: 0,
    toolPresent: true,
    gamesDirPresent: true,
  };

  it('FAILS when the worktree has uncommitted changes', () => {
    const d = decideMerge({ ...mbase, worktreeDirtyFiles: ['src/work.ts'] });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/uncommitted worktree/);
    expect(d.dirtyFiles).toEqual(['src/work.ts']);
  });

  it('FAILS a non-exempt implementation card whose diff is only docs/**/*.md', () => {
    const d = decideMerge({
      ...mbase,
      changedFiles: ['docs/brainstorms/requirements.md', 'docs/plans/plan.md'],
      cardTitle: 'MACHINERY 4: land gate',
      cardLabels: [],
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/rubber-stamp/);
    expect(d.docsOnlyFiles).toEqual(['docs/brainstorms/requirements.md', 'docs/plans/plan.md']);
  });

  it('PASSES docs-only diffs when the card is explicitly doc/research-exempt', () => {
    expect(decideMerge({
      ...mbase,
      changedFiles: ['docs/research/note.md'],
      cardLabels: ['research'],
    }).ok).toBe(true);
    expect(decideMerge({
      ...mbase,
      changedFiles: ['docs/brainstorms/note.md'],
      cardTitle: 'DOCS: refresh handoff',
    }).ok).toBe(true);
  });

  it('FAILS when the only evidence is UNVERIFIED ledger entries', () => {
    const d = decideMerge({ ...mbase, ledgerEntryCount: 3 });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/3 UNVERIFIED ledger entries/);
  });

  it('FAILS a visual change with no fresh panel and an empty ledger', () => {
    const d = decideMerge(mbase);
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/no verify-device panel\.json/);
  });

  it('PASSES when a fresh panel covers the change', () => {
    expect(decideMerge({
      ...mbase,
      panelEvidence: [{ valid: true, game: 'marble_run', lane: 'device', verdictPass: true, generatedAtMs: 3000 }],
    }).ok).toBe(true);
  });

  it('PASSES F4 scenario: fresh marble_run device panel with failing verdict', () => {
    const d = decideMerge({
      ...mbase,
      panelEvidence: [{
        valid: true,
        game: 'marble_run',
        lane: 'device',
        verdictPass: false,
        verdictScore: 45,
        verdictSummary: 'FAIL — panel median 45%',
        generatedAtMs: 3000,
      }],
    });
    expect(d.ok).toBe(true);
    expect(d.reason).toMatch(/observed the visual change on device/);
    expect(d.reason).toMatch(/verdict FAIL/);
    expect(d.reason).toMatch(/45/);
  });

  it('FAILS for cross-game, browser-lane, corrupt, and stale panels', () => {
    const badPanels = [
      [{ valid: true, game: 'other', lane: 'device', verdictPass: true, generatedAtMs: 3000 }],
      [{ valid: true, game: 'marble_run', lane: 'browser', verdictPass: true, generatedAtMs: 3000 }],
      [{ valid: false, error: 'panel is not valid JSON' }],
      [{ valid: true, game: 'marble_run', lane: 'device', verdictPass: true, generatedAtMs: 1000 }],
    ];
    for (const panelEvidence of badPanels) {
      expect(decideMerge({ ...mbase, panelEvidence }).ok).toBe(false);
    }
  });

  it('FAILS closed for a deleted visual file with no stat-able change time or panel', () => {
    expect(decideMerge({
      ...mbase,
      changedFiles: ['games/marble_run/src/deleted.ts'],
      newestVisualMtimeMs: null,
      panelEvidence: [],
    }).ok).toBe(false);
  });

  it('PASSES (not applicable) for a non-visual diff', () => {
    expect(decideMerge({ ...mbase, changedFiles: ['packages/engine/x.ts'] }).ok).toBe(true);
  });

  it('SELF-DISABLES (pass) when tool or games/ absent', () => {
    expect(decideMerge({ ...mbase, toolPresent: false }).ok).toBe(true);
    expect(decideMerge({ ...mbase, gamesDirPresent: false }).ok).toBe(true);
  });
});
