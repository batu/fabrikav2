import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DogState, Hitbox, ModelOption, SpriteCandidate } from '../types';
import {
  dogVariantUrl,
  getCutoutExtractionPrompt,
  getRetryFailedDogsJob,
  listSpriteCandidates,
  saveSpriteCandidatePlacement,
  spriteCandidateOverlayUrl,
  startRetryFailedDogsJob,
  type RetryFailedDogsJobResponse,
} from '../api/editorApi';

type ReviewStatus = 'pending' | 'approved' | 'cleanup' | 'rejected';
type CropBox = [number, number, number, number];
type Operation = 'extract' | 'regenerate';
type ControlMode = 'sprite' | 'padding';
const DEFAULT_CUTOUT_MODEL = 'google/gemini-3.1-flash-image-preview';

interface Props {
  sessionId: string;
  sharedPrompt: string;
  inpaintModel: string;
  models: ModelOption[];
  hitboxes: Hitbox[];
  dogs: DogState[];
  onDogComplete: (dogIndex: number, file: string, variantIndex: number) => void;
  expanded?: boolean;
}

function CandidateImage({ src, alt, fallback, flipX = false, flipY = false }: {
  src: string | null;
  alt: string;
  fallback: string;
  flipX?: boolean;
  flipY?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) return <span>{fallback}</span>;
  return <img src={src} alt={alt} draggable={false} style={{ transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }} onDragStart={(event) => event.preventDefault()} onError={() => setFailed(true)} />;
}

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

function defaultCropBox(candidate: SpriteCandidate, hitbox: Hitbox): CropBox {
  const halfSide = Math.round(hitbox.r * 2.75);
  const sceneWidth = candidate.sceneWidth ?? Number.MAX_SAFE_INTEGER;
  const sceneHeight = candidate.sceneHeight ?? Number.MAX_SAFE_INTEGER;
  return [
    Math.max(0, Math.round(hitbox.x - halfSide)),
    Math.max(0, Math.round(hitbox.y - halfSide)),
    Math.min(sceneWidth, Math.round(hitbox.x + halfSide)),
    Math.min(sceneHeight, Math.round(hitbox.y + halfSide)),
  ];
}

function clampCropBox(candidate: SpriteCandidate, hitbox: Hitbox, box: CropBox): CropBox {
  const sceneWidth = candidate.sceneWidth ?? Number.MAX_SAFE_INTEGER;
  const sceneHeight = candidate.sceneHeight ?? Number.MAX_SAFE_INTEGER;
  const minX = Math.max(0, Math.round(hitbox.x - hitbox.r));
  const maxX = Math.min(sceneWidth, Math.round(hitbox.x + hitbox.r));
  const minY = Math.max(0, Math.round(hitbox.y - hitbox.r));
  const maxY = Math.min(sceneHeight, Math.round(hitbox.y + hitbox.r));
  return [
    Math.max(0, Math.min(minX, Math.round(box[0]))),
    Math.max(0, Math.min(minY, Math.round(box[1]))),
    Math.min(sceneWidth, Math.max(maxX, Math.round(box[2]))),
    Math.min(sceneHeight, Math.max(maxY, Math.round(box[3]))),
  ];
}

function overlaySceneCrop(candidate: SpriteCandidate, cropBox: CropBox, spriteBox: CropBox): CropBox {
  const cleanup = candidate.cleanupBox ?? spriteBox;
  const pad = Math.max(36, Math.round(Math.max(spriteBox[2] - spriteBox[0], spriteBox[3] - spriteBox[1]) * 0.45));
  return [
    Math.max(0, Math.min(spriteBox[0], cleanup[0], cropBox[0]) - pad),
    Math.max(0, Math.min(spriteBox[1], cleanup[1], cropBox[1]) - pad),
    Math.min(candidate.sceneWidth ?? Number.MAX_SAFE_INTEGER, Math.max(spriteBox[2], cleanup[2], cropBox[2]) + pad),
    Math.min(candidate.sceneHeight ?? Number.MAX_SAFE_INTEGER, Math.max(spriteBox[3], cleanup[3], cropBox[3]) + pad),
  ];
}

