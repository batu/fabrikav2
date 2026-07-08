import {
  canonicalAnalyticsEvents,
  isForbiddenAnalyticsIdentifierKey,
  looksSensitiveAnalyticsValue,
  type CanonicalAnalyticsEventDefinition,
  type CanonicalAnalyticsEventId,
} from './CanonicalAnalyticsEvents';
import { readOwnedAnalyticsMirrorConfigFromImportMetaEnv, type OwnedAnalyticsMirrorConfig } from './OwnedAnalyticsMirrorConfig';

type AnalyticsPrimitive = string | number | boolean | null | undefined;
type AnalyticsParams = Record<string, AnalyticsPrimitive>;

interface OwnedAnalyticsMirrorInput {
  readonly id: CanonicalAnalyticsEventId;
  readonly params?: object;
}

interface QueuedMirrorEvent {
  readonly id: CanonicalAnalyticsEventId;
  readonly params: AnalyticsParams;
  readonly event_occurrence_id: string;
  readonly dedupe_key: string;
  readonly enqueued_at_ms: number;
  readonly attempt: number;
  readonly byte_size: number;
  readonly next_attempt_ms: number;
}

export interface OwnedAnalyticsMirrorStats {
  readonly enqueued: number;
  readonly sent: number;
  readonly dropped: number;
  readonly retried: number;
  readonly queueLength: number;
  readonly queueBytes: number;
  readonly dropReasons: Readonly<Record<string, number>>;
}

interface MirrorTransportResponse {
  readonly ok: boolean;
  readonly status: number;
}

type MirrorTransport = (request: {
  readonly url: string;
  readonly publicClientKey: string;
  readonly body: string;
  readonly timeoutMs: number;
}) => Promise<MirrorTransportResponse>;

interface OwnedAnalyticsMirrorDependencies {
  readonly nowMs?: () => number;
  readonly random?: () => number;
  readonly transport?: MirrorTransport;
  readonly logger?: Pick<Console, 'warn'>;
}

const mirrorFieldAllowlists = new Map(
  (canonicalAnalyticsEvents as readonly CanonicalAnalyticsEventDefinition[]).map((event) => [
    event.id,
    new Set([
      ...event.primaryDimensions,
      ...(event.allowedGameAnalyticsCustomFields ?? []),
      'app_version',
      'platform',
      'cohort_bucket',
    ]),
  ]),
);

export class OwnedAnalyticsMirror {
  private readonly nowMs: () => number;
  private readonly random: () => number;
  private readonly transport: MirrorTransport;
  private readonly logger: Pick<Console, 'warn'>;
  private readonly queue: QueuedMirrorEvent[] = [];
  private queueBytes = 0;
  private flushing = false;
  private warned = false;
  private counters = {
    enqueued: 0,
    sent: 0,
    dropped: 0,
    retried: 0,
  };
  private dropReasons = new Map<string, number>();

  constructor(
    private readonly config: OwnedAnalyticsMirrorConfig,
    dependencies: OwnedAnalyticsMirrorDependencies = {},
  ) {
    this.nowMs = dependencies.nowMs ?? (() => Date.now());
    this.random = dependencies.random ?? (() => Math.random());
    this.transport = dependencies.transport ?? defaultTransport;
    this.logger = dependencies.logger ?? console;
  }

  enqueue(input: OwnedAnalyticsMirrorInput): void {
    if (!this.config.enabled) return;
    const sanitized = sanitizeOwnedMirrorParams(input.id, input.params);
    if (!sanitized.accepted) {
      this.recordDrop(sanitized.reason);
      return;
    }

    const now = this.nowMs();
    const stablePayload = stableJson({ id: input.id, params: sanitized.params });
    const occurrenceId = generateOccurrenceId();
    const event: QueuedMirrorEvent = {
      id: input.id,
      params: sanitized.params,
      event_occurrence_id: occurrenceId,
      dedupe_key: occurrenceId,
      enqueued_at_ms: now,
      attempt: 0,
      byte_size: byteSize(stablePayload),
      next_attempt_ms: now,
    };

    if (event.byte_size > this.config.maxQueueBytes) {
      this.recordDrop('event-too-large');
      return;
    }

    this.queue.push(event);
    this.queueBytes += event.byte_size;
    this.counters.enqueued += 1;
    this.enforceBounds(now);

    if (this.queue.length >= this.config.flushBatchSize) {
      void this.flush('batch-full');
    }
  }

