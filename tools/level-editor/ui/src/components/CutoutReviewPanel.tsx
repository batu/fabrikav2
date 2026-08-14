import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DogState, Hitbox, ModelOption, SpriteCandidate } from '../types';
import {
  extractAllCutouts,
  ApiError,
  dogVariantUrl,
  getCutoutExtractionPrompt,
  getRetryFailedDogsJob,
  isAbortError,
  listSpriteCandidates,
  saveSpriteCandidatePlacement,
  spriteCandidateOverlayUrl,
  startRetryFailedDogsJob,
  type RetryFailedDogsJobResponse,
  saveHitboxes,
} from '../api/editorApi';

type CropBox = [number, number, number, number];
type Operation = 'extract' | 'regenerate';
interface CandidateJobState {
  operation: Operation;
  phase: 'running' | 'done' | 'failed';
  message: string;
}
type ControlMode = 'sprite' | 'padding';
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
const DEFAULT_CUTOUT_MODEL = 'google/gemini-3.1-flash-image-preview';

interface Props {
  sessionId: string;
  sharedPrompt: string;
  inpaintModel: string;
  models: ModelOption[];
  hitboxes: Hitbox[];
  dogs: DogState[];
  contentRevision?: string;
  onRevisionChanged?: (contentRevision?: string, operationalRevision?: string) => void;
  onServerHitboxes?: (hitboxes: Hitbox[]) => void;
  onDogComplete: (dogIndex: number, file: string, variantIndex: number) => void;
  onCutoutsChanged?: () => void;
  onPlacementPendingChanged?: (pending: boolean) => void;
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
  useEffect(() => setFailed(false), [src]);
  if (src === null || failed) return <span>{fallback}</span>;
  return <img src={src} alt={alt} draggable={false} style={{ transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` }} onDragStart={(event) => event.preventDefault()} onError={() => setFailed(true)} />;
}

function candidateLabel(candidate: SpriteCandidate): string {
  return `dog #${candidate.dogIndex} · sprite ${String(candidate.spriteIndex).padStart(3, '0')}`;
}

function candidateHitbox(candidate: SpriteCandidate, hitboxes: Hitbox[]): Hitbox | undefined {
  if (candidate.birdId) {
    const stableMatch = hitboxes.find((hitbox) => hitbox.id === candidate.birdId);
    if (stableMatch) return stableMatch;
  }
  return hitboxes[candidate.dogIndex];
}

function conflictRevision(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.detail || typeof error.detail !== 'object') return undefined;
  const outer = error.detail as Record<string, unknown>;
  const detail = outer.detail && typeof outer.detail === 'object' ? outer.detail as Record<string, unknown> : outer;
  return typeof detail.actualContentRevision === 'string' ? detail.actualContentRevision : undefined;
}

function candidateTarget(candidate: SpriteCandidate, hitbox: Hitbox): { x: number; y: number; r: number } {
  const box = candidate.spriteBox;
  if (box && typeof candidate.anchorX === 'number' && typeof candidate.anchorY === 'number') {
    return {
      x: box[0] + candidate.anchorX * (box[2] - box[0]),
      y: box[1] + candidate.anchorY * (box[3] - box[1]),
      r: hitbox.r,
    };
  }
  return hitbox;
}

function defaultCropBox(candidate: SpriteCandidate, hitbox: Hitbox): CropBox {
  const target = candidateTarget(candidate, hitbox);
  const halfSide = Math.round(hitbox.r * 2.75);
  const sceneWidth = candidate.sceneWidth ?? Number.MAX_SAFE_INTEGER;
  const sceneHeight = candidate.sceneHeight ?? Number.MAX_SAFE_INTEGER;
  return [
    Math.max(0, Math.round(target.x - halfSide)),
    Math.max(0, Math.round(target.y - halfSide)),
    Math.min(sceneWidth, Math.round(target.x + halfSide)),
    Math.min(sceneHeight, Math.round(target.y + halfSide)),
  ];
}

function clampCropBox(candidate: SpriteCandidate, hitbox: Hitbox, box: CropBox): CropBox {
  const target = candidateTarget(candidate, hitbox);
  const sceneWidth = candidate.sceneWidth ?? Number.MAX_SAFE_INTEGER;
  const sceneHeight = candidate.sceneHeight ?? Number.MAX_SAFE_INTEGER;
  const minX = Math.max(0, Math.round(target.x - target.r));
  const maxX = Math.min(sceneWidth, Math.round(target.x + target.r));
  const minY = Math.max(0, Math.round(target.y - target.r));
  const maxY = Math.min(sceneHeight, Math.round(target.y + target.r));
  return [
    Math.max(0, Math.min(minX, Math.round(box[0]))),
    Math.max(0, Math.min(minY, Math.round(box[1]))),
    Math.min(sceneWidth, Math.max(maxX, Math.round(box[2]))),
    Math.min(sceneHeight, Math.max(maxY, Math.round(box[3]))),
  ];
}

function translateCropBox(candidate: SpriteCandidate, hitbox: Hitbox, box: CropBox, dx: number, dy: number): CropBox {
  const target = candidateTarget(candidate, hitbox);
  const sceneWidth = candidate.sceneWidth ?? Number.MAX_SAFE_INTEGER;
  const sceneHeight = candidate.sceneHeight ?? Number.MAX_SAFE_INTEGER;
  const minX = Math.max(0, Math.round(target.x - target.r));
  const maxX = Math.min(sceneWidth, Math.round(target.x + target.r));
  const minY = Math.max(0, Math.round(target.y - target.r));
  const maxY = Math.min(sceneHeight, Math.round(target.y + target.r));
  const minDx = Math.max(-box[0], maxX - box[2]);
  const maxDx = Math.min(sceneWidth - box[2], minX - box[0]);
  const minDy = Math.max(-box[1], maxY - box[3]);
  const maxDy = Math.min(sceneHeight - box[3], minY - box[1]);
  const translatedX = Math.max(minDx, Math.min(maxDx, Math.round(dx)));
  const translatedY = Math.max(minDy, Math.min(maxDy, Math.round(dy)));
  return [
    box[0] + translatedX,
    box[1] + translatedY,
    box[2] + translatedX,
    box[3] + translatedY,
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
  hitbox,
  showHitbox,
  onHitboxMoved,
}: {
  sessionId: string;
  candidate: SpriteCandidate;
  cropBox: CropBox;
  placementBox: CropBox;
  imageUrl: string;
  controlMode: ControlMode;
  hitbox?: Hitbox;
  showHitbox: boolean;
  onHitboxMoved?: (hitbox: Hitbox) => void;
}) {
  const sourceBox = candidate.spriteBox ?? placementBox;
  const baseCrop = candidate.cleanupBox ?? sourceBox;
  const viewport = overlaySceneCrop(candidate, baseCrop, sourceBox);
  const width = viewport[2] - viewport[0];
  const height = viewport[3] - viewport[1];
  const target = hitbox ? { x: hitbox.x, y: hitbox.y, r: hitbox.r } : null;
  const hitboxStyle = target ? {
    left: `${(target.x - target.r - viewport[0]) / width * 100}%`,
    top: `${(target.y - target.r - viewport[1]) / height * 100}%`,
    width: `${target.r * 2 / width * 100}%`,
    height: `${target.r * 2 / height * 100}%`,
  } : null;
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
      {controlMode === 'padding' && (
        /* Padding exists only for regeneration: hidden until the operator
           clicks into Padding mode (operator request 2026-08-13). */
        <span className="cutout-padding-box" style={paddingStyle}>
          {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
            <span key={handle} className={`cutout-resize-handle padding-handle handle-${handle}`} data-resize-handle={handle} />
          ))}
        </span>
      )}
      <img
        className="cutout-placement-sprite"
        src={imageUrl}
        alt=""
        draggable={false}
        style={{ ...spriteStyle, transform: `scale(${candidate.flipX ? -1 : 1}, ${candidate.flipY ? -1 : 1})` }}
      />
      {showHitbox && hitboxStyle && target && (
        /* CL-13: the circle edits the hitbox truth directly on the card —
           same canonical commit as the map, no mode switch. */
        <span
          className="cutout-hitbox-circle"
          style={{ ...hitboxStyle, cursor: onHitboxMoved ? 'grab' : undefined, pointerEvents: onHitboxMoved ? 'auto' : 'none' }}
          onPointerDown={onHitboxMoved ? (event) => {
            event.preventDefault();
            event.stopPropagation();
            const surface = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const start = { x: event.clientX, y: event.clientY };
            const origin = { x: target.x, y: target.y };
            const el = event.currentTarget;
            el.setPointerCapture(event.pointerId);
            const onMove = (move: PointerEvent) => {
              const sceneDx = (move.clientX - start.x) / surface.width * width;
              const sceneDy = (move.clientY - start.y) / surface.height * height;
              el.style.left = `${(origin.x + sceneDx - target.r - viewport[0]) / width * 100}%`;
              el.style.top = `${(origin.y + sceneDy - target.r - viewport[1]) / height * 100}%`;
            };
            const onUp = (up: PointerEvent) => {
              el.removeEventListener('pointermove', onMove);
              el.removeEventListener('pointerup', onUp);
              const sceneDx = (up.clientX - start.x) / surface.width * width;
              const sceneDy = (up.clientY - start.y) / surface.height * height;
              onHitboxMoved({
                ...(hitbox as Hitbox),
                x: Math.round(origin.x + sceneDx),
                y: Math.round(origin.y + sceneDy),
              });
            };
            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerup', onUp);
          } : undefined}
        />
      )}
      {controlMode === 'sprite' && (
        <span className="cutout-placement-bounds" style={spriteStyle} aria-hidden="true">
          {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
            <span key={handle} className={`cutout-resize-handle handle-${handle}`} data-resize-handle={handle} />
          ))}
        </span>
      )}
    </span>
  );
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