function PlacementPreview({
  sessionId,
  candidate,
  cropBox,
  placementBox,
  imageUrl,
  controlMode,
}: {
  sessionId: string;
  candidate: SpriteCandidate;
  cropBox: CropBox;
  placementBox: CropBox;
  imageUrl: string;
  controlMode: ControlMode;
}) {
  const sourceBox = candidate.spriteBox ?? placementBox;
  const baseCrop = candidate.cleanupBox ?? sourceBox;
  const viewport = overlaySceneCrop(candidate, baseCrop, sourceBox);
  const width = viewport[2] - viewport[0];
  const height = viewport[3] - viewport[1];
  const spriteStyle = {
    left: `${(placementBox[0] - viewport[0]) / width * 100}%`,
    top: `${(placementBox[1] - viewport[1]) / height * 100}%`,
    width: `${(placementBox[2] - placementBox[0]) / width * 100}%`,
    height: `${(placementBox[3] - placementBox[1]) / height * 100}%`,
  };
  const paddingStyle = {
    left: `${(cropBox[0] - viewport[0]) / width * 100}%`,
    top: `${(cropBox[1] - viewport[1]) / height * 100}%`,
    width: `${(cropBox[2] - cropBox[0]) / width * 100}%`,
    height: `${(cropBox[3] - cropBox[1]) / height * 100}%`,
  };
  const previewStyle = width >= height
    ? { width: '100%', height: `${height / width * 100}%` }
    : { height: '100%', width: `${width / height * 100}%` };
  return (
    <span className={`cutout-placement-preview control-${controlMode}`} style={previewStyle}>
      <CandidateImage
        src={spriteCandidateOverlayUrl(sessionId, candidate.id, baseCrop, sourceBox, true)}
        alt={`${candidateLabel(candidate)} painted scene crop`}
        fallback="overlay unavailable"
      />
      <span className="cutout-padding-box" style={paddingStyle} />
      <img
        className="cutout-placement-sprite"
        src={imageUrl}
        alt=""
        draggable={false}
        style={{ ...spriteStyle, transform: `scale(${candidate.flipX ? -1 : 1}, ${candidate.flipY ? -1 : 1})` }}
      />
    </span>
  );
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
  throw new Error('Timed out waiting for bird extraction job');
}

export const cutoutReviewTestExports = {
  activeCandidates,
  parseStoredReview,
};

