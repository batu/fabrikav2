import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DogState, Hitbox, SpriteCandidate } from '../types';
import {
  dogVariantUrl,
  getRetryFailedDogsJob,
  listSpriteCandidates,
  spriteCandidateOverlayUrl,
  startRetryFailedDogsJob,
  type RetryFailedDogsJobResponse,
} from '../api/editorApi';

type ReviewStatus = 'pending' | 'approved' | 'cleanup' | 'rejected';

interface Props {
  sessionId: string;
  sharedPrompt: string;
  inpaintModel: string;
  hitboxes: Hitbox[];
  dogs: DogState[];
  onDogComplete: (dogIndex: number, file: string, variantIndex: number) => void;
}

function CandidateImage({ src, alt, fallback }: { src: string | null; alt: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) return <span>{fallback}</span>;
  return <img src={src} alt={alt} onError={() => setFailed(true)} />;
}

const REVIEW_LABELS: Record<ReviewStatus, string> = {
  pending: 'Review',
  approved: 'Kept',
  cleanup: 'Redo',
  rejected: 'Redo',
};

function numericQuality(candidate: SpriteCandidate, key: string): number | null {
  const value = candidate.quality?.[key];
  return typeof value === 'number' ? value : null;
}

function booleanQuality(candidate: SpriteCandidate, key: string): boolean {
  return candidate.quality?.[key] === true;
}

function cutoutFlags(candidate: SpriteCandidate): string[] {
  const flags: string[] = [];
  if (candidate.status !== 'ready') {
    flags.push(candidate.reason ?? candidate.status);
    return flags;
  }
  if (booleanQuality(candidate, 'fullCropLike')) flags.push('full crop');
  const edgeTouches = numericQuality(candidate, 'edgeTouches');
  if (edgeTouches !== null && edgeTouches >= 2) flags.push('edge');
  const bboxCoverage = numericQuality(candidate, 'bboxCoverage');
  if (bboxCoverage !== null && bboxCoverage >= 0.52) flags.push('large');
  const visibleCoverage = numericQuality(candidate, 'visibleCoverage');
  if (visibleCoverage !== null && visibleCoverage < 0.02) flags.push('tiny');
  if (!candidate.technique?.includes('sam2') && bboxCoverage !== null && bboxCoverage >= 0.35) {
    flags.push('attached');
  }
  return flags;
}

function initialStatus(candidate: SpriteCandidate): ReviewStatus {
  if (candidate.status !== 'ready') return 'rejected';
  return cutoutFlags(candidate).length > 0 ? 'cleanup' : 'pending';
}

function candidateLabel(candidate: SpriteCandidate): string {
  return `dog #${candidate.dogIndex} · sprite ${String(candidate.spriteIndex).padStart(3, '0')}`;
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === 'pending' || value === 'approved' || value === 'cleanup' || value === 'rejected';
}

function parseStoredReview(raw: string | null): Record<string, ReviewStatus> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, ReviewStatus] => {
        const [key, value] = entry;
        return key.length > 0 && isReviewStatus(value);
      }),
    );
  } catch {
    return {};
  }
}

function activeCandidates(candidates: SpriteCandidate[], dogs: DogState[]): SpriteCandidate[] {
  const dogsByIndex = new Map(dogs.map((dog) => [dog.index, dog]));
  const candidatesByDog = new Map<number, SpriteCandidate[]>();
  for (const candidate of candidates) {
    const group = candidatesByDog.get(candidate.dogIndex) ?? [];
    group.push(candidate);
    candidatesByDog.set(candidate.dogIndex, group);
  }

  return [...candidatesByDog.entries()]
    .map(([dogIndex, group]) => {
      const activeVariant = dogsByIndex.get(dogIndex)?.activeVariant;
      const active = activeVariant === null || activeVariant === undefined
        ? undefined
        : group.find((candidate) => candidate.spriteIndex === activeVariant);
      if (active !== undefined) return active;

      return group.reduce((best, candidate) => {
        if (candidate.status === 'ready' && best.status !== 'ready') return candidate;
        if (candidate.status !== 'ready' && best.status === 'ready') return best;
        if (candidate.spriteIndex > best.spriteIndex) return candidate;
        return best;
      });
    })
    .sort((a, b) => a.dogIndex - b.dogIndex);
}

function reviewTargets(candidates: SpriteCandidate[], review: Record<string, ReviewStatus>): SpriteCandidate[] {
  return candidates.filter((candidate) => {
    const status = review[candidate.id] ?? initialStatus(candidate);
    return status === 'cleanup' || status === 'rejected';
  });
}

