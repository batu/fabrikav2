import type { DifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-contract.ts';

import { DraftStore, type DraftStoreOptions } from './draftStore.ts';
import { GenerationCoordinator, type GenerationCoordinatorEvents, type WorkerLike } from '../generation/coordinator.ts';

export interface EditorWorkspaceOptions extends DraftStoreOptions {
  readonly workerFactory?: () => WorkerLike;
  readonly events?: Partial<GenerationCoordinatorEvents>;
}

/** Owns the single draft/coordinator pair shared by every presentation view. */
export class EditorWorkspace {
  readonly store: DraftStore;
  readonly coordinator: GenerationCoordinator;
  private attachments = 0;
  private pendingDispose = false;
  private disposed = false;

  constructor(options: EditorWorkspaceOptions = {}) {
    this.store = new DraftStore(options);
    this.coordinator = new GenerationCoordinator({
      started: (revision, latency) => options.events?.started?.(revision, latency),
      accepted: (revision, result) => {
        this.store.accept(revision, result);
        options.events?.accepted?.(revision, result);
      },
      failed: (revision, levelId, reason) => {
        this.store.fail(revision, levelId, reason);
        options.events?.failed?.(revision, levelId, reason);
      },
      completed: (revision, computeMs) => options.events?.completed?.(revision, computeMs),
    }, options.workerFactory, options.now);
  }

  edit(nextDraft: DifficultyDraft): readonly number[] {
    if (this.disposed) throw new Error('Editor workspace is disposed.');
    const affected = this.store.edit(nextDraft);
    if (affected.length === 0) return affected;
    const revision = this.coordinator.schedule(nextDraft, affected, Object.values(this.store.getSnapshot().accepted));
    this.store.markGenerating(affected, revision);
    return affected;
  }

  regenerateLevel(levelId: number): boolean {
    if (this.disposed) throw new Error('Editor workspace is disposed.');
    const state = this.store.getSnapshot();
    if (state.draft.locks.some((lock) => lock.levelId === levelId)) return false;
    const revision = this.coordinator.schedule(state.draft, [levelId], Object.values(state.accepted));
    this.store.markGenerating([levelId], revision);
    return true;
  }

  /** Defers final cleanup one microtask so React StrictMode's probe remount reuses the same resources. */
  attach(): () => void {
    if (this.disposed) throw new Error('Editor workspace is disposed.');
    this.attachments += 1;
    this.pendingDispose = false;
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      this.attachments -= 1;
      this.pendingDispose = true;
      queueMicrotask(() => {
        if (!this.pendingDispose || this.attachments !== 0 || this.disposed) return;
        this.disposed = true;
        this.coordinator.dispose();
        this.store.dispose();
      });
    };
  }
}
