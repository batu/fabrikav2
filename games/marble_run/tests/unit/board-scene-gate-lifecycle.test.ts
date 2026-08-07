import { describe, expect, it, vi } from 'vitest';

import { BoardScene } from '../../src/three/BoardScene';
import type { MarbleColor } from '../../src/marble-board';

interface GateLifecycleHarness {
  rolls: Array<{ change: { color: MarbleColor } }>;
  pendingGateBreakColors: Set<MarbleColor>;
  startGateBreak: (color: MarbleColor) => void;
  releasePendingGateBreak: (color: MarbleColor) => void;
  breakCompletedColor: (color: MarbleColor) => void;
}

describe('BoardScene completed gate lifecycle', () => {
  it('keeps the gate until the final same-color marble finishes travelling', () => {
    const board = Object.create(BoardScene.prototype) as GateLifecycleHarness;
    board.rolls = [{ change: { color: 'red' } }];
    board.pendingGateBreakColors = new Set();
    board.startGateBreak = vi.fn();

    board.breakCompletedColor('red');

    expect(board.startGateBreak).not.toHaveBeenCalled();
    expect(board.pendingGateBreakColors).toContain('red');

    board.rolls = [];
    board.releasePendingGateBreak('red');

    expect(board.startGateBreak).toHaveBeenCalledOnce();
    expect(board.startGateBreak).toHaveBeenCalledWith('red');
    expect(board.pendingGateBreakColors).not.toContain('red');
  });
});
