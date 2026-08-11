import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultDifficultyDraft, type DifficultyDraft } from '../../../games/marble_run/src/levels/difficulty-contract.ts';

import { App } from './App.tsx';
import { EditorWorkspace } from './domain/workspace.ts';
import { WorkspaceOwner } from './domain/workspaceOwner.ts';
import type { WorkerLike } from './generation/coordinator.ts';

const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

function changedDraft(): DifficultyDraft {
  const draft = createDefaultDifficultyDraft();
  return {
    ...draft,
    authored: {
      ...draft.authored,
      baseCycle: draft.authored.baseCycle.map((slot, index) => index === 3
        ? { ...slot, targetRange: { min: 12, max: 16 } }
        : slot),
    },
  };
}

describe('App StrictMode ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('constructs one workspace and one worker across the real StrictMode probe mount', async () => {
    let constructions = 0;
    let workerCreations = 0;
    let terminations = 0;
    let workspace: EditorWorkspace | null = null;
    const owner = new WorkspaceOwner(() => {
      constructions += 1;
      workspace = new EditorWorkspace({
        storage: null,
        workerFactory: () => {
          workerCreations += 1;
          return {
            onmessage: null,
            onerror: null,
            postMessage: vi.fn(),
            terminate: () => { terminations += 1; },
          } satisfies WorkerLike;
        },
      });
      return workspace;
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => { root.render(<StrictMode><App workspaceOwner={owner} /></StrictMode>); });
    expect(constructions).toBe(1);
    expect(workspace).not.toBeNull();

    act(() => {
      (workspace as EditorWorkspace).edit(changedDraft());
      vi.advanceTimersByTime(150);
    });
    expect(workerCreations).toBe(1);

    await act(async () => { root.unmount(); });
    await Promise.resolve();
    expect(terminations).toBe(1);
    container.remove();
  });
});