function isTerminalRetryStatus(status: RetryFailedDogsJobResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed_retryable' ||
    status === 'failed_terminal' || status === 'orphaned_unknown' || status === 'cancelled';
}

async function waitForRetryJob(sessionId: string, job: RetryFailedDogsJobResponse): Promise<RetryFailedDogsJobResponse> {
  if (isTerminalRetryStatus(job.status)) return job;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const current = await getRetryFailedDogsJob(sessionId, job.jobId);
    if (isTerminalRetryStatus(current.status)) return current;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for bird regeneration job');
}

export const cutoutReviewTestExports = {
  activeCandidates,
  parseStoredReview,
};

export default function CutoutReviewPanel({
  sessionId,
  sharedPrompt,
  inpaintModel,
  hitboxes,
  dogs,
  onDogComplete,
}: Props) {
  const [candidates, setCandidates] = useState<SpriteCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Record<string, ReviewStatus>>({});
  const [loadedReviewKey, setLoadedReviewKey] = useState<string | null>(null);
  const [wideCrop, setWideCrop] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const refreshRunId = useRef(0);

  const reviewStorageKey = `ftd-cutout-review:${sessionId}`;

  const refresh = useCallback(async (dogSnapshot: DogState[] = dogs) => {
    const runId = refreshRunId.current + 1;
    refreshRunId.current = runId;
    setLoading(true);
    setError(null);
    try {
      const response = await listSpriteCandidates(sessionId);
      if (refreshRunId.current !== runId) return;
      const nextCandidates = activeCandidates(response.candidates, dogSnapshot);
      setCandidates(nextCandidates);
      setReview((prev) => {
        const next = { ...prev };
        for (const candidate of nextCandidates) {
          if (next[candidate.id] === undefined) {
            next[candidate.id] = initialStatus(candidate);
          }
        }
        return next;
      });
    } catch (err) {
      if (refreshRunId.current !== runId) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (refreshRunId.current === runId) {
        setLoading(false);
      }
    }
  }, [dogs, sessionId]);

  useEffect(() => {
    setReview(parseStoredReview(window.localStorage.getItem(reviewStorageKey)));
    setLoadedReviewKey(reviewStorageKey);
    void refresh();
  }, [refresh, reviewStorageKey]);

  useEffect(() => {
    if (loadedReviewKey !== reviewStorageKey) return;
    window.localStorage.setItem(reviewStorageKey, JSON.stringify(review));
  }, [loadedReviewKey, review, reviewStorageKey]);

  const counts = useMemo(() => {
    const values = candidates.map((candidate) => review[candidate.id] ?? initialStatus(candidate));
    return {
      approved: values.filter((status) => status === 'approved').length,
      cleanup: values.filter((status) => status === 'cleanup').length,
      rejected: values.filter((status) => status === 'rejected').length,
      total: values.length,
    };
  }, [candidates, review]);

  const setCandidateStatus = useCallback((candidate: SpriteCandidate, status: ReviewStatus) => {
    setReview((prev) => ({ ...prev, [candidate.id]: status }));
  }, []);

  const toggleCandidate = useCallback((candidate: SpriteCandidate) => {
    setReview((prev) => {
      const current = prev[candidate.id] ?? initialStatus(candidate);
      const selected = current === 'cleanup' || current === 'rejected';
      return { ...prev, [candidate.id]: selected ? 'approved' : 'cleanup' };
    });
  }, []);

  const regenerateFlagged = useCallback(async () => {
    const targets = reviewTargets(candidates, review);
    if (targets.length === 0 || regenerating) return;
    setRegenerating(true);
    setError(null);
    setLastResult(null);
    const generatedVariants = new Map<number, number>();
    try {
      const padding = wideCrop ? 3.0 : 2.75;
      const started = await startRetryFailedDogsJob(
        sessionId,
        targets.map((candidate) => candidate.dogIndex),
        sharedPrompt,
        padding,
        inpaintModel,
      );
      const completed = await waitForRetryJob(sessionId, started);
      for (const unit of completed.units) {
        if (unit.status !== 'succeeded' || unit.file === null || unit.variantIndex === null) continue;
        onDogComplete(unit.dogIndex, unit.file, unit.variantIndex);
        generatedVariants.set(unit.dogIndex, unit.variantIndex);
      }
      const refreshedDogs = dogs.map((dog) => {
        const activeVariant = generatedVariants.get(dog.index);
        return activeVariant === undefined ? dog : { ...dog, activeVariant };
      });
      await refresh(refreshedDogs);
      const failures = targets.length - generatedVariants.size;
      if (failures > 0) {
        setError(`${failures} redo${failures === 1 ? '' : 's'} failed`);
      }
      setLastResult(`${targets.length - failures}/${targets.length} redo${targets.length === 1 ? '' : 's'} finished`);
    } finally {
      setRegenerating(false);
    }
  }, [candidates, dogs, inpaintModel, onDogComplete, regenerating, refresh, review, sessionId, sharedPrompt, wideCrop]);

  return (
    <section className="cutout-review-panel">
      <div className="cutout-review-header">
        <div>
          <h3>Cutout review</h3>
          <div className="cutout-review-summary">
            {counts.approved}/{counts.total} kept · {counts.cleanup + counts.rejected} need redo
          </div>
        </div>
        <div className="cutout-review-actions">
          <label className="cutout-review-toggle">
            <input type="checkbox" checked={wideCrop} onChange={(event) => setWideCrop(event.target.checked)} />
            Wide crop
          </label>
          <button type="button" className="btn" onClick={() => void refresh()} disabled={loading || regenerating}>
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={regenerateFlagged}
            disabled={regenerating || counts.cleanup + counts.rejected === 0}
          >
            {regenerating ? 'Redoing...' : `Redo selected (${counts.cleanup + counts.rejected})`}
          </button>
        </div>
      </div>

      {error && <div className="cutout-review-error">{error}</div>}
      {lastResult && <div className="cutout-review-result">{lastResult}</div>}
      {loading && <div className="cutout-review-empty">Loading cutouts...</div>}
      {!loading && candidates.length === 0 && (
        <div className="cutout-review-empty">No pickup cutouts found.</div>
      )}

      <div className="cutout-review-grid">
        {candidates.map((candidate) => {
          const status = review[candidate.id] ?? initialStatus(candidate);
          const flags = cutoutFlags(candidate);
          const willRegenerate = status === 'cleanup' || status === 'rejected';
          const imageUrl = candidate.image ? dogVariantUrl(sessionId, candidate.image) : null;
          const maskUrl = candidate.mask ? dogVariantUrl(sessionId, candidate.mask) : null;
          const hitbox = hitboxes[candidate.dogIndex];
          return (
            <article key={candidate.id} className={`cutout-review-card ${status}`}>
              <div className="cutout-review-card-top">
                <strong>{candidateLabel(candidate)}</strong>
                <span>{REVIEW_LABELS[status]}</span>
              </div>
              <button
                type="button"
                className="cutout-review-overlay"
                aria-label={`${willRegenerate ? 'Remove' : 'Select'} ${candidateLabel(candidate)} ${willRegenerate ? 'from' : 'for'} regeneration`}
                aria-pressed={willRegenerate}
                onClick={() => toggleCandidate(candidate)}
              >
                <CandidateImage
                  src={spriteCandidateOverlayUrl(sessionId, candidate.id)}
                  alt={`${candidateLabel(candidate)} matched over painted scene`}
                  fallback="overlay unavailable"
                />
                <span>{willRegenerate ? 'Selected for redo' : 'Click to select'}</span>
              </button>
              <div className="cutout-review-images">
                <div><CandidateImage src={imageUrl} alt={candidateLabel(candidate)} fallback="missing sprite" /></div>
                <div><CandidateImage src={maskUrl} alt={`${candidateLabel(candidate)} mask`} fallback="mask unavailable" /></div>
              </div>
              <div className="cutout-review-meta">
                <code>{candidate.technique ?? candidate.status}</code>
                <span>{candidate.width ?? '?'}x{candidate.height ?? '?'}</span>
                {hitbox && <span>r{hitbox.r}</span>}
              </div>
              <div className="cutout-review-flags">
                {willRegenerate && <span className="regenerate-chip">will redo</span>}
                {flags.length > 0 ? flags.map((flag) => <span key={flag}>{flag}</span>) : <span>clean</span>}
              </div>
              <div className="cutout-review-buttons">
                <button
                  type="button"
                  className={status === 'approved' ? 'selected' : ''}
                  onClick={() => setCandidateStatus(candidate, 'approved')}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className={willRegenerate ? 'selected' : ''}
                  onClick={() => setCandidateStatus(candidate, 'cleanup')}
                >
                  Redo
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
