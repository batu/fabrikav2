// The single job-and-events polling observer (R20/R21).
//
// One observer per watched job. It keeps pending Request ID, job identity,
// the last valid durable snapshot, the event high-water cursor, and the
// connection state as separate facts: a failed read only ever moves the
// connection to `reconnecting` — it never touches durable Job state. The
// observer stops only on a backend terminal status or an explicit caller
// `stop()`, with bounded backoff and no arbitrary terminal timeout.

import type { JobEventResponse, JobResource } from '../api/generated.ts';
import type { JobsTransport } from '../api/http.ts';

export type ConnectionState = 'idle' | 'connected' | 'reconnecting' | 'stopped';

export const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set([
  'succeeded',
  'failed_terminal',
  'failed_retryable',
  'orphaned_unknown',
  'cancelled',
]);

export function isTerminalJobStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

export interface BackoffPolicy {
  initialMs: number;
  maxMs: number;
  factor: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { initialMs: 500, maxMs: 15_000, factor: 2 };

// Bounded reconnect delay; there is deliberately no attempt cap because the
// observer never times a durable job out (R21).
export function backoffDelayMs(policy: BackoffPolicy, failureCount: number): number {
  if (failureCount <= 0) return policy.initialMs;
  const raw = policy.initialMs * policy.factor ** Math.min(failureCount, 30);
  return Math.min(policy.maxMs, raw);
}

export interface ObserverState {
  pendingRequestId: string;
  sessionId: string;
  jobId: string | null;
  job: JobResource | null;
  events: JobEventResponse[];
  eventCursor: number;
  connection: ConnectionState;
  consecutiveFailures: number;
}

// Deduplicating, order-preserving event ingestion: replayed or out-of-order
// event pages fold into one ordered once-only sequence keyed by event id.
export function ingestEvents(
  existing: JobEventResponse[],
  incoming: JobEventResponse[],
): { events: JobEventResponse[]; cursor: number } {
  const byId = new Map<number, JobEventResponse>();
  for (const event of existing) byId.set(event.id, event);
  for (const event of incoming) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  const events = [...byId.values()].sort((a, b) => a.id - b.id);
  return { events, cursor: events.length > 0 ? events[events.length - 1].id : 0 };
}

export interface JobObserver {
  state(): ObserverState;
  pollOnce(): Promise<ObserverState>;
  run(sleep: (ms: number) => Promise<void>): Promise<ObserverState>;
  stop(): void;
}

export interface ObserveJobOptions {
  transport: JobsTransport;
  requestId: string;
  sessionId: string;
  jobId?: string | null;
  backoff?: BackoffPolicy;
  onChange?: (state: ObserverState) => void;
}

export function observeJob(options: ObserveJobOptions): JobObserver {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  let state: ObserverState = {
    pendingRequestId: options.requestId,
    sessionId: options.sessionId,
    jobId: options.jobId ?? null,
    job: null,
    events: [],
    eventCursor: 0,
    connection: 'idle',
    consecutiveFailures: 0,
  };
  let stopped = false;

  const publish = (next: ObserverState): ObserverState => {
    state = next;
    options.onChange?.(state);
    return state;
  };

  const pollOnce = async (): Promise<ObserverState> => {
    if (stopped) return state;
    try {
      let jobId = state.jobId;
      if (jobId === null) {
        // Reload/lost-response recovery: the durable server answer for this
        // pending Request ID wins over anything a browser cache would say.
        const found = await options.transport.listJobs({
          requestId: state.pendingRequestId,
        });
        if (found.length === 0) {
          return publish({ ...state, connection: 'connected', consecutiveFailures: 0 });
        }
        jobId = found[0].jobId;
      }
      const job = await options.transport.getJob(jobId);
      const page = await options.transport.listEvents(jobId, state.eventCursor);
      const { events, cursor } = ingestEvents(state.events, page);
      return publish({
        ...state,
        jobId,
        job,
        events,
        eventCursor: cursor,
        connection: 'connected',
        consecutiveFailures: 0,
      });
    } catch {
      // A failed read is only ever connection state; the last valid durable
      // snapshot, identity, and cursor are all preserved untouched.
      return publish({
        ...state,
        connection: 'reconnecting',
        consecutiveFailures: state.consecutiveFailures + 1,
      });
    }
  };

  return {
    state: () => state,
    pollOnce,
    async run(sleep) {
      while (!stopped) {
        const current = await pollOnce();
        if (stopped) break;
        if (current.job !== null && isTerminalJobStatus(current.job.status)) break;
        const delay =
          current.connection === 'reconnecting'
            ? backoffDelayMs(backoff, current.consecutiveFailures)
            : backoff.initialMs;
        await sleep(delay);
      }
      return state;
    },
    stop() {
      // Caller detaches the observer; the durable job is unaffected (AE7).
      stopped = true;
      publish({ ...state, connection: 'stopped' });
    },
  };
}

// Session-scoped rediscovery for Activity (R20): one query returns every
// durable job for the session; callers attach observers to nonterminal ones.
export async function discoverSessionJobs(
  transport: JobsTransport,
  sessionId: string,
): Promise<JobResource[]> {
  return transport.listJobs({ sessionId });
}
