import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getBandGenJob,
  startBandGenJob,
  type BandGenJobResponse,
  type BandSide,
} from './editorApi';

export interface BandGenStatus {
  generating: boolean;
  failed: boolean;
  error: string | null;
  top: boolean;
  bottom: boolean;
}

const initialStatus = (): BandGenStatus => ({
  generating: false,
  failed: false,
  error: null,
  top: false,
  bottom: false,
});

const STORAGE_PREFIX = 'ftd:bandGenJob:';
const storageKey = (sessionId: string): string => `${STORAGE_PREFIX}${sessionId}`;

function isTerminal(status: BandGenJobResponse['status']): boolean {
  return (
    status === 'succeeded'
    || status === 'failed_retryable'
    || status === 'failed_terminal'
    || status === 'orphaned_unknown'
    || status === 'cancelled'
  );
}

/**
 * Drives the durable band_generation job: POST to start (or regenerate a side),
 * then poll GET every 1000ms until terminal, writing the per-side band presence
 * into local status. Mirrors the crop-inpaint poll path in useInpaintStream:
 * a generation-sequence token discards results from a superseded run, and the
 * jobId is persisted so a reload can resume the in-flight job.
 */
export function useBandGenStream() {
  const [status, setStatus] = useState<BandGenStatus>(() => initialStatus());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genSeqRef = useRef(0);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const poll = useCallback((sessionId: string, jobId: string, myGen: number) => {
    const isCurrent = () => myGen === genSeqRef.current;
    const tick = async () => {
      if (!isCurrent()) return;
      try {
        const job = await getBandGenJob(sessionId, jobId);
        if (!isCurrent()) return;
        if (isTerminal(job.status)) {
          localStorage.removeItem(storageKey(sessionId));
          setStatus({
            generating: false,
            failed: job.status !== 'succeeded',
            error: job.status === 'succeeded' ? null : (job.error ?? 'Band generation failed'),
            top: job.top,
            bottom: job.bottom,
          });
          return;
        }
        setStatus((current) => ({ ...current, generating: true, failed: false, error: null }));
        pollTimerRef.current = setTimeout(tick, 1000);
      } catch {
        if (!isCurrent()) return;
        setStatus((current) => ({
          ...current,
          generating: false,
          failed: true,
          error: 'Band job status could not be refreshed.',
        }));
      }
    };
    clearPollTimer();
    pollTimerRef.current = setTimeout(tick, 250);
  }, [clearPollTimer]);

  const start = useCallback(
    (sessionId: string, sides: BandSide[], topPrompt?: string, bottomPrompt?: string) => {
      clearPollTimer();
      genSeqRef.current += 1;
      const myGen = genSeqRef.current;
      setStatus((current) => ({ ...current, generating: true, failed: false, error: null }));
      void (async () => {
        try {
          const job = await startBandGenJob(sessionId, sides, topPrompt, bottomPrompt);
          if (myGen !== genSeqRef.current) return;
          localStorage.setItem(storageKey(sessionId), job.jobId);
          poll(sessionId, job.jobId, myGen);
        } catch (err) {
          if (myGen !== genSeqRef.current) return;
          setStatus((current) => ({
            ...current,
            generating: false,
            failed: true,
            error: err instanceof Error ? err.message : 'Failed to start band generation',
          }));
        }
      })();
    },
    [clearPollTimer, poll],
  );

  const resume = useCallback((sessionId: string) => {
    const jobId = localStorage.getItem(storageKey(sessionId));
    if (!jobId) return;
    clearPollTimer();
    genSeqRef.current += 1;
    setStatus((current) => ({ ...current, generating: true, failed: false, error: null }));
    poll(sessionId, jobId, genSeqRef.current);
  }, [clearPollTimer, poll]);

  const stop = useCallback(() => {
    clearPollTimer();
    genSeqRef.current += 1;
  }, [clearPollTimer]);

  const reset = useCallback(() => {
    stop();
    setStatus(initialStatus());
  }, [stop]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
      genSeqRef.current += 1;
    };
  }, []);

  return useMemo(() => ({ start, resume, stop, reset, status }), [start, resume, stop, reset, status]);
}