  async flush(_trigger: 'batch-full' | 'manual' | 'visibility-hidden' | 'pagehide' = 'manual'): Promise<void> {
    if (!this.config.enabled || this.flushing || this.config.endpointUrl === null || this.config.publicClientKey === null) return;
    const now = this.nowMs();
    this.enforceBounds(now);
    const batch = this.queue.filter((event) => event.next_attempt_ms <= now).slice(0, this.config.flushBatchSize);
    if (batch.length === 0) return;

    this.flushing = true;
    try {
      const response = await this.transport({
        url: this.config.endpointUrl,
        publicClientKey: this.config.publicClientKey,
        timeoutMs: this.config.requestTimeoutMs,
        body: JSON.stringify({
          schema: 'ftd-owned-analytics-v1',
          events: batch.map(({ byte_size: _byteSize, next_attempt_ms: _nextAttemptMs, ...event }) => event),
        }),
      });
      if (response.ok) {
        this.removeBatch(batch);
        this.counters.sent += batch.length;
        return;
      }
      this.handleFailedBatch(batch, response.status);
    } catch (error) {
      this.warnOnce(`owned mirror flush failed: ${(error as Error).message}`);
      this.handleFailedBatch(batch, 0);
    } finally {
      this.flushing = false;
    }
  }

  stats(): OwnedAnalyticsMirrorStats {
    return {
      ...this.counters,
      queueLength: this.queue.length,
      queueBytes: this.queueBytes,
      dropReasons: Object.fromEntries(this.dropReasons.entries()),
    };
  }

  private handleFailedBatch(batch: readonly QueuedMirrorEvent[], status: number): void {
    if (status !== 0 && !this.config.retryableStatuses.includes(status)) {
      this.dropBatch(batch, `non-retryable-status-${status}`);
      return;
    }
    const now = this.nowMs();
    for (const event of batch) {
      const index = this.queue.indexOf(event);
      if (index === -1) continue;
      const nextAttempt = event.attempt + 1;
      if (nextAttempt >= this.config.maxAttempts) {
        this.removeAt(index);
        this.recordDrop('max-attempts');
        continue;
      }
      this.queue[index] = {
        ...event,
        attempt: nextAttempt,
        next_attempt_ms: now + this.retryDelayMs(nextAttempt),
      };
      this.counters.retried += 1;
    }
  }

  private retryDelayMs(attempt: number): number {
    const exponential = this.config.baseBackoffMs * (2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(this.random() * this.config.baseBackoffMs);
    return Math.min(this.config.maxBackoffMs, exponential + jitter);
  }

  private enforceBounds(now: number): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (now - this.queue[index].enqueued_at_ms > this.config.maxEventAgeMs) {
        this.removeAt(index);
        this.recordDrop('max-age');
      }
    }
    while (this.queue.length > this.config.maxQueueItems) {
      this.removeAt(0);
      this.recordDrop('max-items');
    }
    while (this.queueBytes > this.config.maxQueueBytes && this.queue.length > 0) {
      this.removeAt(0);
      this.recordDrop('max-bytes');
    }
  }

  private removeBatch(batch: readonly QueuedMirrorEvent[]): void {
    for (const event of batch) {
      const index = this.queue.indexOf(event);
      if (index >= 0) this.removeAt(index);
    }
  }

  private dropBatch(batch: readonly QueuedMirrorEvent[], reason: string): void {
    for (const event of batch) {
      const index = this.queue.indexOf(event);
      if (index >= 0) this.removeAt(index);
      this.recordDrop(reason);
    }
  }

  private removeAt(index: number): void {
    const [event] = this.queue.splice(index, 1);
    this.queueBytes -= event.byte_size;
  }

  private recordDrop(reason: string): void {
    this.counters.dropped += 1;
    this.dropReasons.set(reason, (this.dropReasons.get(reason) ?? 0) + 1);
  }

  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn('[analytics]', message);
  }
}

export function createOwnedAnalyticsMirror(): OwnedAnalyticsMirror {
  const { config } = readOwnedAnalyticsMirrorConfigFromImportMetaEnv();
  return new OwnedAnalyticsMirror(config);
}

function sanitizeOwnedMirrorParams(id: CanonicalAnalyticsEventId, params?: object): { readonly accepted: true; readonly params: AnalyticsParams } | { readonly accepted: false; readonly reason: string } {
  const sanitized: AnalyticsParams = {};
  const allowedKeys = mirrorFieldAllowlists.get(id) ?? new Set<string>();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (isForbiddenAnalyticsIdentifierKey(key)) continue;
    if (key.toLowerCase().includes('screenshot') || key.toLowerCase().includes('touch_path')) return { accepted: false, reason: `forbidden-key-${key}` };
    if (!allowedKeys.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) continue;
      if (looksSensitiveAnalyticsValue(trimmed)) return { accepted: false, reason: `sensitive-value-${key}` };
      sanitized[key] = trimmed;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      sanitized[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }
  return { accepted: true, params: sanitized };
}

async function defaultTransport(request: {
  readonly url: string;
  readonly publicClientKey: string;
  readonly body: string;
  readonly timeoutMs: number;
}): Promise<MirrorTransportResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.publicClientKey}`,
        'content-type': 'application/json',
      },
      body: request.body,
      keepalive: request.body.length < 60_000,
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } finally {
    window.clearTimeout(timeout);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

function generateOccurrenceId(): string {
  if (globalThis.crypto?.randomUUID !== undefined) {
    return globalThis.crypto.randomUUID();
  }
  return `ftd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
