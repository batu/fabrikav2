import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultDifficultyDraft, type DifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-contract.ts';

import { GENERATION_DEBOUNCE_MS, GenerationCoordinator, type WorkerLike } from './coordinator.ts';
import type { AcceptedLevel, GenerationRequest, GenerationResponse } from './protocol.ts';

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: GenerationRequest[] = [];
  terminated = false;
  postMessage(message: GenerationRequest): void { this.requests.push(message); }
  terminate(): void { this.terminated = true; }
  send(message: GenerationResponse): void { this.onmessage?.({ data: message } as MessageEvent); }
}

function accepted(id: number): AcceptedLevel {
  return {
    level: { id } as AcceptedLevel['level'],
    evidence: { levelId: id } as AcceptedLevel['evidence'],
    effectiveInputFingerprint: `input-${id}`,
    seed: id,
  };
}

describe('GenerationCoordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces meaningful edits into exactly one request after 150ms', () => {
    const workers: FakeWorker[] = [];
    const coordinator = new GenerationCoordinator({ started: vi.fn(), accepted: vi.fn(), failed: vi.fn(), completed: vi.fn() }, () => {
      const worker = new FakeWorker(); workers.push(worker); return worker;
    });
    const draft = createDefaultDifficultyDraft();
    coordinator.schedule(draft, [3], []);
    vi.advanceTimersByTime(100);
    coordinator.schedule(draft, [3, 4], []);
    vi.advanceTimersByTime(GENERATION_DEBOUNCE_MS - 1);
    expect(workers).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.requests).toHaveLength(1);
    expect(workers[0]!.requests[0]!.levelIds).toEqual([3, 4]);
  });

  it('hard-terminates a worst-case worker and rejects all stale result phases', () => {
    const workers: FakeWorker[] = [];
    const acceptedEvent = vi.fn();
    const coordinator = new GenerationCoordinator({ started: vi.fn(), accepted: acceptedEvent, failed: vi.fn(), completed: vi.fn() }, () => {
      const worker = new FakeWorker(); workers.push(worker); return worker;
    });
    const draft: DifficultyDraft = createDefaultDifficultyDraft();
    coordinator.schedule(draft, [1], []);
    vi.advanceTimersByTime(150);
    const worstCase = workers[0]!;
    const staleDelivery = worstCase.onmessage!;
    coordinator.schedule(draft, [2], []);
    expect(worstCase.terminated).toBe(true);
    staleDelivery({ data: { type: 'accepted', revision: 1, result: accepted(1) } } as MessageEvent);
    staleDelivery({ data: { type: 'complete', revision: 1, computeMs: 99_999 } } as MessageEvent);
    expect(acceptedEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(workers).toHaveLength(2);
    workers[1]!.send({ type: 'started', revision: 2 });
    expect(coordinator.metrics().latestStartLatencyMs).toBeLessThanOrEqual(250);
    expect(coordinator.metrics().staleResultCount).toBe(2);
  });

  it('accepts incrementally in ascending order and reports failure without replacing prior state', () => {
    const worker = new FakeWorker();
    const acceptedEvent = vi.fn();
    const failed = vi.fn();
    const coordinator = new GenerationCoordinator({ started: vi.fn(), accepted: acceptedEvent, failed, completed: vi.fn() }, () => worker);
    coordinator.schedule(createDefaultDifficultyDraft(), [7, 3, 5], [accepted(3)]);
    vi.advanceTimersByTime(150);
    worker.send({ type: 'accepted', revision: 1, result: accepted(5) });
    expect(acceptedEvent).not.toHaveBeenCalled();
    worker.send({ type: 'failed', revision: 1, levelId: 3, failure: { code: 'reseed-exhausted', levelId: 3, attempts: 80, reason: 'No valid board.' } });
    worker.send({ type: 'accepted', revision: 1, result: accepted(5) });
    worker.send({ type: 'accepted', revision: 1, result: accepted(7) });
    expect(failed).toHaveBeenCalledWith(1, 3, 'No valid board.');
    expect(acceptedEvent.mock.calls.map((call) => call[1].level.id)).toEqual([5, 7]);
  });
});
