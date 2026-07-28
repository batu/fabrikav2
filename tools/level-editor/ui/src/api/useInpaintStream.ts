import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DogState, Hitbox, SessionResponse } from '../types';
import { getCropInpaintJob, getSession, startCropInpaintJob, type CropInpaintJobResponse, type InpaintMode } from './editorApi';
import { sessionQueryKey } from './useSessionQuery';

export interface InpaintProgress {
  done: number;
  total: number;
  currentPass: number;
  totalPasses: number;
}

export interface InpaintStreamStatus {
  inpainting: boolean;
  inpaintFailed: boolean;
  inpaintError: string | null;
  inpaintProgress: InpaintProgress;
}

const emptyProgress = (): InpaintProgress => ({ done: 0, total: 0, currentPass: 0, totalPasses: 0 });
const initialStatus = (): InpaintStreamStatus => ({
  inpainting: false,
  inpaintFailed: false,
  inpaintError: null,
  inpaintProgress: emptyProgress(),
});

export type InpaintStreamControls = {
  start: (
    sessionId: string,
    hitboxes: Hitbox[],
    dogPrompt: string,
    mode?: InpaintMode,
    magentaPromptOverride?: string,
    inpaintModel?: string,
    hardDogPrompt?: string,
    hardDogPercent?: number,
    padding?: number,
  ) => void;
  resume: (sessionId: string) => void;
  stop: () => void;
  reset: () => void;
  status: InpaintStreamStatus;
};

const CROP_INPAINT_JOB_STORAGE_PREFIX = 'ftd:cropInpaintJob:';

function cropInpaintJobStorageKey(sessionId: string): string {
  return `${CROP_INPAINT_JOB_STORAGE_PREFIX}${sessionId}`;
}

function isTerminalCropJob(status: CropInpaintJobResponse['status']): boolean {
  return status === 'succeeded'
    || status === 'failed_retryable'
    || status === 'failed_terminal'
    || status === 'orphaned_unknown'
    || status === 'cancelled';
}

