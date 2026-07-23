import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DogState, Hitbox, SpriteCandidate } from '../types';
import { dogVariantUrl, listSpriteCandidates, regenDog, recompositeSession } from '../api/editorApi';

type ReviewStatus = 'pending' | 'approved' | 'cleanup' | 'rejected';

interface Props {
  sessionId: string;
  sharedPrompt: string;
  inpaintModel: string;
  hitboxes: Hitbox[];
  dogs: DogState[];
  onDogComplete: (dogIndex: number, file: string, variantIndex: number) => void;
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

  const regenerateFlagged = useCallback(async () => {
    const targets = reviewTargets(candidates, review);
    if (targets.length === 0 || regenerating) return;
    setRegenerating(true);
    setError(null);
    setLastResult(null);
    let failures = 0;
    const generatedVariants = new Map<number, number>();
    try {
      const padding = wideCrop ? 3.0 : 2.75;
      for (const candidate of targets) {
        try {
          const result = await regenDog(sessionId, candidate.dogIndex, sharedPrompt, padding, inpaintModel, true);
          onDogComplete(candidate.dogIndex, result.file, result.variantIndex);
          generatedVariants.set(candidate.dogIndex, result.variantIndex);
        } catch {
          failures += 1;
        }
      }
      const refreshedDogs = dogs.map((dog) => {
        const activeVariant = generatedVariants.get(dog.index);
        return activeVariant === undefined ? dog : { ...dog, activeVariant };
      });
      if (generatedVariants.size > 0) {
        await recompositeSession(sessionId);
      }
      await refresh(refreshedDogs);
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
              <div className="cutout-review-images">
                <div>{imageUrl ? <img src={imageUrl} alt={candidateLabel(candidate)} /> : <span>missing</span>}</div>
                <div>{maskUrl ? <img src={maskUrl} alt={`${candidateLabel(candidate)} mask`} /> : <span>mask</span>}</div>
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