function isTerminalRetryStatus(status: RetryFailedDogsJobResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed_retryable' ||
    status === 'failed_terminal' || status === 'orphaned_unknown' || status === 'cancelled';
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForRetryJob(
  sessionId: string,
  job: RetryFailedDogsJobResponse,
  signal: AbortSignal,
): Promise<RetryFailedDogsJobResponse> {
  if (isTerminalRetryStatus(job.status)) return job;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const current = await getRetryFailedDogsJob(sessionId, job.jobId, { signal });
    if (isTerminalRetryStatus(current.status)) return current;
    await abortableDelay(1000, signal);
  }
  throw new Error('Timed out waiting for bird extraction job');
}

export default function CutoutReviewPanel({
  sessionId,
  sharedPrompt,
  inpaintModel,
  models,
  hitboxes,
  dogs,
  contentRevision,
  onRevisionChanged,
  onServerHitboxes,
  onDogComplete,
  onCutoutsChanged,
  onPlacementPendingChanged,
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
  const [candidateJobs, setCandidateJobs] = useState<Record<string, CandidateJobState>>({});
  const [extractAllBusy, setExtractAllBusy] = useState(false);
  // Hitboxes visible by default in cutout review (operator 2026-08-13).
  const [showHitbox, setShowHitbox] = useState(true);
  const [extractionPrompt, setExtractionPrompt] = useState<string>('');
  const [defaultExtractionPrompt, setDefaultExtractionPrompt] = useState<string>('');
  // Run-scoped regen-prompt draft: empty means "use the server default".
  // Neither field is persisted anywhere — they live for this focused run.
  const [regenPromptDraft, setRegenPromptDraft] = useState<string>('');
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [cropBoxes, setCropBoxes] = useState<Record<string, CropBox>>({});
  const [placementBoxes, setPlacementBoxes] = useState<Record<string, CropBox>>({});
  const [controlModes, setControlModes] = useState<Record<string, ControlMode>>({});
  const [savingPlacement, setSavingPlacement] = useState<string | null>(null);
  const refreshRunId = useRef(0);
  const dogsRef = useRef(dogs);
  const currentSessionRef = useRef(sessionId);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const operationAbortsRef = useRef(new Map<string, AbortController>());
  const placementSaveRunIds = useRef(new Map<string, number>());
  // CL-12: server-derived owned-paint crops — the read-only default. Manual
  // padding editing survives ONLY when the diff gate flags the level.
  const [derivedCrops, setDerivedCrops] = useState<Record<string, CropBox>>({});
  const [cropsNeedReview, setCropsNeedReview] = useState(false);
  // CL-12: derived crops are READ-ONLY unless the diff gate flagged the
  // level (needsReview) — then the manual override box unlocks.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/derived-crops`);
        if (!response.ok) { setDerivedCrops({}); setCropsNeedReview(true); return; }
        const body = await response.json() as {
          crops: Record<string, { x: number; y: number; width: number; height: number }>;
          needsReview: boolean;
        };
        if (cancelled) return;
        const boxes: Record<string, CropBox> = {};
        for (const [birdId, c] of Object.entries(body.crops)) {
          boxes[birdId] = [c.x, c.y, c.x + c.width, c.y + c.height];
        }
        setDerivedCrops(boxes);
        setCropsNeedReview(body.needsReview);
      } catch { setCropsNeedReview(true); }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const dragRef = useRef<{ candidateId: string; mode: ControlMode; resizeHandle: ResizeHandle | null; startX: number; startY: number; box: CropBox } | null>(null);
  const draggedCandidateRef = useRef<string | null>(null);
  const placementSaveTimers = useRef(new Map<string, number>());
  const placementSavesInFlight = useRef(new Set<string>());
  const placementSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const placementSaveErrorRef = useRef<Error | null>(null);
  const placementFlipRef = useRef(new Map<string, { flipX: boolean; flipY: boolean }>());
  const contentRevisionRef = useRef(contentRevision);
  const onRevisionChangedRef = useRef(onRevisionChanged);

  dogsRef.current = dogs;
  currentSessionRef.current = sessionId;

  useEffect(() => {
    contentRevisionRef.current = contentRevision;
  }, [contentRevision]);

  useEffect(() => {
    onRevisionChangedRef.current = onRevisionChanged;
  }, [onRevisionChanged]);

  const refresh = useCallback(async (dogSnapshot?: DogState[]) => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const runId = refreshRunId.current + 1;
    refreshRunId.current = runId;
    setLoading(true);
    setError(null);
    try {
      const response = await listSpriteCandidates(sessionId, { signal: controller.signal, suppressToast: true });
      if (refreshRunId.current !== runId) return;
      const nextCandidates = activeCandidates(response.candidates, dogSnapshot ?? dogsRef.current);
      setCandidates(nextCandidates);
      setAssetRevision(Date.now());
      if (response.contentRevision) {
        contentRevisionRef.current = response.contentRevision;
        onRevisionChangedRef.current?.(response.contentRevision, response.operationalRevision);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      if (refreshRunId.current !== runId) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (refreshRunId.current === runId) {
        setLoading(false);
      }
      if (refreshAbortRef.current === controller) refreshAbortRef.current = null;
    }
  }, [sessionId]);

  useEffect(() => {
    setCandidates([]);
    setCropBoxes({});
    setPlacementBoxes({});
    setControlModes({});
    setCandidateJobs({});
    setExtractionPrompt('');
    setDefaultExtractionPrompt('');
    setRegenPromptDraft('');
    setLastResult(null);
    setError(null);
    void refresh();
    const promptController = new AbortController();
    void getCutoutExtractionPrompt(sessionId, { signal: promptController.signal, suppressToast: true })
      .then((result) => { setExtractionPrompt(result.prompt); setDefaultExtractionPrompt(result.prompt); })
      .catch((err) => { if (!isAbortError(err)) { setExtractionPrompt(''); setDefaultExtractionPrompt(''); } });
    return () => {
      promptController.abort();
      refreshAbortRef.current?.abort();
    };
  }, [refresh, sessionId]);


  const savePlacement = useCallback(async (
    candidate: SpriteCandidate,
    box: CropBox,
    flipX?: boolean,
    flipY?: boolean,
    cleanupBox = cropBoxes[candidate.id] ?? candidate.cleanupBox ?? undefined,
  ) => {
    const latestFlip = placementFlipRef.current.get(candidate.id);
    const effectiveFlipX = flipX ?? latestFlip?.flipX ?? candidate.flipX ?? false;
    const effectiveFlipY = flipY ?? latestFlip?.flipY ?? candidate.flipY ?? false;
    placementFlipRef.current.set(candidate.id, { flipX: effectiveFlipX, flipY: effectiveFlipY });
    const saveSessionId = sessionId;
    const saveRunId = (placementSaveRunIds.current.get(candidate.id) ?? 0) + 1;
    placementSaveRunIds.current.set(candidate.id, saveRunId);
    const pending = placementSaveTimers.current.get(candidate.id);
    if (pending !== undefined) window.clearTimeout(pending);
    placementSaveTimers.current.delete(candidate.id);
    placementSavesInFlight.current.add(candidate.id);
    placementSaveErrorRef.current = null;
    onPlacementPendingChanged?.(true);
    setSavingPlacement(candidate.id);
    setError(null);
    const previousSave = placementSaveQueueRef.current;
    let releaseSaveQueue!: () => void;
    placementSaveQueueRef.current = new Promise<void>((resolve) => {
      releaseSaveQueue = resolve;
    });
    await previousSave;
    try {
      const save = (revision?: string) => saveSpriteCandidatePlacement(
        saveSessionId,
        candidate.id,
        box,
        effectiveFlipX,
        effectiveFlipY,
        cleanupBox ?? undefined,
        revision,
        { suppressToast: true },
      );
      let saved;
      try {
        saved = await save(contentRevisionRef.current);
      } catch (error) {
        const currentRevision = conflictRevision(error);
        if (!currentRevision) throw error;
        contentRevisionRef.current = currentRevision;
        onRevisionChanged?.(currentRevision);
        saved = await save(currentRevision);
      }
      if (currentSessionRef.current !== saveSessionId) return;
      // Every successful canonical mutation advances the revision used by the
      // next queued save, even when a newer interaction superseded its UI result.
      if (saved.contentRevision) {
        contentRevisionRef.current = saved.contentRevision;
        onRevisionChanged?.(saved.contentRevision, saved.operationalRevision);
      }
      if (placementSaveRunIds.current.get(candidate.id) !== saveRunId) return;
      setCandidates((current) => current.map((item) => (
        item.id === candidate.id ? { ...item, flipX: effectiveFlipX, flipY: effectiveFlipY } : item
      )));
      setPlacementBoxes((current) => ({ ...current, [candidate.id]: saved.spriteBox }));
      if (saved.cleanupBox) setCropBoxes((current) => ({ ...current, [candidate.id]: saved.cleanupBox! }));
      setLastResult(`${candidateLabel(candidate)} placement saved`);
      onCutoutsChanged?.();
    } catch (err) {
      placementSaveErrorRef.current = err instanceof Error ? err : new Error(String(err));
      if (currentSessionRef.current !== saveSessionId || placementSaveRunIds.current.get(candidate.id) !== saveRunId) return;
      // Hunt-A P0-4: a rejected placement must not stay rendered — revert the
      // boxes to the last server-known geometry and clear any stale
      // "placement saved" from an earlier request (P1-7).
      setPlacementBoxes((current) => {
        const next = { ...current };
        if (candidate.spriteBox) next[candidate.id] = candidate.spriteBox; else delete next[candidate.id];
        return next;
      });
      setCropBoxes((current) => {
        const next = { ...current };
        if (candidate.cleanupBox) next[candidate.id] = candidate.cleanupBox; else delete next[candidate.id];
        return next;
      });
      setLastResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      releaseSaveQueue();
      if (currentSessionRef.current === saveSessionId && placementSaveRunIds.current.get(candidate.id) === saveRunId) {
        placementSavesInFlight.current.delete(candidate.id);
        setSavingPlacement(null);
        if (operationAbortsRef.current.size === 0 && placementSaveTimers.current.size === 0 && placementSavesInFlight.current.size === 0) {
          onPlacementPendingChanged?.(false);
        }
      }
    }
  }, [cropBoxes, onCutoutsChanged, onPlacementPendingChanged, onRevisionChanged, sessionId]);

  const waitForPlacementSaves = useCallback(async (): Promise<void> => {
    while (placementSaveTimers.current.size > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
    await placementSaveQueueRef.current;
    if (placementSaveErrorRef.current) throw placementSaveErrorRef.current;
  }, []);

  const setCropBox = useCallback((candidate: SpriteCandidate, hitbox: Hitbox, box: CropBox) => {
    // CL-12 (amended 2026-08-13): the ONE mutation chokepoint for the
    // padding/crop box. The old hard lock is gone — entering Padding mode IS
    // the operator's consent; padding exists only for regeneration.
    const next = clampCropBox(candidate, hitbox, box);
    setCropBoxes((prev) => ({ ...prev, [candidate.id]: next }));
    const spriteBox = placementBoxes[candidate.id] ?? candidate.spriteBox;
    if (!spriteBox) return;
    onPlacementPendingChanged?.(true);
    const pending = placementSaveTimers.current.get(candidate.id);
    if (pending !== undefined) window.clearTimeout(pending);
    placementSaveTimers.current.set(candidate.id, window.setTimeout(() => {
      placementSaveTimers.current.delete(candidate.id);
      void savePlacement(candidate, spriteBox, undefined, undefined, next);
    }, 1000));
  }, [onPlacementPendingChanged, placementBoxes, savePlacement]);

  const setPlacementBox = useCallback((candidate: SpriteCandidate, _hitbox: Hitbox, box: CropBox) => {
    const width = candidate.sceneWidth ?? Number.MAX_SAFE_INTEGER;
    const height = candidate.sceneHeight ?? Number.MAX_SAFE_INTEGER;
    const x0 = Math.max(0, Math.min(width - 1, Math.round(box[0])));
    const y0 = Math.max(0, Math.min(height - 1, Math.round(box[1])));
    const x1 = Math.max(x0 + 1, Math.min(width, Math.round(box[2])));
    const y1 = Math.max(y0 + 1, Math.min(height, Math.round(box[3])));
    const next: CropBox = [x0, y0, x1, y1];
    setPlacementBoxes((prev) => ({ ...prev, [candidate.id]: next }));
    onPlacementPendingChanged?.(true);
    const pending = placementSaveTimers.current.get(candidate.id);
    if (pending !== undefined) window.clearTimeout(pending);
    placementSaveTimers.current.set(candidate.id, window.setTimeout(() => {
      placementSaveTimers.current.delete(candidate.id);
      void savePlacement(candidate, next);
    }, 1000));
  }, [onPlacementPendingChanged, savePlacement]);

  const resetPlacement = useCallback((candidateId: string) => {
    const pending = placementSaveTimers.current.get(candidateId);
    if (pending !== undefined) window.clearTimeout(pending);
    placementSaveTimers.current.delete(candidateId);
    if (operationAbortsRef.current.size === 0 && placementSaveTimers.current.size === 0 && placementSavesInFlight.current.size === 0) {
      onPlacementPendingChanged?.(false);
    }
    setPlacementBoxes((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
  }, [onPlacementPendingChanged]);

  useEffect(() => () => {
    for (const timer of placementSaveTimers.current.values()) window.clearTimeout(timer);
    placementSaveTimers.current.clear();
    placementSavesInFlight.current.clear();
    onPlacementPendingChanged?.(false);
    placementSaveRunIds.current.clear();
    placementFlipRef.current.clear();
    placementSaveErrorRef.current = null;
    for (const controller of operationAbortsRef.current.values()) controller.abort();
    operationAbortsRef.current.clear();
  }, [onPlacementPendingChanged, sessionId]);

  const runCandidate = useCallback(async (operation: Operation, candidate: SpriteCandidate) => {
    // One job per candidate at a time; other candidates and the rest of the
    // panel stay interactive while this one runs.
    if (operationAbortsRef.current.has(candidate.id)) return;
    const runSessionId = sessionId;
    const controller = new AbortController();
    operationAbortsRef.current.set(candidate.id, controller);
    const noun = operation === 'extract' ? 'extraction' : 'regeneration';
    const setJob = (job: CandidateJobState) => {
      if (currentSessionRef.current !== runSessionId) return;
      setCandidateJobs((prev) => ({ ...prev, [candidate.id]: job }));
    };
    setJob({ operation, phase: 'running', message: `${noun} queued…` });
    onPlacementPendingChanged?.(true);
    try {
      await waitForPlacementSaves();
      const hitbox = candidateHitbox(candidate, hitboxes);
      const cropBox = hitbox ? (cropBoxes[candidate.id] ?? (candidate.birdId ? derivedCrops[candidate.birdId] : undefined) ?? defaultCropBox(candidate, hitbox)) : undefined;
      // Distinct nonce per click: forces a fresh generation even when the
      // crop box, prompt, and model are unchanged since the last run.
      const attemptNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const effectiveRegenPrompt = regenPromptDraft.trim() || sharedPrompt;
      const extractionOverride =
        extractionPrompt.trim() && extractionPrompt.trim() !== defaultExtractionPrompt.trim()
          ? extractionPrompt.trim()
          : undefined;
      const start = (revision?: string) => startRetryFailedDogsJob(
        runSessionId,
        [candidate.dogIndex],
        effectiveRegenPrompt,
        2.75,
        cutoutModel,
        cropBox ? { [candidate.dogIndex]: cropBox } : {},
        operation === 'extract',
        { signal: controller.signal, suppressToast: true },
        revision && candidate.birdId && cropBox
          ? {
              birdIds: [candidate.birdId],
              cropBoxesByBirdId: { [candidate.birdId]: cropBox },
              expectedContentRevision: revision,
            }
          : undefined,
        attemptNonce,
        extractionOverride,
      );
      let started;
      try {
        started = await start(contentRevisionRef.current);
      } catch (startError) {
        const currentRevision = conflictRevision(startError);
        if (!currentRevision) throw startError;
        contentRevisionRef.current = currentRevision;
        onRevisionChangedRef.current?.(currentRevision);
        started = await start(currentRevision);
      }
      setJob({ operation, phase: 'running', message: `${noun} running…` });
      const completed = await waitForRetryJob(runSessionId, started, controller.signal);
      const unit = completed.units.find((item) => item.dogIndex === candidate.dogIndex) ?? completed.units[0];
      const succeeded = unit?.status === 'succeeded' && unit.file !== null && unit.variantIndex !== null;
      if (succeeded) {
        // Extraction replaces the sprite derivative for the current painted
        // variant. Only scene regeneration creates a selectable variant —
        // legacy writes it directly; canonical commits the scene and then
        // projects the painting into the rail, reporting the projected
        // variant index and file.
        if (operation === 'regenerate') {
          onDogComplete(unit.dogIndex, unit.file!, unit.variantIndex!);
        }
        const refreshedDogs = dogsRef.current.map((dog) => (
          dog.index === unit.dogIndex ? { ...dog, activeVariant: unit.variantIndex! } : dog
        ));
        await refresh(refreshedDogs);
        onCutoutsChanged?.();
        setJob({ operation, phase: 'done', message: `${noun} saved at ${new Date().toLocaleTimeString()}` });
      } else if (unit?.disposition === 'needs_review') {
        await refresh();
        setJob({ operation, phase: 'failed', message: `${noun} finished but the level changed while it ran — the result was parked, run it again` });
      } else {
        await refresh();
        setJob({ operation, phase: 'failed', message: unit?.error || completed.error || `${noun} failed` });
      }
    } catch (err) {
      if (isAbortError(err)) {
        setJob({ operation, phase: 'failed', message: `${noun} cancelled — late results are rejected if the level changed` });
      } else {
        setJob({ operation, phase: 'failed', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      operationAbortsRef.current.delete(candidate.id);
      if (currentSessionRef.current === runSessionId
        && operationAbortsRef.current.size === 0
        && placementSaveTimers.current.size === 0
        && placementSavesInFlight.current.size === 0) {
        onPlacementPendingChanged?.(false);
      }
    }
  }, [cropBoxes, cutoutModel, extractionPrompt, defaultExtractionPrompt, regenPromptDraft, hitboxes, onCutoutsChanged, onDogComplete, onPlacementPendingChanged, refresh, sessionId, sharedPrompt, waitForPlacementSaves]);

  const runningJobCount = Object.values(candidateJobs).filter((job) => job.phase === 'running').length;

  return (
    <section className="cutout-review-panel">
      <div className="cutout-review-header">
        <div>
          <h3>Cutout review</h3>
        </div>
        <div className="cutout-review-actions">
          {runningJobCount > 0 && (
            <span className="cutout-jobs-running">{runningJobCount} job{runningJobCount === 1 ? '' : 's'} running</span>
          )}
          <button
            type="button"
            className="btn"
            aria-pressed={showHitbox}
            onClick={() => setShowHitbox((current) => !current)}
          >
            {showHitbox ? 'Hide hitbox' : 'Show hitbox'}
          </button>
          <label className="cutout-model-picker">
            <span>Model</span>
            <select value={cutoutModel} onChange={(event) => setCutoutModel(event.target.value)}>
              {cutoutModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={extractAllBusy || loading || hitboxes.length === 0}
            title="Cut (or re-cut) pickup sprites for every hitbox — flatkey single calls, one per bird, then neural placement and canonical adoption."
            onClick={async () => {
              const n = hitboxes.length;
              if (!window.confirm(`Extract cutouts for all ${n} birds? Paid: ~$${(n * 0.035).toFixed(2)} in provider calls. Existing cutouts are re-cut.`)) return;
              setExtractAllBusy(true);
              setError(null);
              try {
                const result = await extractAllCutouts(sessionId, hitboxes, true);
                const promoted = result.canonicalPromotions?.committed ?? 0;
                setLastResult(`Extracted ${result.materialized} cutouts (${promoted} committed canonically).`);
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Extract all failed');
              } finally {
                setExtractAllBusy(false);
              }
            }}
          >
            {extractAllBusy ? 'Extracting…' : '✂ Extract all'}
          </button>
          <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {defaultExtractionPrompt && (
        <details className="cutout-prompt-disclosure">
          <summary>
            Extraction prompt{extractionPrompt.trim() !== defaultExtractionPrompt.trim() ? ' (edited — this run only)' : ''}
          </summary>
          <textarea
            value={extractionPrompt}
            onChange={(e) => setExtractionPrompt(e.target.value)}
            rows={6}
            style={{ width: '100%', background: '#111', color: '#ddd', border: '1px solid #333', borderRadius: 6, padding: 8, fontSize: '0.8rem' }}
          />
          {extractionPrompt.trim() !== defaultExtractionPrompt.trim() && (
            <button type="button" className="btn" style={{ marginTop: 4 }}
              onClick={() => setExtractionPrompt(defaultExtractionPrompt)}>
              Reset to default
            </button>
          )}
        </details>
      )}
      {sharedPrompt && (
        <details className="cutout-prompt-disclosure">
          <summary>
            Regeneration prompt{regenPromptDraft.trim() ? ' (edited — this run only)' : ''}
          </summary>
          <textarea
            value={regenPromptDraft || sharedPrompt}
            onChange={(e) => setRegenPromptDraft(e.target.value)}
            rows={6}
            style={{ width: '100%', background: '#111', color: '#ddd', border: '1px solid #333', borderRadius: 6, padding: 8, fontSize: '0.8rem' }}
          />
          {regenPromptDraft.trim() && (
            <button type="button" className="btn" style={{ marginTop: 4 }}
              onClick={() => setRegenPromptDraft('')}>
              Reset to default
            </button>
          )}
        </details>
      )}

      {error && <div className="cutout-review-error">{error}</div>}
      {lastResult && <div className="cutout-review-result">{lastResult}</div>}
      {loading && <div className="cutout-review-empty">Loading cutouts...</div>}
      {!loading && candidates.length === 0 && (
        <div className="cutout-review-empty">No pickup cutouts found.</div>
      )}
      <div className={`cutout-review-grid${expanded ? ' expanded' : ''}`}>
        {/* CL-15: worst-first triage — highest regeneration probability leads,
            so a 24-bird scroll becomes a 5-bird triage. Unscored sort last. */}
        {[...candidates].sort((a, b) =>
          (b.regenerationProbability ?? -1) - (a.regenerationProbability ?? -1)
        ).map((candidate) => {
          const imageUrl = candidate.image
            ? `${dogVariantUrl(sessionId, candidate.image)}?v=${assetRevision}`
            : null;
          const hitbox = candidateHitbox(candidate, hitboxes);
          const placementBox = candidate.spriteBox
            ? (placementBoxes[candidate.id] ?? candidate.spriteBox)
            : null;
          // Padding display default = the sprite bounding box (operator
          // request 2026-08-13); an explicit edit wins. Regeneration keeps
          // its wider default chain until the operator edits the padding.
          const cropBox = hitbox ? (cropBoxes[candidate.id] ?? placementBox ?? (candidate.birdId ? derivedCrops[candidate.birdId] : undefined) ?? candidate.cleanupBox ?? defaultCropBox(candidate, hitbox)) : null;
          const controlMode = controlModes[candidate.id] ?? 'sprite';
          const job = candidateJobs[candidate.id];
          const jobRunning = job?.phase === 'running';
          const activeBox = controlMode === 'sprite' ? placementBox : cropBox;
          const resizeActiveBox = (delta: CropBox) => {
            if (!hitbox || !activeBox) return;
            const next = activeBox.map((value, index) => value + delta[index]) as CropBox;
            if (controlMode === 'sprite') setPlacementBox(candidate, hitbox, next);
            else setCropBox(candidate, hitbox, next);
          };
          const movePaddingBox = (dx: number, dy: number) => {
            if (!hitbox || !cropBox) return;
            setCropBox(candidate, hitbox, translateCropBox(candidate, hitbox, cropBox, dx, dy));
          };
          const resetActiveBox = () => {
            if (!hitbox) return;
            if (controlMode === 'sprite') resetPlacement(candidate.id);
            else setCropBox(candidate, hitbox, defaultCropBox(candidate, hitbox));
          };
          return (
            <article key={candidate.id} className="cutout-review-card">
              <div className="cutout-review-card-top">
                <strong>{candidateLabel(candidate)}</strong>
                {typeof candidate.regenerationProbability === 'number' && (
                  <span
                    title="Regeneration probability from sprite eval — higher = worse cutout"
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 9,
                      background: candidate.regenerationProbability > 0.5 ? '#4a1d1d'
                        : candidate.regenerationProbability > 0.25 ? '#4a3a1d' : '#1d3a24',
                      color: candidate.regenerationProbability > 0.5 ? '#ff9c9c'
                        : candidate.regenerationProbability > 0.25 ? '#ffd28f' : '#9bf0bf',
                    }}
                  >
                    {Math.round(candidate.regenerationProbability * 100)}%
                  </span>
                )}
                {candidate.birdId && (
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    title="CL-14: revert this bird to its previous extraction (bytes restored from the CAS)"
                    onClick={async () => {
                      try {
                        const historyResponse = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/birds/${encodeURIComponent(candidate.birdId!)}/sprite-history`);
                        const { history } = await historyResponse.json() as { history: { sha256: string; contentRevision: string }[] };
                        if (history.length < 2) { setLastResult('No previous extraction to revert to.'); return; }
                        if (!window.confirm('Revert to the previous extraction for this bird?')) return;
                        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/birds/${encodeURIComponent(candidate.birdId!)}/revert-sprite`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ toContentRevision: history[1]!.contentRevision,
                                                 expectedContentRevision: contentRevisionRef.current,
                                                 humanActor: 'human:editor' }),
                        });
                        if (!response.ok) { setError(`Revert failed (${response.status})`); return; }
                        const body = await response.json() as { contentRevision?: string; operationalRevision?: string };
                        if (body.contentRevision) onRevisionChangedRef.current?.(body.contentRevision, body.operationalRevision);
                        setLastResult('Reverted to the previous extraction.');
                        void refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Revert failed');
                      }
                    }}
                  >
                    ↩ Revert
                  </button>
                )}
                {/* CL-16: no per-bird confirmation — "Mark cutouts reviewed"
                    is the ONLY operator-facing cutout assertion; per-sprite
                    records are auto-stamped plumbing, invisible here. */}
              </div>
              <button
                type="button"
                className="cutout-review-overlay"
                disabled={jobRunning}
                aria-label={`Place ${candidateLabel(candidate)}`}
                title={controlMode === 'sprite'
                  ? 'Drag to place the sprite. Corner-drag resizes; hold Shift for uniform scale.'
                  : 'Padding is used ONLY when regenerating this bird — set it right before a regenerate. Drag to move, corner-drag to resize.'}
                onClick={() => {
                  if (draggedCandidateRef.current === candidate.id) {
                    draggedCandidateRef.current = null;
                    return;
                  }
                }}
                onPointerDown={(event) => {
                  if (!placementBox || !cropBox) return;
                  const resizeHandle = (event.target as HTMLElement).closest<HTMLElement>('[data-resize-handle]')?.dataset.resizeHandle as ResizeHandle | undefined;
                  draggedCandidateRef.current = null;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragRef.current = {
                    candidateId: candidate.id,
                    mode: controlMode,
                    resizeHandle: resizeHandle ?? null,
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
                  if (drag.mode === 'sprite') {
                    if (drag.resizeHandle) {
                      // Corner drags resize freely; HOLD SHIFT for uniform
                      // aspect-preserving scale (operator 2026-08-13 v2 —
                      // always-uniform "made it worse").
                      if (event.shiftKey) {
                        const [x0, y0, x1, y1] = drag.box;
                        const w = x1 - x0, h = y1 - y0;
                        const east = drag.resizeHandle.includes('e');
                        const south = drag.resizeHandle.includes('s');
                        const wantW = Math.max(8, w + (east ? dx : -dx));
                        const wantH = Math.max(8, h + (south ? dy : -dy));
                        const scale = Math.max(wantW / w, wantH / h);
                        const newW = Math.max(8, Math.round(w * scale));
                        const newH = Math.max(8, Math.round(h * scale));
                        const resized: CropBox = [
                          east ? x0 : x1 - newW,
                          south ? y0 : y1 - newH,
                          east ? x0 + newW : x1,
                          south ? y0 + newH : y1,
                        ];
                        setPlacementBox(candidate, hitbox, resized);
                      } else {
                        const resized: CropBox = [...drag.box];
                        if (drag.resizeHandle.includes('w')) resized[0] += dx;
                        if (drag.resizeHandle.includes('e')) resized[2] += dx;
                        if (drag.resizeHandle.includes('n')) resized[1] += dy;
                        if (drag.resizeHandle.includes('s')) resized[3] += dy;
                        setPlacementBox(candidate, hitbox, resized);
                      }
                    } else {
                      const moved: CropBox = [drag.box[0] + dx, drag.box[1] + dy, drag.box[2] + dx, drag.box[3] + dy];
                      setPlacementBox(candidate, hitbox, moved);
                    }
                  } else if (drag.resizeHandle) {
                    if (event.shiftKey) {
                      // Shift = uniform grow for padding too (operator
                      // 2026-08-13), anchored at the opposite corner.
                      const [x0, y0, x1, y1] = drag.box;
                      const w = x1 - x0, h = y1 - y0;
                      const east = drag.resizeHandle.includes('e');
                      const south = drag.resizeHandle.includes('s');
                      const wantW = Math.max(8, w + (east ? dx : -dx));
                      const wantH = Math.max(8, h + (south ? dy : -dy));
                      const scale = Math.max(wantW / w, wantH / h);
                      const newW = Math.max(8, Math.round(w * scale));
                      const newH = Math.max(8, Math.round(h * scale));
                      setCropBox(candidate, hitbox, [
                        east ? x0 : x1 - newW,
                        south ? y0 : y1 - newH,
                        east ? x0 + newW : x1,
                        south ? y0 + newH : y1,
                      ]);
                    } else {
                      const resized: CropBox = [...drag.box];
                      if (drag.resizeHandle.includes('w')) resized[0] += dx;
                      if (drag.resizeHandle.includes('e')) resized[2] += dx;
                      if (drag.resizeHandle.includes('n')) resized[1] += dy;
                      if (drag.resizeHandle.includes('s')) resized[3] += dy;
                      setCropBox(candidate, hitbox, resized);
                    }
                  } else {
                    setCropBox(candidate, hitbox, translateCropBox(candidate, hitbox, drag.box, dx, dy));
                  }
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
                  <PlacementPreview sessionId={sessionId} candidate={candidate} cropBox={cropBox} placementBox={placementBox} imageUrl={imageUrl} controlMode={controlMode} hitbox={hitbox} showHitbox={showHitbox}
                    onHitboxMoved={async (moved) => {
                      // CL-13: same canonical commit path as the map save.
                      try {
                        const revision = contentRevisionRef.current;
                        const next = hitboxes.map((h) => (h.id === moved.id ? moved : h));
                        const result = await saveHitboxes(sessionId, next, 'edit', revision) as
                          { contentRevision?: string; operationalRevision?: string; hitboxes?: Hitbox[] } | undefined;
                        if (result?.contentRevision) onRevisionChangedRef.current?.(result.contentRevision, result.operationalRevision);
                        // Hunt-A #8: report the SERVER's persisted geometry,
                        // and hand it upward so the parent state re-keys.
                        const persisted = result?.hitboxes?.find((h) => h.id === moved.id);
                        if (result?.hitboxes) onServerHitboxes?.(result.hitboxes);
                        setLastResult(persisted
                          ? `Hitbox ${persisted.id?.slice(0, 8) ?? ''} saved at (${persisted.x}, ${persisted.y}).`
                          : 'Hitbox save returned no read-back — refresh before further edits.');
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Hitbox save failed — the circle may be showing unsaved geometry.');
                      }
                    }} />
                ) : (
                  <span>overlay unavailable</span>
                )}
              </button>
              <div className="cutout-review-images">
                <div className="cutout-review-tool-image">
                  <CandidateImage src={imageUrl} alt={candidateLabel(candidate)} fallback="missing sprite" flipX={candidate.flipX} flipY={candidate.flipY} />
                </div>
                <div className="cutout-review-controls">
                  <div className="cutout-control-mode" role="tablist" aria-label={`${candidateLabel(candidate)} control target`}>
                    <button type="button" role="tab" disabled={jobRunning} aria-selected={controlMode === 'sprite'} onClick={() => setControlModes((prev) => ({ ...prev, [candidate.id]: 'sprite' }))}>Sprite</button>
                    <button type="button" role="tab" disabled={jobRunning} aria-selected={controlMode === 'padding'} onClick={() => setControlModes((prev) => ({ ...prev, [candidate.id]: 'padding' }))}>Padding</button>
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
                      {controlMode === 'padding' && <>
                        <button type="button" disabled={jobRunning} onClick={() => movePaddingBox(-10, 0)}>Move left</button>
                        <button type="button" disabled={jobRunning} onClick={() => movePaddingBox(10, 0)}>Move right</button>
                        <button type="button" disabled={jobRunning} onClick={() => movePaddingBox(0, -10)}>Move up</button>
                        <button type="button" disabled={jobRunning} onClick={() => movePaddingBox(0, 10)}>Move down</button>
                      </>}
                      <button type="button" disabled={jobRunning} onClick={() => resizeActiveBox([5, 5, -5, -5])}>Smaller</button>
                      <button type="button" disabled={jobRunning} onClick={() => resizeActiveBox([-5, -5, 5, 5])}>Larger</button>
                      <button type="button" disabled={jobRunning} onClick={() => resizeActiveBox([-5, 0, 5, 0])}>Wider</button>
                      <button type="button" disabled={jobRunning} onClick={() => resizeActiveBox([5, 0, -5, 0])}>Narrower</button>
                      <button type="button" disabled={jobRunning} onClick={() => resizeActiveBox([0, -5, 0, 5])}>Taller</button>
                      <button type="button" disabled={jobRunning} onClick={() => resizeActiveBox([0, 5, 0, -5])}>Shorter</button>
                    </div>
                    {controlMode === 'sprite' && placementBox && <div className="cutout-flip-controls">
                      <button
                        type="button"
                        disabled={jobRunning || savingPlacement === candidate.id}
                        className={candidate.flipX ? 'selected' : ''}
                        aria-pressed={candidate.flipX ?? false}
                        onClick={() => void savePlacement(candidate, placementBox, !(candidate.flipX ?? false), candidate.flipY ?? false)}
                      >Flip X</button>
                      <button
                        type="button"
                        disabled={jobRunning || savingPlacement === candidate.id}
                        className={candidate.flipY ? 'selected' : ''}
                        aria-pressed={candidate.flipY ?? false}
                        onClick={() => void savePlacement(candidate, placementBox, candidate.flipX ?? false, !(candidate.flipY ?? false))}
                      >Flip Y</button>
                    </div>}
                    <button type="button" disabled={jobRunning} onClick={resetActiveBox}>Reset</button>
                  </div>}
                </div>
              </div>
              <div className="cutout-review-buttons">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={jobRunning}
                  onClick={() => void runCandidate('extract', candidate)}
                >
                  {jobRunning && job.operation === 'extract' ? 'Extracting…' : 'Extract'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={jobRunning}
                  onClick={() => void runCandidate('regenerate', candidate)}
                >
                  {jobRunning && job.operation === 'regenerate' ? 'Regenerating…' : 'Regenerate'}
                </button>
                {jobRunning && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => operationAbortsRef.current.get(candidate.id)?.abort()}
                    title="Stop waiting for this job. Any late result is rejected if newer edits changed the level revision."
                  >
                    Stop
                  </button>
                )}
              </div>
              {job && (
                <div className={`cutout-job-status ${job.phase}`} role="status">
                  {job.message}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
