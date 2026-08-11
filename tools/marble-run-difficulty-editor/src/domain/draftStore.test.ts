import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalDifficultyJson,
  createDefaultDifficultyDraft,
  type DifficultyDraft,
} from '../../../../games/marble_run/src/levels/difficulty-contract.ts';
import { expandDifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-expand.ts';
import { LEVELS } from '../../../../games/marble_run/src/levels/levels.generated.ts';

import {
  DRAFT_STORAGE_KEY,
  DraftStore,
  MAX_PERSISTED_BYTES,
  PERSISTENCE_VERSION,
  restoreWorkspace,
  type StorageLike,
} from './draftStore.ts';
import { EditorWorkspace } from './workspace.ts';
import { GENERATION_ENGINE_VERSION, type AcceptedLevel } from '../generation/protocol.ts';
import type { WorkerLike } from '../generation/coordinator.ts';

class MemoryStorage implements StorageLike {
  value: string | null = null;
  writes = 0;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { this.value = value; this.writes += 1; }
}

function changedDraft(): DifficultyDraft {
  const draft = createDefaultDifficultyDraft();
  const baseCycle = draft.authored.baseCycle.map((slot, index) => index === 3
    ? { ...slot, targetRange: { min: 12, max: 16 } }
    : slot);
  return { ...draft, authored: { ...draft.authored, baseCycle } };
}

function cached(id: number, draft: DifficultyDraft): AcceptedLevel {
  return {
    level: LEVELS[id - 1]!,
    evidence: {
      levelId: id,
      source: 'derived',
      solvable: true,
      targetRange: { min: 1, max: 20 },
      measuredDifficulty: 10,
      marbleCount: 1,
      solverWaves: 1,
      initiallyMovableShare: 1,
      seed: { provenance: 'unknown' },
      overrideState: 'inherited',
      slot: 'band',
      shapeKind: 'plain',
      reseeds: 0,
      mirrorDistance: 0,
    },
    effectiveInputFingerprint: canonicalDifficultyJson(expandDifficultyDraft(draft)[id - 1]),
    seed: 0,
  };
}

describe('DraftStore persistence and state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a settled edit burst into one sub-1MiB autosave and records write duration', () => {
    const storage = new MemoryStorage();
    let now = 10;
    const store = new DraftStore({ storage, now: () => now++, autosaveMs: 20 });
    store.edit(changedDraft());
    store.accept(1, cached(34, changedDraft()));
    vi.advanceTimersByTime(19);
    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.writes).toBe(1);
    expect(store.getSnapshot().persistedBytes).toBeLessThan(MAX_PERSISTED_BYTES);
    expect(store.getSnapshot().lastWriteDurationMs).toBe(1);
  });

  it('restores compatible accepted results without requesting a rebake', () => {
    const storage = new MemoryStorage();
    const draft = changedDraft();
    storage.value = canonicalDifficultyJson({
      version: PERSISTENCE_VERSION,
      engineVersion: GENERATION_ENGINE_VERSION,
      contractVersion: 1,
      draft,
      accepted: [cached(34, draft)],
    });
    const workspace = new EditorWorkspace({ storage, workerFactory: () => { throw new Error('must not rebake on restore'); } });
    expect(workspace.store.getSnapshot().accepted[34]?.level.id).toBe(34);
    expect(workspace.store.getSnapshot().phase).toBe('Draft');
  });

  it.each([
    ['corrupt', '{'],
    ['unsupported', JSON.stringify({ version: 999 })],
    ['oversized', 'x'.repeat(MAX_PERSISTED_BYTES)],
  ])('fails closed to Current baseline for %s storage', (_label, value) => {
    const storage = new MemoryStorage(); storage.value = value;
    const restored = restoreWorkspace(storage);
    expect(restored.phase).toBe('Current baseline');
    expect(Object.keys(restored.accepted)).toHaveLength(0);
    expect(restored.draft).toEqual(createDefaultDifficultyDraft());
  });

  it('preserves the prior accepted board when its replacement needs attention', () => {
    const store = new DraftStore({ storage: null });
    const previous = cached(34, createDefaultDifficultyDraft());
    store.markGenerating([34], 1);
    store.accept(1, previous);
    store.fail(1, 34, 'No board matched the authored range.');
    expect(store.getSnapshot().accepted[34]).toBe(previous);
    expect(store.getSnapshot().boards[34]).toBe(previous.level);
    expect(store.getSnapshot().levelStates[34]).toBe('Needs attention');
  });

  it('starts with every shipped board as the prior valid display result', () => {
    const store = new DraftStore({ storage: null });
    expect(Object.keys(store.getSnapshot().boards)).toHaveLength(110);
    store.markGenerating([1], 1);
    store.fail(1, 1, 'fixture failure');
    expect(store.getSnapshot().boards[1]).toBe(LEVELS[0]);
  });

  it('makes StrictMode-style attach/detach probes idempotent', async () => {
    const storage = new MemoryStorage();
    let workers = 0;
    let terminations = 0;
    const workspace = new EditorWorkspace({ storage, workerFactory: () => {
      workers += 1;
      return { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: () => { terminations += 1; } } satisfies WorkerLike;
    }});
    const firstDetach = workspace.attach();
    firstDetach();
    const finalDetach = workspace.attach();
    await Promise.resolve();
    workspace.edit(changedDraft());
    vi.advanceTimersByTime(150);
    expect(workers).toBe(1);
    finalDetach();
    await Promise.resolve();
    expect(terminations).toBe(1);
    expect(storage.writes).toBe(1);
  });

  it('does not duplicate an identical subscription', () => {
    const store = new DraftStore({ storage: null });
    const listener = vi.fn();
    const unsubscribeFirst = store.subscribe(listener);
    const unsubscribeSecond = store.subscribe(listener);
    store.selectLevel(2);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    unsubscribeSecond();
    store.selectLevel(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('uses one compact editor key and never game save keys', () => {
    const storage = new MemoryStorage();
    const store = new DraftStore({ storage });
    store.edit(changedDraft());
    store.flushAutosave();
    expect(storage.value).not.toBeNull();
    expect(DRAFT_STORAGE_KEY).toBe('marble-run-difficulty-editor:draft-v1');
  });
});
