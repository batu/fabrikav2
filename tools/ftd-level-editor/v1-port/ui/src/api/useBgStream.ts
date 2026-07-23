import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Background, GenerationProgress, SessionResponse } from '../types';
import { getBackgroundGenerationJob, getSession, startBackgroundGenerationJob, upscaleBackground } from './editorApi';
import { sessionQueryKey } from './useSessionQuery';

export type BgStreamControls = {
  start: (sessionId: string, options?: BgStreamStartOptions) => void;
  resume: (sessionId: string, jobId: string) => void;
  stop: () => void;
  reset: () => void;
  status: BgStreamStatus;
};

export interface BgUpscaleOptions {
  enabled: boolean;
  model: string;
  targetLongEdge: number;
}

export interface BgStreamStartOptions {
  total?: number;
  upscale?: BgUpscaleOptions;
}

export interface BgStreamStatus {
  generating: boolean;
  generationProgress: GenerationProgress;
  generationErrors: string[];
  generationCostEstimates: string[];
  generationRetries: string[];
  generationFailed: boolean;
  generationJobId: string | null;
  generationJobStatus: string | null;
  upscaling: boolean;
  upscaleProgress: GenerationProgress;
  upscaleErrors: string[];
}

const emptyProgress = (): GenerationProgress => ({ succeeded: 0, failed: 0, total: 0 });

const initialStatus = (): BgStreamStatus => ({
  generating: false,
  generationProgress: emptyProgress(),
  generationErrors: [],
  generationCostEstimates: [],
  generationRetries: [],
  generationFailed: false,
  generationJobId: null,
  generationJobStatus: null,
  upscaling: false,
  upscaleProgress: emptyProgress(),
  upscaleErrors: [],
});

const TERMINAL_BACKGROUND_JOB_STATUSES = new Set([
  'succeeded',
  'failed_retryable',
  'failed_terminal',
  'cancelled',
]);

function errorMessage(err: unknown): string {
  const detail = (err as { detail?: { detail?: { error?: string } } }).detail?.detail?.error;
  if (detail) return detail;
  return err instanceof Error ? err.message : String(err);
}

function parseCostEstimatePayload(raw: string): {
  index: number;
  provider: string;
  model: string;
  estimatedCreativeUnits: number | null;
  costStatus: string;
} | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const value = data as Record<string, unknown>;
  if (typeof value.index !== 'number') return null;
  if (typeof value.provider !== 'string') return null;
  if (typeof value.model !== 'string') return null;
  const estimated = value.estimatedCreativeUnits;
  if (estimated !== null && estimated !== undefined && typeof estimated !== 'number') return null;
  return {
    index: value.index,
    provider: value.provider,
    model: value.model,
    estimatedCreativeUnits: estimated ?? null,
    costStatus: typeof value.costStatus === 'string' ? value.costStatus : 'unknown',
  };
}

function upsertBackground(backgrounds: Background[], bg: Background): Background[] {
  const byIndex = new Map(backgrounds.map((current) => [current.index, current]));
  byIndex.set(bg.index, bg);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function patchSession(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  updater: (session: SessionResponse) => SessionResponse,
): void {
  queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), (current) =>
    current ? updater(current) : current,
  );
}

/**
 * Opens an EventSource to /api/sessions/{id}/generate and writes
 * bg_ready / bg_error / generate_complete events into the session query cache.
 *
 * Uses a generation-sequence token so events from a stream that's been
 * superseded by `stop()` (or by a fresh `start()`) are discarded — without
 * the token, a late `bg_ready` from a closed EventSource that lost a
 * microtask race against `close()` would corrupt the new mode/session state.
 */