function pendingDogs(hitboxes: Hitbox[]): DogState[] {
  return hitboxes.map((hitbox, index) => ({
    index,
    id: hitbox.id,
    status: 'pending',
    activeVariant: null,
    promptOverride: null,
    variants: [],
  }));
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

function patchDog(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  dogIndex: number,
  updater: (dog: DogState) => DogState,
): void {
  patchSession(queryClient, sessionId, (session) => ({
    ...session,
    dogs: session.dogs.map((dog) => (dog.index === dogIndex ? updater(dog) : dog)),
  }));
}

function progressFromDogs(dogs: DogState[], current: InpaintProgress): InpaintProgress {
  const settled = dogs.filter((dog) => dog.status === 'done' || dog.status === 'error').length;
  return {
    ...current,
    done: settled,
    total: Math.max(current.total, dogs.length),
  };
}

/**
 * Opens an EventSource to /api/sessions/{id}/inpaint and writes
 * dog_start / dog_complete / dog_error / inpaint_complete events into the
 * session query cache.
 * On SSE drop, polls GET /api/sessions/{id} after 5s to reconcile.
 */
export function useInpaintStream() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<InpaintStreamStatus>(() => initialStatus());
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation-sequence token. Bumped on every start() and stop() so
  // events from a stream that has been superseded by a fresh start() or
  // an explicit stop() are discarded by the handlers. Mirrors the
  // pattern in useBgStream — pre-fix, a late dog_complete from a closed
  // stream that lost the microtask race against close() could dispatch
  // into a new session's reducer and leak a variant index into the
  // wrong session.
  const genSeqRef = useRef(0);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollCropJob = useCallback((
    sessionId: string,
    jobId: string,
    totalHint: number,
    myGen: number,
  ) => {
    const isCurrent = () => myGen === genSeqRef.current;
    const tick = async () => {
      if (!isCurrent()) return;
      try {
        const [job, session] = await Promise.all([
          getCropInpaintJob(sessionId, jobId),
          getSession(sessionId),
        ]);
        if (!isCurrent()) return;
        queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), session);
        const progress = progressFromDogs(session.dogs, {
          done: 0,
          total: totalHint,
          currentPass: 0,
          totalPasses: 0,
        });
        if (isTerminalCropJob(job.status)) {
          localStorage.removeItem(cropInpaintJobStorageKey(sessionId));
          setStatus({
            inpainting: false,
            inpaintFailed: job.status !== 'succeeded',
            inpaintError: job.status === 'succeeded' ? null : (job.error ?? 'Inpaint job failed'),
            inpaintProgress: progress,
          });
          return;
        }
        setStatus({
          inpainting: true,
          inpaintFailed: false,
          inpaintError: null,
          inpaintProgress: progress,
        });
        pollTimerRef.current = setTimeout(tick, 1000);
      } catch {
        if (!isCurrent()) return;
        setStatus((current) => ({
          ...current,
          inpainting: false,
          inpaintFailed: true,
          inpaintError: 'Inpaint job status could not be refreshed.',
        }));
      }
    };
    clearPollTimer();
    pollTimerRef.current = setTimeout(tick, 250);
  }, [clearPollTimer, queryClient]);

  const start = useCallback(
    (
      sessionId: string,
      hitboxes: Hitbox[],
      dogPrompt: string,
      mode: InpaintMode = 'crop',
      magentaPromptOverride: string = '',
      inpaintModel: string = '',
      hardDogPrompt: string = '',
      hardDogPercent: number = 30,
      padding: number = 2.75,
    ) => {
      esRef.current?.close();
      clearReconnectTimer();
      clearPollTimer();
      genSeqRef.current += 1;
      const myGen = genSeqRef.current;
      let sawFirstEvent = false;

      setStatus({
        inpainting: true,
        inpaintFailed: false,
        inpaintError: null,
        inpaintProgress: { done: 0, total: hitboxes.length, currentPass: 0, totalPasses: 0 },
      });
      patchSession(queryClient, sessionId, (session) => ({
        ...session,
        hitboxes,
        dogs: pendingDogs(hitboxes),
        exported: false,
        catalogUploaded: false,
        catalogListable: false,
        catalogTombstoned: false,
        bundledInApp: false,
      }));

      if (mode === 'crop' || mode === 'crop_reference') {
        void (async () => {
          try {
            const job = await startCropInpaintJob(
              sessionId,
              hitboxes,
              dogPrompt,
              padding,
              inpaintModel.trim() || undefined,
              hardDogPrompt.trim() || undefined,
              hardDogPercent,
              mode,
            );
            if (myGen !== genSeqRef.current) return;
            localStorage.setItem(cropInpaintJobStorageKey(sessionId), job.jobId);
            pollCropJob(sessionId, job.jobId, hitboxes.length, myGen);
          } catch (err) {
            if (myGen !== genSeqRef.current) return;
            setStatus({
              inpainting: false,
              inpaintFailed: true,
              inpaintError: err instanceof Error ? err.message : 'Failed to start inpaint job',
              inpaintProgress: { done: 0, total: hitboxes.length, currentPass: 0, totalPasses: 0 },
            });
          }
        })();
        return;
      }

      let url: string;
      if (mode === 'magenta') {
        const params = new URLSearchParams({
          hitboxes: JSON.stringify(hitboxes),
          dogPrompt,
        });
        if (inpaintModel.trim()) {
          params.set('inpaintModel', inpaintModel);
        }
        if (magentaPromptOverride.trim()) {
          params.set('magentaPromptOverride', magentaPromptOverride);
        }
        url = `/api/sessions/${sessionId}/inpaint/magenta?${params.toString()}`;
      } else {
        const params = new URLSearchParams({
          hitboxes: JSON.stringify(hitboxes),
          dogPrompt,
        });
        if (inpaintModel.trim()) {
          params.set('inpaintModel', inpaintModel);
        }
        if (hardDogPrompt.trim()) {
          params.set('hardDogPrompt', hardDogPrompt);
          params.set('hardDogPercent', String(hardDogPercent));
        }
        params.set('padding', String(padding));
        url = `/api/sessions/${sessionId}/inpaint?${params.toString()}`;
      }
      const es = new EventSource(url);
      esRef.current = es;

      const isCurrent = () => myGen === genSeqRef.current;
      const markStarted = () => {
        sawFirstEvent = true;
      };
      const reconcileSession = (delayMs: number, fallbackError: string) => {
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(async () => {
          reconnectTimerRef.current = null;
          if (!isCurrent()) return;
          try {
            const session = await getSession(sessionId);
            if (!isCurrent()) return;
            queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), session);
            setStatus((current) => ({
              ...current,
              inpainting: false,
              inpaintFailed: false,
              inpaintError: null,
              inpaintProgress: progressFromDogs(session.dogs, current.inpaintProgress),
            }));
          } catch {
            if (!isCurrent()) return;
            setStatus((current) => ({
              ...current,
              inpainting: false,
              inpaintFailed: true,
              inpaintError: fallbackError,
            }));
          }
        }, delayMs);
      };

      es.addEventListener('inpaint_init', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        setStatus((current) => ({
          ...current,
          inpaintProgress: {
            ...current.inpaintProgress,
            totalPasses: data.passCount ?? 0,
          },
        }));
      });

      // Per-crop events
      es.addEventListener('dog_start', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        patchDog(queryClient, sessionId, data.dogIndex, (dog) => ({
          ...dog,
          status: 'generating',
          error: undefined,
        }));
        setStatus((current) => ({
          ...current,
          inpaintProgress: {
            ...current.inpaintProgress,
            currentPass: data.passIndex === undefined
              ? current.inpaintProgress.currentPass
              : data.passIndex + 1,
          },
        }));
      });

      es.addEventListener('dog_complete', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        patchDog(queryClient, sessionId, data.dogIndex, (dog) => ({
          ...dog,
          status: 'done',
          variants: [...dog.variants, data.file],
          activeVariant: data.variantIndex,
          error: undefined,
        }));
        setStatus((current) => ({
          ...current,
          inpaintProgress: {
            done: current.inpaintProgress.done + 1,
            total: current.inpaintProgress.total,
            currentPass: data.passIndex === undefined
              ? current.inpaintProgress.currentPass
              : data.passIndex + 1,
            totalPasses: current.inpaintProgress.totalPasses,
          },
        }));
      });

      es.addEventListener('dog_error', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        patchDog(queryClient, sessionId, data.dogIndex, (dog) => ({
          ...dog,
          status: 'error',
          error: data.error,
        }));
        setStatus((current) => ({
          ...current,
          inpaintProgress: {
            done: current.inpaintProgress.done + 1,
            total: current.inpaintProgress.total,
            currentPass: data.passIndex === undefined
              ? current.inpaintProgress.currentPass
              : data.passIndex + 1,
            totalPasses: current.inpaintProgress.totalPasses,
          },
        }));
      });

      es.addEventListener('dog_retry', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        patchDog(queryClient, sessionId, data.dogIndex, (dog) => ({
          ...dog,
          status: 'generating',
          error: `retry ${data.attempt}/${data.maxAttempts} — ${data.error}`,
        }));
      });

      es.addEventListener('inpaint_error', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        setStatus((current) => ({
          ...current,
          inpainting: false,
          inpaintFailed: true,
          inpaintError: data.error ?? e.data,
        }));
        es.close();
        esRef.current = null;
      });

      es.addEventListener('inpaint_complete', () => {
        if (!isCurrent()) return;
        markStarted();
        setStatus((current) => ({
          ...current,
          inpainting: false,
          inpaintFailed: false,
          inpaintError: null,
        }));
        es.close();
        esRef.current = null;
      });

      // Magenta-mode events: one start, one complete (or one error)
      es.addEventListener('magenta_start', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        for (let i = 0; i < data.hitboxes; i++) {
          patchDog(queryClient, sessionId, i, (dog) => ({
            ...dog,
            status: 'generating',
            error: undefined,
          }));
        }
      });

      es.addEventListener('magenta_complete', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        for (let i = 0; i < data.hitboxes; i++) {
          patchDog(queryClient, sessionId, i, (dog) => ({
            ...dog,
            status: 'done',
            variants: [...dog.variants, data.colorFile],
            activeVariant: -1,
            error: undefined,
          }));
        }
        setStatus((current) => ({
          ...current,
          inpainting: false,
          inpaintFailed: false,
          inpaintError: null,
          inpaintProgress: {
            ...current.inpaintProgress,
            done: data.hitboxes,
            total: data.hitboxes,
          },
        }));
        es.close();
        esRef.current = null;
      });

      es.addEventListener('magenta_error', (e: MessageEvent) => {
        if (!isCurrent()) return;
        markStarted();
        const data = JSON.parse(e.data);
        setStatus((current) => ({
          ...current,
          inpainting: false,
          inpaintFailed: true,
          inpaintError: data.error ?? e.data,
        }));
        es.close();
        esRef.current = null;
      });

      es.onerror = () => {
        if (!isCurrent()) return;
        es.close();
        esRef.current = null;
        if (!sawFirstEvent) {
          reconcileSession(
            2000,
            'Inpaint stream failed before any progress event. Check model/API key selection and backend logs.',
          );
          return;
        }
        // Native EventSource retries GET requests automatically while
        // CONNECTING. /inpaint is side-effectful, so close immediately
        // and reconcile the existing session instead of letting the
        // browser accidentally start a second provider run.
        reconcileSession(5000, 'SSE connection closed; session reconcile failed');
      };
    },
    [queryClient, clearReconnectTimer, clearPollTimer, pollCropJob],
  );

  const resume = useCallback((sessionId: string) => {
    const jobId = localStorage.getItem(cropInpaintJobStorageKey(sessionId));
    if (!jobId) return;
    esRef.current?.close();
    esRef.current = null;
    clearReconnectTimer();
    clearPollTimer();
    genSeqRef.current += 1;
    const myGen = genSeqRef.current;
    setStatus((current) => ({
      inpainting: true,
      inpaintFailed: false,
      inpaintError: null,
      inpaintProgress: current.inpaintProgress,
    }));
    pollCropJob(sessionId, jobId, 0, myGen);
  }, [clearReconnectTimer, clearPollTimer, pollCropJob]);

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    clearReconnectTimer();
    clearPollTimer();
    // Bump gen seq so any late events from the closed stream are
    // discarded by their isCurrent() guard (matches useBgStream).
    genSeqRef.current += 1;
  }, [clearReconnectTimer, clearPollTimer]);

  const reset = useCallback(() => {
    stop();
    setStatus(initialStatus());
  }, [stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pollTimerRef.current !== null) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      genSeqRef.current += 1;
    };
  }, []);

  return useMemo(() => ({ start, resume, stop, reset, status }), [start, resume, stop, reset, status]);
}

// Vite HMR: see useBgStream for rationale. EventSource instances live on
// component refs, which are already torn down by each component's own
// useEffect cleanup. This dispose hook is defensive — if a future
// refactor introduces module-level state (e.g. a shared session-event
// multiplexer), the hot-reload story is already wired.
type ViteHotApi = { dispose: (cb: () => void) => void };
const _hot = (import.meta as unknown as { hot?: ViteHotApi }).hot;
if (_hot) {
  _hot.dispose(() => {
    // Intentionally empty — see comment above.
  });
}