export default function CutoutReviewPanel({
  sessionId,
  sharedPrompt,
  inpaintModel,
  models,
  hitboxes,
  dogs,
  onDogComplete,
  expanded = false,
}: Props) {
  const cutoutModels = useMemo(() => models.filter((model) => !model.id.startsWith('fal-ai/')), [models]);
  const [cutoutModel, setCutoutModel] = useState(() => (
    cutoutModels.find((model) => model.id === DEFAULT_CUTOUT_MODEL)?.id ??
    cutoutModels.find((model) => model.id === inpaintModel)?.id ??
    cutoutModels[0]?.id ?? inpaintModel
  ));
  const [candidates, setCandidates] = useState<SpriteCandidate[]>([]);
  const [assetRevision, setAssetRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Record<string, ReviewStatus>>({});
  const [loadedReviewKey, setLoadedReviewKey] = useState<string | null>(null);
  const [runningOperation, setRunningOperation] = useState<Operation | null>(null);
  const [extractionPrompt, setExtractionPrompt] = useState<string>('');
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [cropBoxes, setCropBoxes] = useState<Record<string, CropBox>>({});
  const [placementBoxes, setPlacementBoxes] = useState<Record<string, CropBox>>({});
  const [controlModes, setControlModes] = useState<Record<string, ControlMode>>({});
  const [savingPlacement, setSavingPlacement] = useState<string | null>(null);
  const refreshRunId = useRef(0);
  const dragRef = useRef<{ candidateId: string; mode: ControlMode; startX: number; startY: number; box: CropBox } | null>(null);
  const draggedCandidateRef = useRef<string | null>(null);
  const placementSaveTimers = useRef(new Map<string, number>());

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
      setAssetRevision(Date.now());
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
    void getCutoutExtractionPrompt(sessionId).then((result) => setExtractionPrompt(result.prompt)).catch(() => setExtractionPrompt(''));
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

  const visibleCandidates = useMemo(() => (
    showOnlySelected ? reviewTargets(candidates, review) : candidates
  ), [candidates, review, showOnlySelected]);

  const setCandidateStatus = useCallback((candidate: SpriteCandidate, status: ReviewStatus) => {
    setReview((prev) => ({ ...prev, [candidate.id]: status }));
  }, []);

  const toggleCandidate = useCallback((candidate: SpriteCandidate) => {
    setReview((prev) => {
      const current = prev[candidate.id] ?? initialStatus(candidate);
      const selected = current === 'cleanup' || current === 'rejected';
      return { ...prev, [candidate.id]: selected ? 'pending' : 'cleanup' };
    });
  }, []);

  const setCropBox = useCallback((candidate: SpriteCandidate, hitbox: Hitbox, box: CropBox) => {
    setCropBoxes((prev) => ({ ...prev, [candidate.id]: clampCropBox(candidate, hitbox, box) }));
  }, []);

  const savePlacement = useCallback(async (
    candidate: SpriteCandidate,
    box: CropBox,
    flipX = candidate.flipX ?? false,
    flipY = candidate.flipY ?? false,
  ) => {
    setSavingPlacement(candidate.id);
    setError(null);
    try {
      await saveSpriteCandidatePlacement(sessionId, candidate.id, box, flipX, flipY);
      setLastResult(`${candidateLabel(candidate)} placement saved`);
      await refresh();
      setPlacementBoxes((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPlacement(null);
    }
  }, [refresh, sessionId]);

  const setPlacementBox = useCallback((candidate: SpriteCandidate, hitbox: Hitbox, box: CropBox) => {
    const width = candidate.sceneWidth ?? Number.MAX_SAFE_INTEGER;
    const height = candidate.sceneHeight ?? Number.MAX_SAFE_INTEGER;
    const x0 = Math.max(0, Math.min(Math.round(hitbox.x), Math.round(box[0])));
    const y0 = Math.max(0, Math.min(Math.round(hitbox.y), Math.round(box[1])));
    const x1 = Math.min(width, Math.max(Math.round(hitbox.x), Math.round(box[2])));
    const y1 = Math.min(height, Math.max(Math.round(hitbox.y), Math.round(box[3])));
    const next: CropBox = [x0, y0, x1, y1];
    setPlacementBoxes((prev) => ({ ...prev, [candidate.id]: next }));
    const pending = placementSaveTimers.current.get(candidate.id);
    if (pending !== undefined) window.clearTimeout(pending);
    placementSaveTimers.current.set(candidate.id, window.setTimeout(() => {
      placementSaveTimers.current.delete(candidate.id);
      void savePlacement(candidate, next);
    }, 1000));
  }, [savePlacement]);

  const resetPlacement = useCallback((candidateId: string) => {
    const pending = placementSaveTimers.current.get(candidateId);
    if (pending !== undefined) window.clearTimeout(pending);
    placementSaveTimers.current.delete(candidateId);
    setPlacementBoxes((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
  }, []);

  useEffect(() => () => {
    for (const timer of placementSaveTimers.current.values()) window.clearTimeout(timer);
    placementSaveTimers.current.clear();
  }, []);

  const runSelected = useCallback(async (operation: Operation) => {
    const targets = reviewTargets(candidates, review);
    if (targets.length === 0 || runningOperation !== null) return;
    setRunningOperation(operation);
    setError(null);
    setLastResult(null);
    const completedVariants = new Map<number, number>();
    try {
      const started = await startRetryFailedDogsJob(
        sessionId,
        targets.map((candidate) => candidate.dogIndex),
        sharedPrompt,
        2.75,
        cutoutModel,
        Object.fromEntries(targets.flatMap((candidate) => {
          const hitbox = hitboxes[candidate.dogIndex];
          if (!hitbox) return [];
          return [[candidate.dogIndex, cropBoxes[candidate.id] ?? defaultCropBox(candidate, hitbox)]];
        })),
        operation === 'extract',
      );
      const completed = await waitForRetryJob(sessionId, started);
      for (const unit of completed.units) {
        if (unit.status !== 'succeeded' || unit.file === null || unit.variantIndex === null) continue;
        // Extraction replaces the sprite derivative for the current painted
        // variant. Only scene regeneration creates a selectable variant.
        if (operation === 'regenerate') {
          onDogComplete(unit.dogIndex, unit.file, unit.variantIndex);
        }
        completedVariants.set(unit.dogIndex, unit.variantIndex);
      }
      const refreshedDogs = dogs.map((dog) => {
        const activeVariant = completedVariants.get(dog.index);
        return activeVariant === undefined ? dog : { ...dog, activeVariant };
      });
      await refresh(refreshedDogs);
      const failures = targets.length - completedVariants.size;
      const noun = operation === 'extract' ? 'extraction' : 'regeneration';
      if (failures > 0) {
        setError(completed.error || `${failures} ${noun}${failures === 1 ? '' : 's'} failed`);
      }
      setLastResult(`${targets.length - failures}/${targets.length} ${noun}${targets.length === 1 ? '' : 's'} finished`);
    } finally {
      setRunningOperation(null);
    }
  }, [candidates, cropBoxes, cutoutModel, dogs, hitboxes, onDogComplete, refresh, review, runningOperation, sessionId, sharedPrompt]);

  const busy = runningOperation !== null;

  return (
    <section className="cutout-review-panel">
      <div className="cutout-review-header">
        <div>
          <h3>Cutout review</h3>
          <div className="cutout-review-summary">
            {counts.cleanup + counts.rejected} selected
          </div>
        </div>
        <div className="cutout-review-actions">
          <label className="cutout-review-toggle">
            <input
              type="checkbox"
              checked={showOnlySelected}
              onChange={(event) => setShowOnlySelected(event.target.checked)}
            />
            Show only selected
          </label>
          <label className="cutout-model-picker">
            <span>Model</span>
            <select value={cutoutModel} onChange={(event) => setCutoutModel(event.target.value)} disabled={busy}>
              {cutoutModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => void refresh()} disabled={loading || busy}>
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void runSelected('extract')}
            disabled={busy || counts.cleanup + counts.rejected === 0}
          >
            {runningOperation === 'extract' ? 'Extracting...' : `Extract selected (${counts.cleanup + counts.rejected})`}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void runSelected('regenerate')}
            disabled={busy || counts.cleanup + counts.rejected === 0}
          >
            {runningOperation === 'regenerate' ? 'Regenerating...' : `Regenerate selected (${counts.cleanup + counts.rejected})`}
          </button>
        </div>
      </div>

      {extractionPrompt && (
        <details className="cutout-prompt-disclosure">
          <summary>Extraction prompt</summary>
          <p>{extractionPrompt}</p>
        </details>
      )}

      {error && <div className="cutout-review-error">{error}</div>}
      {lastResult && <div className="cutout-review-result">{lastResult}</div>}
      {loading && <div className="cutout-review-empty">Loading cutouts...</div>}
      {!loading && candidates.length === 0 && (
        <div className="cutout-review-empty">No pickup cutouts found.</div>
      )}
      {!loading && candidates.length > 0 && visibleCandidates.length === 0 && (
        <div className="cutout-review-empty">No cutouts selected.</div>
      )}

      <div className={`cutout-review-grid${expanded ? ' expanded' : ''}`}>
        {visibleCandidates.map((candidate) => {
          const status = review[candidate.id] ?? initialStatus(candidate);
          const willRegenerate = status === 'cleanup' || status === 'rejected';
          const imageUrl = candidate.image
            ? `${dogVariantUrl(sessionId, candidate.image)}?v=${assetRevision}`
            : null;
          const hitbox = hitboxes[candidate.dogIndex];
          const cropBox = hitbox ? (cropBoxes[candidate.id] ?? defaultCropBox(candidate, hitbox)) : null;
          const placementBox = candidate.spriteBox
            ? (placementBoxes[candidate.id] ?? candidate.spriteBox)
            : null;
          const controlMode = controlModes[candidate.id] ?? 'sprite';
          const activeBox = controlMode === 'sprite' ? placementBox : cropBox;
          const resizeActiveBox = (delta: CropBox) => {
            if (!hitbox || !activeBox) return;
            const next = activeBox.map((value, index) => value + delta[index]) as CropBox;
            if (controlMode === 'sprite') setPlacementBox(candidate, hitbox, next);
            else setCropBox(candidate, hitbox, next);
          };
          const resetActiveBox = () => {
            if (!hitbox) return;
            if (controlMode === 'sprite') resetPlacement(candidate.id);
            else setCropBox(candidate, hitbox, defaultCropBox(candidate, hitbox));
          };
          return (
            <article key={candidate.id} className={`cutout-review-card ${status}`}>
              <div className="cutout-review-card-top">
                <strong>{candidateLabel(candidate)}</strong>
              </div>
              <button
                type="button"
                className="cutout-review-overlay"
                aria-label={`${willRegenerate ? 'Remove' : 'Select'} ${candidateLabel(candidate)} ${willRegenerate ? 'from' : 'for'} cutout action`}
                aria-pressed={willRegenerate}
                title="Drag to place the sprite. Click to select it for extraction."
                onClick={() => {
                  if (draggedCandidateRef.current === candidate.id) {
                    draggedCandidateRef.current = null;
                    return;
                  }
                  toggleCandidate(candidate);
                }}
                onPointerDown={(event) => {
                  if (!placementBox || !cropBox) return;
                  draggedCandidateRef.current = null;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragRef.current = {
                    candidateId: candidate.id,
                    mode: controlMode,
                    startX: event.clientX,
                    startY: event.clientY,
                    box: controlMode === 'sprite' ? placementBox : cropBox,
                  };
                }}
                onPointerMove={(event) => {
                  const drag = dragRef.current;
                  if (!placementBox || !cropBox || !hitbox || drag?.candidateId !== candidate.id) return;
                  const dxPixels = event.clientX - drag.startX;
                  const dyPixels = event.clientY - drag.startY;
                  if (Math.abs(dxPixels) + Math.abs(dyPixels) < 3) return;
                  draggedCandidateRef.current = candidate.id;
                  const sourceBox = candidate.spriteBox ?? placementBox;
                  const baseCrop = candidate.cleanupBox ?? sourceBox;
                  const viewport = overlaySceneCrop(candidate, baseCrop, sourceBox);
                  const rect = event.currentTarget.getBoundingClientRect();
                  const sceneWidth = viewport[2] - viewport[0];
                  const sceneHeight = viewport[3] - viewport[1];
                  const sceneAspect = sceneWidth / sceneHeight;
                  const renderedWidth = sceneAspect >= rect.width / rect.height ? rect.width : rect.height * sceneAspect;
                  const renderedHeight = sceneAspect >= rect.width / rect.height ? rect.width / sceneAspect : rect.height;
                  const dx = Math.round(dxPixels * sceneWidth / renderedWidth);
                  const dy = Math.round(dyPixels * sceneHeight / renderedHeight);
                  const moved: CropBox = [drag.box[0] + dx, drag.box[1] + dy, drag.box[2] + dx, drag.box[3] + dy];
                  if (drag.mode === 'sprite') setPlacementBox(candidate, hitbox, moved);
                  else setCropBox(candidate, hitbox, moved);
                }}
                onPointerUp={(event) => {
                  if (dragRef.current?.candidateId === candidate.id) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    dragRef.current = null;
                    window.setTimeout(() => {
                      if (draggedCandidateRef.current === candidate.id) draggedCandidateRef.current = null;
                    }, 0);
                  }
                }}
              >
                {cropBox && placementBox && imageUrl ? (
                  <PlacementPreview sessionId={sessionId} candidate={candidate} cropBox={cropBox} placementBox={placementBox} imageUrl={imageUrl} controlMode={controlMode} />
                ) : (
                  <span>overlay unavailable</span>
                )}
                {willRegenerate && <span>Selected</span>}
              </button>
              <div className="cutout-review-images">
                <div className="cutout-review-tool-image">
                  <CandidateImage src={imageUrl} alt={candidateLabel(candidate)} fallback="missing sprite" flipX={candidate.flipX} flipY={candidate.flipY} />
                </div>
                <div className="cutout-review-controls">
                  <div className="cutout-control-mode" role="tablist" aria-label={`${candidateLabel(candidate)} control target`}>
                    <button type="button" role="tab" aria-selected={controlMode === 'sprite'} onClick={() => setControlModes((prev) => ({ ...prev, [candidate.id]: 'sprite' }))}>Sprite</button>
                    <button type="button" role="tab" aria-selected={controlMode === 'padding'} onClick={() => setControlModes((prev) => ({ ...prev, [candidate.id]: 'padding' }))}>Padding</button>
                  </div>
                  {hitbox && activeBox && <div className="cutout-crop-controls">
                    <div className="cutout-crop-heading">
                      <span>{controlMode === 'sprite' ? 'Sprite placement' : 'Padding box'}</span>
                      <code>{savingPlacement === candidate.id && controlMode === 'sprite' ? 'Saving…' : `${activeBox[2] - activeBox[0]}×${activeBox[3] - activeBox[1]}`}</code>
                    </div>
                    {controlMode === 'padding' && cropBox && (['left', 'top', 'right', 'bottom'] as const).map((label, index) => (
                      <label key={label}>
                        <span>{label}</span>
                        <input
                          type="number"
                          aria-label={`${candidateLabel(candidate)} padding ${label}`}
                          value={cropBox[index]}
                          onChange={(event) => {
                            const next = [...cropBox] as CropBox;
                            next[index] = Number(event.target.value);
                            setCropBox(candidate, hitbox, next);
                          }}
                        />
                      </label>
                    ))}
                    <div className="cutout-resize-grid">
                      <button type="button" onClick={() => resizeActiveBox([5, 5, -5, -5])}>Smaller</button>
                      <button type="button" onClick={() => resizeActiveBox([-5, -5, 5, 5])}>Larger</button>
                      <button type="button" onClick={() => resizeActiveBox([-5, 0, 5, 0])}>Wider</button>
                      <button type="button" onClick={() => resizeActiveBox([5, 0, -5, 0])}>Narrower</button>
                      <button type="button" onClick={() => resizeActiveBox([0, -5, 0, 5])}>Taller</button>
                      <button type="button" onClick={() => resizeActiveBox([0, 5, 0, -5])}>Shorter</button>
                    </div>
                    {controlMode === 'sprite' && placementBox && <div className="cutout-flip-controls">
                      <button
                        type="button"
                        className={candidate.flipX ? 'selected' : ''}
                        aria-pressed={candidate.flipX ?? false}
                        onClick={() => void savePlacement(candidate, placementBox, !(candidate.flipX ?? false), candidate.flipY ?? false)}
                      >Flip X</button>
                      <button
                        type="button"
                        className={candidate.flipY ? 'selected' : ''}
                        aria-pressed={candidate.flipY ?? false}
                        onClick={() => void savePlacement(candidate, placementBox, candidate.flipX ?? false, !(candidate.flipY ?? false))}
                      >Flip Y</button>
                    </div>}
                    <button type="button" onClick={resetActiveBox}>Reset</button>
                  </div>}
                </div>
              </div>
              <div className="cutout-review-buttons">
                <button
                  type="button"
                  className={willRegenerate ? 'selected' : ''}
                  onClick={() => setCandidateStatus(candidate, 'cleanup')}
                >
                  Select
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