export function useBgStream() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<BgStreamStatus>(() => initialStatus());
  const esRef = useRef<EventSource | null>(null);
  const upscaleAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  // Bumped on every start() and stop(). Each event handler closes over the
  // value at start-time and short-circuits if it doesn't match the current ref.
  const genSeqRef = useRef(0);

  const start = useCallback(
    (sessionId: string, options: BgStreamStartOptions = {}) => {
      // Close any previous stream and invalidate its in-flight events.
      esRef.current?.close();
      upscaleAbortRef.current?.abort();
      upscaleAbortRef.current = null;
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      genSeqRef.current += 1;
      const myGen = genSeqRef.current;
      const readyBgs: Background[] = [];
      const upscale = options.upscale;

      setStatus({
        ...initialStatus(),
        generating: true,
        generationProgress: { succeeded: 0, failed: 0, total: options.total ?? 0 },
      });

      const isCurrent = () => myGen === genSeqRef.current;

      const runUpscaleStage = async () => {
        if (!upscale?.enabled) return;
        const candidates = readyBgs.filter((bg) => {
          const longEdge = Math.max(bg.width ?? 0, bg.height ?? 0);
          return longEdge === 0 || longEdge < upscale.targetLongEdge;
        });
        if (candidates.length === 0) return;

        const controller = new AbortController();
        upscaleAbortRef.current = controller;
        setStatus((current) => ({
          ...current,
          upscaling: true,
          upscaleProgress: { succeeded: 0, failed: 0, total: candidates.length },
          upscaleErrors: [],
        }));
        for (const bg of candidates) {
          if (!isCurrent()) return;
          try {
            const result = await upscaleBackground(
              sessionId,
              bg.index,
              upscale.model,
              upscale.targetLongEdge,
              false,
              controller.signal,
            );
            if (!isCurrent()) return;
            patchSession(queryClient, sessionId, (session) => ({
              ...session,
              backgrounds: upsertBackground(session.backgrounds, result.background),
            }));
            setStatus((current) => ({
              ...current,
              upscaleProgress: {
                ...current.upscaleProgress,
                succeeded: current.upscaleProgress.succeeded + 1,
              },
            }));
          } catch (err) {
            if (!isCurrent()) return;
            if (err instanceof DOMException && err.name === 'AbortError') return;
            const message = errorMessage(err);
            setStatus((current) => ({
              ...current,
              upscaleProgress: {
                ...current.upscaleProgress,
                failed: current.upscaleProgress.failed + 1,
              },
              upscaleErrors: [...current.upscaleErrors, `bg #${bg.index}: ${message}`],
            }));
          }
        }
        if (isCurrent()) {
          setStatus((current) => ({ ...current, upscaling: false }));
        }
        if (upscaleAbortRef.current === controller) {
          upscaleAbortRef.current = null;
        }
      };

      const openStream = async (): Promise<void> => {
        try {
          await queryClient.ensureQueryData({
            queryKey: sessionQueryKey(sessionId),
            queryFn: () => getSession(sessionId),
          });
        } catch (err) {
          if (!isCurrent()) return;
          const message = errorMessage(err);
          setStatus((current) => ({
            ...current,
            generating: false,
            generationFailed: true,
            generationErrors: [...current.generationErrors, `session seed failed: ${message}`],
          }));
          return;
        }
        if (!isCurrent()) return;

        try {
          const job = await startBackgroundGenerationJob(sessionId);
          if (!isCurrent()) return;
          setStatus((current) => ({
            ...current,
            generationJobId: job.jobId,
            generationJobStatus: job.status,
            generationProgress: {
              ...current.generationProgress,
              succeeded: job.succeeded,
              failed: job.failed,
            },
          }));
        } catch (err) {
          if (!isCurrent()) return;
          const message = errorMessage(err);
          setStatus((current) => ({
            ...current,
            generating: false,
            generationFailed: true,
            generationErrors: [...current.generationErrors, `background job start failed: ${message}`],
          }));
          return;
        }

        const es = new EventSource(`/api/sessions/${sessionId}/generate`);
        esRef.current = es;

        es.addEventListener('bg_ready', (e: MessageEvent) => {
          if (!isCurrent()) return;
          const bg: Background = JSON.parse(e.data);
          readyBgs.push(bg);
          patchSession(queryClient, sessionId, (session) => ({
            ...session,
            backgrounds: upsertBackground(session.backgrounds, bg),
          }));
          setStatus((current) => ({
            ...current,
            generationProgress: {
              ...current.generationProgress,
              succeeded: current.generationProgress.succeeded + 1,
            },
            generationRetries: current.generationRetries.filter(
              (line) => !line.startsWith(`bg #${bg.index}:`),
            ),
          }));
        });

        es.addEventListener('bg_error', (e: MessageEvent) => {
          if (!isCurrent()) return;
          const data = JSON.parse(e.data);
          const index = typeof data.index === 'number' ? data.index : -1;
          const message = typeof data.error === 'string' ? data.error : String(data.error ?? 'unknown error');
          setStatus((current) => ({
            ...current,
            generationProgress: {
              ...current.generationProgress,
              failed: current.generationProgress.failed + 1,
            },
            generationErrors: [
              ...current.generationErrors,
              `bg ${index >= 0 ? `#${index}` : ''}: ${message}`.trim(),
            ],
          }));
        });

        es.addEventListener('bg_retry', (e: MessageEvent) => {
          if (!isCurrent()) return;
          const data = JSON.parse(e.data);
          setStatus((current) => ({
            ...current,
            generationRetries: [
              ...current.generationRetries,
              `bg #${data.index}: retry ${data.attempt}/${data.maxAttempts} — ${data.error}`,
            ],
          }));
        });

        es.addEventListener('bg_cost_estimate', (e: MessageEvent) => {
          if (!isCurrent()) return;
          const data = parseCostEstimatePayload(e.data);
          if (data === null) {
            console.warn('[useBgStream] invalid bg_cost_estimate payload');
            return;
          }
          setStatus((current) => ({
            ...current,
            generationCostEstimates: [
              ...current.generationCostEstimates.filter((line) => !line.startsWith(`bg #${data.index}:`)),
              data.estimatedCreativeUnits === null
                ? `bg #${data.index}: ${data.provider} cost unknown before generation`
                : `bg #${data.index}: ${data.provider} estimate ${data.estimatedCreativeUnits.toFixed(4)} CUs`,
            ],
          }));
        });

        es.addEventListener('generate_complete', (e: MessageEvent) => {
          if (!isCurrent()) return;
          let failed = 0;
          try {
            const data = JSON.parse(e.data) as { failed?: unknown };
            failed = typeof data.failed === 'number' ? data.failed : 0;
          } catch {
            failed = 0;
          }
          setStatus((current) => ({
            ...current,
            generating: false,
            generationRetries: [],
            generationFailed: failed > 0,
            generationJobStatus: failed > 0 ? 'failed_retryable' : 'succeeded',
          }));
          es.close();
          esRef.current = null;
          void runUpscaleStage();
        });

        es.onerror = () => {
          // /generate starts paid work; do not let EventSource auto-reconnect
          // and accidentally submit a second provider job for the same session.
          if (!isCurrent()) return;
          console.warn('[useBgStream] SSE closed abnormally');
          setStatus((current) => ({
            ...current,
            generating: false,
            generationFailed: true,
            generationErrors: [...current.generationErrors, 'stream disconnected: SSE connection closed'],
            generationJobStatus: current.generationJobStatus ?? 'replay_disconnected',
          }));
          es.close();
          esRef.current = null;
        };
      };

      void openStream();
    },
    [queryClient],
  );

  const resume = useCallback((sessionId: string, jobId: string) => {
    esRef.current?.close();
    upscaleAbortRef.current?.abort();
    upscaleAbortRef.current = null;
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    genSeqRef.current += 1;
    const myGen = genSeqRef.current;
    const isCurrent = () => myGen === genSeqRef.current;

    setStatus({
      ...initialStatus(),
      generating: true,
      generationJobId: jobId,
      generationJobStatus: 'checking',
    });

    const poll = async (): Promise<void> => {
      try {
        const job = await getBackgroundGenerationJob(sessionId, jobId);
        if (!isCurrent()) return;
        if (job.backgrounds.length > 0) {
          patchSession(queryClient, sessionId, (session) => ({
            ...session,
            backgrounds: job.backgrounds.reduce(upsertBackground, session.backgrounds),
          }));
        }
        const terminal = TERMINAL_BACKGROUND_JOB_STATUSES.has(job.status);
        setStatus((current) => ({
          ...current,
          generating: !terminal,
          generationFailed: job.status.startsWith('failed'),
          generationJobId: job.jobId,
          generationJobStatus: job.status,
          generationProgress: {
            succeeded: job.succeeded,
            failed: job.failed,
            total: Math.max(current.generationProgress.total, job.succeeded + job.failed),
          },
          generationErrors: job.error ? [job.error] : current.generationErrors,
        }));
        if (terminal && pollTimerRef.current !== null) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } catch (err) {
        if (!isCurrent()) return;
        const message = errorMessage(err);
        setStatus((current) => ({
          ...current,
          generating: false,
          generationFailed: true,
          generationErrors: [...current.generationErrors, `background job resume failed: ${message}`],
        }));
        if (pollTimerRef.current !== null) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }
    };

    void poll();
    pollTimerRef.current = window.setInterval(() => void poll(), 1000);
  }, [queryClient]);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    upscaleAbortRef.current?.abort();
    upscaleAbortRef.current = null;
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    // Bump the gen seq so any in-flight events from the closed stream that lost
    // the microtask race against close() are discarded by their isCurrent() guard.
    genSeqRef.current += 1;
  }, []);

  const reset = useCallback(() => {
    stop();
    setStatus(initialStatus());
  }, [stop]);

  // Cleanup on unmount. Pre-fix this hook had no unmount cleanup (unlike
  // useInpaintStream) — a component unmount mid-stream left the EventSource
  // dangling, continuing to receive and dispatch into a detached reducer
  // (memory leak + noisy warnings). Matches the inpaint hook's pattern.
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
      upscaleAbortRef.current?.abort();
      upscaleAbortRef.current = null;
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      genSeqRef.current += 1;
    };
  }, []);

  return useMemo(() => ({ start, resume, stop, reset, status }), [start, resume, stop, reset, status]);
}

// Vite HMR: tear down any live EventSource BEFORE the new module replaces
// this one. Without this, an edit to the file while a stream is running
// leaves the old EventSource attached to the reducer (stale-closure
// events from the prior module instance land in the new instance's
// dispatch queue). `hot.dispose` fires before the replacement, so cleanup
// is synchronous w.r.t. the hot update.
//
// Narrow `unknown` cast — the UI's tsconfig doesn't include `vite/client`
// types, so import.meta.hot needs a local type. Matches the pattern in
// packages/core for Vite-aware code outside packages that pull the full
// vite types (see CLAUDE.md lesson from 2026-04-14).
type ViteHotApi = { dispose: (cb: () => void) => void };
const _hot = (import.meta as unknown as { hot?: ViteHotApi }).hot;
if (_hot) {
  _hot.dispose(() => {
    // No module-level state to wipe; component instances clean up via
    // their own useEffect return. This dispose is mostly a safety hook
    // for future module-level additions (e.g. shared retry queues).
  });
}
