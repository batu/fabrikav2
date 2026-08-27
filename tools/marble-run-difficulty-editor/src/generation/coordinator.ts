import type { DifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-contract.ts';

import { isGenerationResponse, type AcceptedLevel, type GenerationRequest, type GenerationResponse } from './protocol.ts';

export const GENERATION_DEBOUNCE_MS = 150;

export interface WorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: GenerationRequest): void;
  terminate(): void;
}

export interface GenerationCoordinatorEvents {
  readonly started: (revision: number, latencyAfterDebounceMs: number) => void;
  readonly accepted: (revision: number, result: AcceptedLevel) => void;
  readonly failed: (revision: number, levelId: number, reason: string) => void;
  readonly completed: (revision: number, computeMs: number) => void;
}

export interface CoordinatorMetrics {
  readonly staleResultCount: number;
  readonly workerReplacementCount: number;
  readonly latestStartLatencyMs: number | null;
}

interface PendingGeneration {
  readonly revision: number;
  readonly draft: DifficultyDraft;
  readonly levelIds: readonly number[];
  readonly accepted: readonly AcceptedLevel[];
}

const defaultFactory = (): WorkerLike => new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' });

export class GenerationCoordinator {
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeWorker: WorkerLike | null = null;
  private pending: PendingGeneration | null = null;
  private expectedIndex = 0;
  private debounceElapsedAt = 0;
  private disposed = false;
  private staleResultCount = 0;
  private workerReplacementCount = 0;
  private latestStartLatencyMs: number | null = null;

  constructor(
    private readonly events: GenerationCoordinatorEvents,
    private readonly workerFactory: () => WorkerLike = defaultFactory,
    private readonly now: () => number = () => performance.now(),
  ) {}

  schedule(draft: DifficultyDraft, levelIds: readonly number[], accepted: readonly AcceptedLevel[]): number {
    if (this.disposed) throw new Error('Generation coordinator is disposed.');
    const revision = ++this.revision;
    this.pending = { revision, draft, levelIds: [...new Set(levelIds)].sort((a, b) => a - b), accepted };
    this.cancelTimer();
    this.replaceWorker();
    this.timer = setTimeout(() => this.begin(revision), GENERATION_DEBOUNCE_MS);
    return revision;
  }

  cancel(): void {
    this.pending = null;
    this.cancelTimer();
    this.replaceWorker();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }

  metrics(): CoordinatorMetrics {
    return {
      staleResultCount: this.staleResultCount,
      workerReplacementCount: this.workerReplacementCount,
      latestStartLatencyMs: this.latestStartLatencyMs,
    };
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private replaceWorker(): void {
    if (this.activeWorker === null) return;
    this.activeWorker.onmessage = null;
    this.activeWorker.onerror = null;
    this.activeWorker.terminate();
    this.activeWorker = null;
    this.workerReplacementCount += 1;
  }

  private begin(revision: number): void {
    this.timer = null;
    const pending = this.pending;
    if (this.disposed || pending === null || pending.revision !== revision) return;
    this.expectedIndex = 0;
    this.debounceElapsedAt = this.now();
    const worker = this.workerFactory();
    this.activeWorker = worker;
    worker.onmessage = (event) => this.receive(worker, event.data);
    worker.onerror = () => {
      if (revision !== this.revision) return;
      const nextId = pending.levelIds[this.expectedIndex];
      if (nextId !== undefined) this.events.failed(revision, nextId, 'Generation worker stopped unexpectedly.');
    };
    worker.postMessage({ type: 'generate', ...pending });
  }

  private receive(worker: WorkerLike, value: unknown): void {
    if (!isGenerationResponse(value)) return;
    const message: GenerationResponse = value;
    if (worker !== this.activeWorker || message.revision !== this.revision) {
      this.staleResultCount += 1;
      return;
    }
    const pending = this.pending;
    if (pending === null) return;
    if (message.type === 'started') {
      this.latestStartLatencyMs = this.now() - this.debounceElapsedAt;
      this.events.started(message.revision, this.latestStartLatencyMs);
      return;
    }
    if (message.type === 'complete') {
      this.events.completed(message.revision, message.computeMs);
      this.activeWorker = null;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      return;
    }
    const levelId = message.type === 'accepted' ? message.result.level.id : message.levelId;
    const expected = pending.levelIds[this.expectedIndex];
    if (levelId !== expected) {
      this.staleResultCount += 1;
      return;
    }
    this.expectedIndex += 1;
    if (message.type === 'accepted') this.events.accepted(message.revision, message.result);
    else this.events.failed(message.revision, message.levelId, message.failure.reason);
  }
}
