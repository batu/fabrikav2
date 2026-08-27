import { describe, expect, it, vi } from 'vitest';

import { LEVELS } from '../../../../games/marble_run/src/levels/levels.generated.ts';
import type { GameplayHooks } from '../../../../games/marble_run/src/gameplay/GameplayController.ts';

import { EditorGameplayPreview, type PreviewController } from './EditorGameplayPreview.ts';

describe('EditorGameplayPreview', () => {
  it('plays the injected board, restarts it, and keeps every runtime adapter inert', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const starts = vi.fn();
    const dispose = vi.fn();
    let hooks: GameplayHooks | null = null;
    const outcomes: string[] = [];
    const preview = new EditorGameplayPreview(host, {
      onOutcome: (outcome) => outcomes.push(outcome),
      controllerFactory: (_host, injectedHooks) => {
        hooks = injectedHooks;
        return { startLevelDefinition: starts, dispose } satisfies PreviewController;
      },
    });
    const draftBoard = { ...LEVELS[45]!, hearts: 2 };
    preview.open(draftBoard);
    expect(starts).toHaveBeenCalledWith(draftBoard);
    expect(preview.restart()).toBe(true);
    expect(starts).toHaveBeenCalledTimes(2);
    expect(hooks!.getCoins()).toBe(0);
    expect(hooks!.spendCoins(999)).toBe(false);
    hooks!.onHintUsed?.();
    hooks!.openSettings();
    hooks!.onWin(46, 999);
    hooks!.onFail(46);
    expect(outcomes).toEqual(['playing', 'playing', 'won', 'failed']);
    preview.close();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.isConnected).toBe(true);
    host.remove();
  });

  it('fully disposes the previous controller before switching boards', () => {
    const order: string[] = [];
    let instance = 0;
    const preview = new EditorGameplayPreview(document.createElement('div'), {
      controllerFactory: () => {
        const id = ++instance;
        return {
          startLevelDefinition: (level) => order.push(`start:${id}:${level.id}`),
          dispose: () => order.push(`dispose:${id}`),
        };
      },
    });
    preview.open(LEVELS[0]!);
    preview.open(LEVELS[45]!);
    preview.dispose();
    preview.dispose();
    expect(order).toEqual(['start:1:1', 'dispose:1', 'start:2:46', 'dispose:2']);
  });
});
