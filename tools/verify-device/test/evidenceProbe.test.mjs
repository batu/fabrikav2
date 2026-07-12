import { describe, expect, it } from 'vitest';

import {
  createShellEvidenceProbe,
  evidenceProbeWindowKeyForGame as producerWindowKey,
} from '@fabrikav2/testkit/harness';

import {
  SHELL_EVIDENCE_PROBE_VERSION,
  evidenceProbeWindowKeyForGame,
  parseShellEvidenceProbeSnapshot,
  validateShellEvidenceProbeSnapshot,
} from '../src/evidenceProbe.mjs';

const REVISION = `sha256-${'cd34'.repeat(16)}`;

function producerSnapshot() {
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
        {
          actionId: 'shop-restore',
          instanceId: 'shop.restore',
          x: 97.5,
          y: 742.4,
          width: 195,
          height: 52.6,
          visible: true,
          disabled: false,
        },
        {
          actionId: 'back',
          instanceId: 'shop.back',
          x: 15.6,
          y: 77.8,
          width: 54.6,
          height: 52.6,
          visible: true,
          disabled: false,
        },
      ],
    },
  });
  return probe.snapshot();
}

describe('evidence probe wire contract round trip', () => {
  it('accepts a producer snapshot with zero adaptation', () => {
    const snapshot = producerSnapshot();
    expect(validateShellEvidenceProbeSnapshot(snapshot)).toEqual([]);
    const parsed = parseShellEvidenceProbeSnapshot(snapshot);
    expect(parsed).toBe(snapshot);
    expect(parsed.probeVersion).toBe(SHELL_EVIDENCE_PROBE_VERSION);
    expect(parsed.sentinel).toBe('cd34cd34');
    expect(parsed.actions.map((action) => action.actionId)).toEqual(['back', 'shop-restore']);
  });

  it('derives the same window key on both sides of the wire', () => {
    expect(evidenceProbeWindowKeyForGame('shell_proof_phaser')).toBe(
      producerWindowKey('shell_proof_phaser'),
    );
  });

  it('names every problem in a corrupted snapshot', () => {
    const snapshot = producerSnapshot();
    const corrupted = {
      ...snapshot,
      probeVersion: 2,
      rendererProfile: 'webgl',
      revision: 'not-a-hash',
      ready: 'yes',
      actions: [...snapshot.actions].reverse(),
    };
    const problems = validateShellEvidenceProbeSnapshot(corrupted);
    expect(problems).toEqual(
      expect.arrayContaining([
        'probeVersion must be 1',
        'unknown renderer profile "webgl"',
        'revision must be null or a sha256 content id',
        'ready must be boolean',
        'actions must be sorted by actionId then instanceId',
      ]),
    );
    expect(() => parseShellEvidenceProbeSnapshot(corrupted)).toThrowError(TypeError);
  });

  it('rejects non-object snapshots outright', () => {
    expect(validateShellEvidenceProbeSnapshot(null)).toEqual(['snapshot must be an object']);
    expect(validateShellEvidenceProbeSnapshot([])).toEqual(['snapshot must be an object']);
  });
});
