// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import {
  SHELL_EVIDENCE_PROBE_VERSION,
  createShellEvidenceProbe,
  evidenceProbeWindowKeyForGame,
  readDomShellEvidenceActions,
  readDomShellEvidenceViewport,
  shellEvidenceSentinelForRevision,
  type ShellEvidenceActionRect,
} from './evidenceProbe.ts';

const REVISION = `sha256-${'ab12'.repeat(16)}`;

function actionRect(overrides: Partial<ShellEvidenceActionRect>): ShellEvidenceActionRect {
  return {
    actionId: 'play',
    instanceId: null,
    x: 0,
    y: 0,
    width: 48,
    height: 48,
    visible: true,
    disabled: false,
    ...overrides,
  };
}

describe('createShellEvidenceProbe', () => {
  it('assembles a canonical snapshot with sorted actions and a revision sentinel', () => {
    const probe = createShellEvidenceProbe({
      gameId: 'shell_proof_grapes',
      contractId: 'shell-presentation-v2',
      rendererProfile: 'dom-css',
      readers: {
        state: () => 'shop',
        revision: () => REVISION,
        ready: () => true,
        viewport: () => ({ width: 390, height: 844, devicePixelRatio: 3 }),
        actions: () => [
          actionRect({ actionId: 'shop-restore' }),
          actionRect({ actionId: 'back', instanceId: 'shop.back' }),
        ],
      },
    });
    const snapshot = probe.snapshot();
    expect(snapshot.probeVersion).toBe(SHELL_EVIDENCE_PROBE_VERSION);
    expect(snapshot.state).toBe('shop');
    expect(snapshot.revision).toBe(REVISION);
    expect(snapshot.sentinel).toBe('ab12ab12');
    expect(snapshot.ready).toBe(true);
    expect(snapshot.actions.map((action) => action.actionId)).toEqual(['back', 'shop-restore']);
  });

  it('reports a null revision and sentinel while running the seed design', () => {
    const probe = createShellEvidenceProbe({
      gameId: 'shell_proof_phaser',
      contractId: 'shell-presentation-v2',
      rendererProfile: 'phaser-native',
      readers: {
        state: () => 'menu',
        revision: () => null,
        ready: () => false,
        viewport: () => ({ width: 390, height: 844, devicePixelRatio: 2 }),
        actions: () => [],
      },
    });
    const snapshot = probe.snapshot();
    expect(snapshot.revision).toBeNull();
    expect(snapshot.sentinel).toBeNull();
    expect(snapshot.ready).toBe(false);
  });

  it('derives sentinels only from well-formed revision ids', () => {
    expect(shellEvidenceSentinelForRevision(null)).toBeNull();
    expect(shellEvidenceSentinelForRevision('not-a-hash')).toBeNull();
    expect(shellEvidenceSentinelForRevision(REVISION)).toBe('ab12ab12');
  });

  it('derives the host-readable window key from the game id', () => {
    expect(evidenceProbeWindowKeyForGame('shell_proof_grapes')).toBe(
      '__SHELL_PROOF_GRAPES_EVIDENCE_PROBE__',
    );
  });
});

describe('readDomShellEvidenceActions', () => {
  it('collects data-fab-action hooks with identity and disabled flags', () => {
    document.body.innerHTML = `
      <div id="root">
        <button data-fab-action="play" data-fab-instance="menu.play">Play</button>
        <button data-fab-action="back" data-fab-instance="shop.back" aria-disabled="true">Back</button>
        <div aria-hidden="true"><button data-fab-action="settings">Settings</button></div>
        <button>No hook</button>
      </div>`;
    const actions = readDomShellEvidenceActions(document.getElementById('root')!);
    expect(actions.map((action) => [action.actionId, action.instanceId, action.disabled])).toEqual([
      ['back', 'shop.back', true],
      ['play', 'menu.play', false],
      ['settings', null, false],
    ]);
    const hiddenSettings = actions.find((action) => action.actionId === 'settings')!;
    expect(hiddenSettings.visible).toBe(false);
  });

  it('reads the viewport facts from a window-like view', () => {
    expect(
      readDomShellEvidenceViewport({ innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 }),
    ).toEqual({ width: 390, height: 844, devicePixelRatio: 3 });
  });
});
