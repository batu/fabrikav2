import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  ApiError,
  getBundleProjection,
  type BundleProjection,
  dryRunSequenceDraft,
  getBuildSize,
  getJob,
  getSequenceWorkflow,
  resetSequenceDraft,
  saveSequenceDraft,
  startSequenceWorkflow,
  type BuildSizeResponse,
  type JobResponse,
  type SequenceActivationResponse,
  type SequenceDiagnostic,
  type SequenceDryRunResponse,
  type SequenceLocalPreviewSummary,
  type SequenceRowStatus,
  type SequenceWorkflowState,
} from '../api/editorApi';
import { dropPositionFromPoint, insertionNeighbors, moveId, type DropPosition } from '../lib/reorder';

/** Start activation 422s carry structured blocking diagnostics the server
 * computes (packageIncomplete, packageAssetInvalid, payloadTooLarge with byte
 * counts, ...). The UI used to drop them and show only the generic "has
 * blocking diagnostics" sentence (ledger 054 #20). Shapes match the workflow
 * validation diagnostics, so they render through the same DiagnosticList. */
function apiActivationDiagnostics(err: unknown): SequenceDiagnostic[] {
  if (!(err instanceof ApiError)) return [];
  const body = err.detail;
  if (!body || typeof body !== 'object' || !('detail' in body)) return [];
  const nested = (body as { detail?: unknown }).detail;
  if (!nested || typeof nested !== 'object') return [];
  const diags = (nested as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diags)) return [];
  return diags.filter((d): d is SequenceDiagnostic =>
    !!d && typeof d === 'object' && typeof (d as { code?: unknown }).code === 'string'
      && typeof (d as { message?: unknown }).message === 'string');
}

const SEQUENCE_REORDER_DRAG_THRESHOLD_PX = 6;
const DEFAULT_START_CHANGELOG_NOTE = 'Start lineup from level editor.';
const START_JOB_STORAGE_KEY = 'ftd:sequenceStartJobId';

function isTerminalJobStatus(status: JobResponse['status']): boolean {
  return [
    'succeeded',
    'failed_retryable',
    'failed_terminal',
    'orphaned_unknown',
    'cancelled',
  ].includes(status);
}

function startStageLabel(stage: string | null): string {
  switch (stage) {
    case 'queued':
      return 'Queued...';
    case 'validating':
    case 'running':
      return 'Validating...';
    case 'packaging':
      return 'Packaging...';
    case 'publishing':
    case 'finalizing':
      return 'Applying update...';
    default:
      return 'Starting...';
  }
}

function isSequenceWorkflowState(value: unknown): value is SequenceWorkflowState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SequenceWorkflowState>;
  return candidate.liveSequence !== undefined
    && candidate.draft !== undefined
    && candidate.catalog !== undefined
    && candidate.validation !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sequenceStartResultState(job: JobResponse): SequenceWorkflowState | null {
  const state = job.result.state;
  return isSequenceWorkflowState(state) ? state : null;
}

function sequenceStartActivation(job: JobResponse): SequenceActivationResponse | null {
  const activation = job.result.activation;
  return isRecord(activation) && isRecord(activation.version) && isRecord(activation.state)
    ? activation as unknown as SequenceActivationResponse
    : null;
}

function sequenceStartDryRun(job: JobResponse): SequenceDryRunResponse | null {
  const dryRun = job.result.dryRun;
  return isRecord(dryRun) && isSequenceWorkflowState(dryRun.state)
    ? dryRun as unknown as SequenceDryRunResponse
    : null;
}

function sequenceStartDiagnostics(job: JobResponse): SequenceDiagnostic[] {
  const diagnostics = job.result.diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.filter((item): item is SequenceDiagnostic =>
    isRecord(item) && typeof item.code === 'string' && typeof item.message === 'string');
}

function apiErrorPayload(err: ApiError): { code?: unknown; state?: unknown; error?: unknown } | null {
  const detail = err.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const maybeNested = detail as { detail?: unknown };
  const payload = typeof maybeNested.detail === 'object' && maybeNested.detail !== null
    ? maybeNested.detail
    : detail;
  return payload as { code?: unknown; state?: unknown; error?: unknown };
}

function stateFromApiError(err: unknown): SequenceWorkflowState | null {
  if (!(err instanceof ApiError)) return null;
  const payload = apiErrorPayload(err);
  if (payload === null) return null;
  return isSequenceWorkflowState(payload.state) ? payload.state : null;
}

function apiErrorCode(err: unknown): unknown {
  return err instanceof ApiError ? apiErrorPayload(err)?.code : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const payload = apiErrorPayload(err);
    if (typeof payload?.error === 'string') return payload.error;
  }
  return err instanceof Error ? err.message : String(err);
}

function chipClass(kind: 'good' | 'bad' | 'warn' | 'muted' | 'info'): string {
  return `sequence-chip sequence-chip-${kind}`;
}

function requestId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface StableRequestId {
  readonly key: string;
  readonly id: string;
}

function stableRequestId(ref: { current: StableRequestId | null }, key: string, prefix: string): string {
  if (ref.current === null || ref.current.key !== key) {
    ref.current = { key, id: requestId(prefix) };
  }
  return ref.current.id;
}

function statusChip(row: SequenceRowStatus): { label: string; kind: 'good' | 'bad' | 'warn' | 'muted' | 'info' } {
  switch (row.catalogStatus) {
    case 'available':
      return { label: 'Ready', kind: 'good' };
    case 'missing':
      return { label: 'Missing package', kind: 'bad' };
    case 'cohort-restricted':
      return { label: 'Cohort-restricted', kind: 'bad' };
    case 'tombstoned':
      return { label: 'Tombstoned', kind: 'bad' };
    case 'unlistable':
      return { label: 'Unlistable', kind: 'bad' };
  }
}

function DiagnosticList({ title, diagnostics }: { title: string; diagnostics: SequenceDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <section className="sequence-panel">
      <h3>{title}</h3>
      <ul className="sequence-diagnostic-list">
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.code}-${diagnostic.levelId ?? 'global'}-${index}`} className={`sequence-diagnostic sequence-diagnostic-${diagnostic.severity}`}>
            <strong>{diagnostic.code}</strong>
            <span>{diagnostic.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function rowById(rows: SequenceRowStatus[]): Map<string, SequenceRowStatus> {
  return new Map(rows.map((row) => [row.levelId, row]));
}

interface SequenceLevelCard {
  readonly id: string;
  readonly name: string;
  readonly chips: readonly { label: string; kind: 'good' | 'bad' | 'warn' | 'muted' | 'info' }[];
  readonly removable: boolean;
}

type SequenceCardListKind = 'draft';

function levelThumbnailUrl(levelId: string): string {
  return `/api/sessions/${encodeURIComponent(levelId)}/gallery-thumb/gemini`;
}

function levelCardInsertionTransform(isBefore: boolean, isAfter: boolean, dragging: boolean): string {
  if (isBefore) return 'translateX(-8px) rotate(-5deg)';
  if (isAfter) return 'translateX(8px) rotate(5deg)';
  if (dragging) return 'translateY(-6px) scale(1.02)';
  return 'none';
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'n/a';
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}

type BuildArtifact = NonNullable<BuildSizeResponse['artifact']>;

function inferBuildType(artifact: BuildArtifact): 'release' | 'debug' | 'unknown' {
  if (artifact.buildType !== undefined) return artifact.buildType;
  const parts = artifact.path.toLowerCase().split(/[\\/]+/);
  if (parts.includes('release')) return 'release';
  if (parts.includes('debug')) return 'debug';
  return 'unknown';
}

interface SequenceLevelCardViewProps {
  readonly card: SequenceLevelCard;
  readonly index: number;
  readonly listKind: SequenceCardListKind;
  readonly disabled: boolean;
  readonly dragging: boolean;
  readonly dropHint: 'before' | 'after' | null;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onRemove?: () => void;
  /** C1: shipped-package size + bundle membership from the projection. */
  readonly sizeBytes?: number;
  readonly bundled?: boolean;
}

function SequenceLevelCardView({
  card,
  index,
  listKind,
  disabled,
  dragging,
  dropHint,
  onPointerDown,
  onRemove,
  sizeBytes,
  bundled,
}: SequenceLevelCardViewProps) {
  const [imageMissing, setImageMissing] = useState(false);
  const isBefore = dropHint === 'before';
  const isAfter = dropHint === 'after';
  const cardStyle = {
    '--sequence-card-transform': levelCardInsertionTransform(isBefore, isAfter, dragging),
  } as CSSProperties;
  const imageStyle = {
    WebkitUserDrag: 'none',
    userSelect: 'none',
  } as CSSProperties;

  return (
    <article
      className="sequence-level-card"
      data-sequence-card-id={card.id}
      data-sequence-list-kind={listKind}
      data-sequence-row-id={card.id}
      data-dragging={dragging ? 'true' : 'false'}
      data-drop-before={isBefore ? 'true' : 'false'}
      data-drop-after={isAfter ? 'true' : 'false'}
      onPointerDown={onPointerDown}
      style={cardStyle}
    >
      <div className="sequence-level-thumb-wrap">
        {imageMissing ? (
          <div className="sequence-level-thumb sequence-level-thumb-placeholder">No preview</div>
        ) : (
          <img
            className="sequence-level-thumb"
            src={levelThumbnailUrl(card.id)}
            alt=""
            draggable={false}
            onError={() => setImageMissing(true)}
            style={imageStyle}
          />
        )}
        <div className="sequence-level-index" aria-label={`Position ${index + 1}`}>{index + 1}</div>
      </div>
      <div className="sequence-level-card-body">
        <strong>{card.name}</strong>
        {sizeBytes !== undefined && (
          <span className={chipClass(bundled ? 'good' : 'muted')} title={bundled ? 'Ships inside the app bundle' : 'Streams from CDN'}>
            {(sizeBytes / (1024 * 1024)).toFixed(1)}MB · {bundled ? 'bundled' : 'CDN'}
          </span>
        )}
        <details className="sequence-card-details">
          <summary>Details</summary>
          <code>{card.id}</code>
          <div className="sequence-chip-row">
            {card.chips.map((chip) => (
              <span key={`${card.id}-${chip.label}`} className={chipClass(chip.kind)}>{chip.label}</span>
            ))}
          </div>
        </details>
        {onRemove && (
          <button
            className="btn sequence-card-remove"
            onClick={onRemove}
            disabled={disabled}
            data-sequence-no-reorder="true"
          >
            Remove
          </button>
        )}
      </div>
    </article>
  );
}

function localPreviewFromState(state: SequenceWorkflowState): SequenceLocalPreviewSummary {
  if (state.localPreview !== undefined) return state.localPreview;
  const starterIds = new Set(state.supportedBuilds.starterLevelIds);
  const runtimeIds = new Set(state.liveSequence.levelIds);
  return {
    source: 'fallback from sequence catalog',
    levelCount: state.catalog.levels.length,
    starterLevelIds: state.supportedBuilds.starterLevelIds,
    missingStarterLevelIds: [],
    levels: state.catalog.levels.map((level) => ({
      id: level.id,
      name: level.name,
      inStarterPrefix: starterIds.has(level.id),
      inRuntimeManifest: runtimeIds.has(level.id),
      catalogUploaded: true,
      catalogListable: level.listable,
    })),
  };
}

export default function SequencePage() {
  const [state, setState] = useState<SequenceWorkflowState | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activationDiagnostics, setActivationDiagnostics] = useState<SequenceDiagnostic[]>([]);
  // C1 dynamic-under-200MB bundle projection (Batu 2026-06-10). The toggle is
  // the reversibility flag the plan requires; default ON.
  const [projection, setProjection] = useState<BundleProjection | null>(null);
  const [dynamicBundle, setDynamicBundle] = useState<boolean>(() => localStorage.getItem('ftd:dynamicBundle') !== 'off');
  const [starting, setStarting] = useState(false);
  const [startStage, setStartStage] = useState<string | null>(null);
  const [startJob, setStartJob] = useState<JobResponse | null>(null);
  const refreshProjection = useCallback(() => {
    getBundleProjection().then(setProjection).catch(() => setProjection(null));
  }, []);
  useEffect(() => { refreshProjection(); }, [refreshProjection]);
  useEffect(() => { localStorage.setItem('ftd:dynamicBundle', dynamicBundle ? 'on' : 'off'); }, [dynamicBundle]);
  const [conflict, setConflict] = useState<SequenceWorkflowState | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [changelogNote, setChangelogNote] = useState('');
  const [destructiveWarningAcknowledged, setDestructiveWarningAcknowledged] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<SequenceDryRunResponse | null>(null);
  const [activationResult, setActivationResult] = useState<SequenceActivationResponse | null>(null);
  const [buildSize, setBuildSize] = useState<BuildSizeResponse | null>(null);
  const [buildSizeError, setBuildSizeError] = useState<string | null>(null);
  const [dragListKind, setDragListKind] = useState<SequenceCardListKind | null>(null);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dropCardId, setDropCardId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition>('before');
  const dryRunResultRef = useRef<HTMLDivElement>(null);
  const activationRequestRef = useRef<StableRequestId | null>(null);

  useEffect(() => {
    if (dryRunResult === null) return;
    dryRunResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [dryRunResult]);

  const applyState = useCallback((next: SequenceWorkflowState) => {
    setState(next);
    setDraftIds(next.draft.levelIds);
    setDirty(false);
    setConflict(null);
    setDryRunResult(null);
    setDestructiveWarningAcknowledged(false);
    refreshProjection();
  }, [refreshProjection]);

  const applyStartJob = useCallback((job: JobResponse): void => {
    setStartJob(job);
    setStartStage(job.stage);
    if (!isTerminalJobStatus(job.status)) {
      setStarting(true);
      return;
    }
    setStarting(false);
    setStartStage(null);
    localStorage.removeItem(START_JOB_STORAGE_KEY);
    activationRequestRef.current = null;
    if (job.status === 'succeeded') {
      const nextState = sequenceStartResultState(job);
      if (nextState !== null) applyState(nextState);
      const nextDryRun = sequenceStartDryRun(job);
      if (nextDryRun !== null) setDryRunResult(nextDryRun);
      const nextActivation = sequenceStartActivation(job);
      if (nextActivation !== null) setActivationResult(nextActivation);
      setError(null);
      setActivationDiagnostics([]);
      return;
    }
    const nextState = sequenceStartResultState(job);
    if (nextState !== null) {
      setState(nextState);
      if (job.errorCode === 'sequence_activation_stale' || job.errorCode === 'remote_config_conflict') {
        setConflict(nextState);
      }
    }
    setActivationDiagnostics(sequenceStartDiagnostics(job));
    setError(job.errorMessage ?? 'Start failed. Review diagnostics and retry.');
  }, [applyState]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setActivationDiagnostics([]);
    getSequenceWorkflow()
      .then(applyState)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [applyState]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const jobId = localStorage.getItem(START_JOB_STORAGE_KEY);
    if (!jobId) return;
    getJob(jobId)
      .then(applyStartJob)
      .catch(() => {
        localStorage.removeItem(START_JOB_STORAGE_KEY);
      });
  }, [applyStartJob]);

  useEffect(() => {
    if (startJob === null || isTerminalJobStatus(startJob.status)) return undefined;
    let cancelled = false;
    const poll = () => {
      getJob(startJob.id)
        .then((job) => {
          if (!cancelled) applyStartJob(job);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorMessage(err));
        });
    };
    const timer = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyStartJob, startJob]);

  const refreshBuildSize = useCallback(() => {
    setBuildSizeError(null);
    getBuildSize()
      .then(setBuildSize)
      .catch((err: unknown) => setBuildSizeError(errorMessage(err)));
  }, []);

  useEffect(() => { refreshBuildSize(); }, [refreshBuildSize]);

  const rowsById = useMemo(() => rowById(state?.validation.rows ?? []), [state]);
  const catalogById = useMemo(() => {
    if (state === null) return new Map();
    return new Map(state.catalog.levels.map((level) => [level.id, level]));
  }, [state]);
  const draftCards = useMemo<SequenceLevelCard[]>(() => (
    draftIds.map((levelId) => {
      const row = rowsById.get(levelId);
      const status = row ? statusChip(row) : { label: 'Unsaved draft-listed', kind: 'info' as const };
      return {
        id: levelId,
        name: row?.name ?? catalogById.get(levelId)?.name ?? levelId,
        chips: [
          ...(row?.liveListed ? [{ label: 'Live-listed', kind: 'muted' as const }] : []),
          ...(row?.bundledInApp ? [{ label: 'Bundled in app', kind: 'good' as const }] : []),
          ...(row?.added ? [{ label: 'Added', kind: 'info' as const }] : []),
          ...(row?.moved ? [{ label: 'Moved', kind: 'warn' as const }] : []),
          status,
        ],
        removable: true,
      };
    })
  ), [catalogById, draftIds, rowsById]);
  const workflowBusy = saving || dryRunning || starting;
  const draftMutationDisabled = workflowBusy || conflict !== null;

  const markDraftChanged = useCallback((nextIds: string[]) => {
    setDraftIds(nextIds);
    setDirty(true);
    setDryRunResult(null);
    setActivationResult(null);
  }, []);

  const removeLevel = useCallback((levelId: string) => {
    markDraftChanged(draftIds.filter((id) => id !== levelId));
  }, [draftIds, markDraftChanged]);

  const resetSequenceDragState = useCallback(() => {
    setDragListKind(null);
    setDragCardId(null);
    setDropCardId(null);
    setDropPosition('before');
  }, []);

  const reorderSequenceCards = useCallback((
    listKind: SequenceCardListKind,
    cardId: string,
    targetCardId: string,
    targetPosition: DropPosition,
    orderedIds: string[],
  ) => {
    const nextIds = moveId(orderedIds, cardId, targetCardId, targetPosition);
    if (nextIds === orderedIds) return;
    markDraftChanged(nextIds);
  }, [markDraftChanged]);

  const startSequenceCardDrag = useCallback((
    listKind: SequenceCardListKind,
    cardId: string,
    orderedIds: string[],
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.button !== 0 || draftMutationDisabled) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-sequence-no-reorder="true"]')) return;

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let targetCardId: string | null = cardId;
    let targetPosition: DropPosition = 'before';

    event.currentTarget.setPointerCapture(pointerId);
    event.preventDefault();
    setDragListKind(listKind);
    setDragCardId(cardId);
    setDropCardId(cardId);
    setDropPosition('before');

    const updateDropTarget = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const cardElement = element?.closest<HTMLElement>('[data-sequence-card-id]');
      if (cardElement === null || cardElement?.dataset.sequenceListKind !== listKind) return;
      const nextTargetId = cardElement.dataset.sequenceCardId;
      if (!nextTargetId) return;
      const nextPosition = dropPositionFromPoint(cardElement.getBoundingClientRect(), clientX, clientY);
      targetCardId = nextTargetId;
      targetPosition = nextPosition;
      setDropCardId(nextTargetId);
      setDropPosition(nextPosition);
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!dragging && distance < SEQUENCE_REORDER_DRAG_THRESHOLD_PX) return;
      dragging = true;
      updateDropTarget(moveEvent.clientX, moveEvent.clientY);
    };

    const finishDrag = (commit: boolean) => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      if (commit && dragging && targetCardId !== null) {
        reorderSequenceCards(listKind, cardId, targetCardId, targetPosition, orderedIds);
      }
      resetSequenceDragState();
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      finishDrag(true);
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      finishDrag(false);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
  }, [draftMutationDisabled, reorderSequenceCards, resetSequenceDragState]);

  const persistDraft = useCallback(async (
    currentState: SequenceWorkflowState,
    levelIds: string[],
  ): Promise<SequenceWorkflowState | null> => {
    setSaving(true);
    setError(null);
    setActivationDiagnostics([]);
    setConflict(null);
    try {
      const nextState = await saveSequenceDraft({
        levelIds,
        baseLiveSequenceVersion: currentState.liveSequence.sequenceVersion,
        baseCatalogRevision: currentState.catalog.catalogRevision,
        draftRevision: currentState.draft.draftRevision,
      });
      applyState(nextState);
      return nextState;
    } catch (err: unknown) {
      const staleState = stateFromApiError(err);
      if (staleState !== null) {
        setConflict(staleState);
        setState(staleState);
        setError('Lineup changed on the server. Reload the current game state, then save again.');
        return null;
      }
      setError(errorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, [applyState]);

  const saveDraft = useCallback(() => {
    if (state === null || conflict !== null || saving || dryRunning || starting) return;
    void persistDraft(state, draftIds);
  }, [conflict, draftIds, dryRunning, persistDraft, saving, starting, state]);

  const resetDraft = useCallback(() => {
    if (state === null) return;
    setSaving(true);
    setError(null);
    setActivationDiagnostics([]);
    resetSequenceDraft({ draftRevision: state.draft.draftRevision })
      .then(applyState)
      .catch((err: unknown) => {
        const staleState = stateFromApiError(err);
        if (staleState !== null) {
          setConflict(staleState);
          setState(staleState);
          setError('Lineup changed on the server. Reload the current game state, then reset again.');
          return;
        }
        setError(errorMessage(err));
      })
      .finally(() => setSaving(false));
  }, [applyState, state]);

  const dryRun = useCallback(() => {
    if (state === null) return;
    setDryRunResult(null);
    setDryRunning(true);
    setError(null);
    setActivationDiagnostics([]);
    setConflict(null);
    dryRunSequenceDraft({
      changelogNote: changelogNote.trim() || DEFAULT_START_CHANGELOG_NOTE,
      baseLiveSequenceVersion: state.liveSequence.sequenceVersion,
      baseCatalogRevision: state.catalog.catalogRevision,
      draftRevision: state.draft.draftRevision,
    })
      .then((result) => {
        setState(result.state);
        setDraftIds(result.state.draft.levelIds);
        setDirty(false);
        setConflict(null);
        setDryRunResult(result);
      })
      .catch((err: unknown) => {
        const nextState = stateFromApiError(err);
        if (nextState !== null) {
          setState(nextState);
          if (apiErrorCode(err) === 'sequence_draft_stale') {
            setConflict(nextState);
          }
        }
        setDryRunResult(null);
        setError(errorMessage(err));
      })
      .finally(() => setDryRunning(false));
  }, [changelogNote, state]);

  // C1 "one Start": the server owns validation -> bundle projection -> game update as
  // a durable job. The browser only starts and observes the job so reloads and
  // process restarts recover through the shared job ledger.
  const startPublish = useCallback(async () => {
    if (state === null || saving || dryRunning || starting || conflict !== null) return;
    const startState = dirty ? await persistDraft(state, draftIds) : state;
    if (startState === null) return;
    const activationKey = [
      startState.draft.draftRevision,
      startState.liveSequence.sequenceVersion,
      startState.catalog.catalogRevision,
      dynamicBundle ? 'dynamic' : 'fixed',
      destructiveWarningAcknowledged ? 'ack' : 'no-ack',
    ].join(':');
    setStarting(true);
    setError(null);
    setActivationDiagnostics([]);
    setDryRunResult(null);
    setActivationResult(null);
    setConflict(null);
    try {
      setStartStage('queued');
      const job = await startSequenceWorkflow({
        changelogNote: changelogNote.trim() || DEFAULT_START_CHANGELOG_NOTE,
        baseLiveSequenceVersion: startState.liveSequence.sequenceVersion,
        baseCatalogRevision: startState.catalog.catalogRevision,
        draftRevision: startState.draft.draftRevision,
        destructiveWarningAcknowledged,
        dynamicBundle,
        requestId: stableRequestId(activationRequestRef, activationKey, 'start'),
      });
      localStorage.setItem(START_JOB_STORAGE_KEY, job.id);
      applyStartJob(job);
    } catch (err: unknown) {
      const nextState = stateFromApiError(err);
      if (nextState !== null) {
        setState(nextState);
        if (apiErrorCode(err) === 'sequence_activation_stale' || apiErrorCode(err) === 'remote_config_conflict') {
          setConflict(nextState);
        }
      }
      setError(errorMessage(err));
      setActivationDiagnostics(apiActivationDiagnostics(err));
      setStarting(false);
      setStartStage(null);
    }
  }, [applyStartJob, changelogNote, conflict, destructiveWarningAcknowledged, dirty, draftIds, dryRunning, dynamicBundle, persistDraft, saving, starting, state]);

  const copyPrompt = useCallback(() => {
    const prompt = state?.validation.copyFixPrompt;
    if (!prompt) return;
    navigator.clipboard.writeText(prompt)
      .then(() => setCopyStatus('Copied fix prompt.'))
      .catch(() => setCopyStatus('Copy failed; select the prompt text manually.'));
  }, [state]);

  if (loading) {
    return (
      <div className="sequence-page">
        <div className="loading-spinner" />
        <p>Loading Lineup...</p>
      </div>
    );
  }

  if (state === null) {
    return (
      <div className="sequence-page">
        <section className="sequence-panel sequence-panel-danger">
          <h2>Lineup unavailable</h2>
          <p>{error ?? 'Unknown error'}</p>
          <button className="btn" onClick={refresh}>Retry</button>
        </section>
      </div>
    );
  }

  const blockingDiagnostics = state.validation.blockingDiagnostics;
  const warnings = state.validation.warnings;
  const destructiveChange = state.validation.diff.destructive;
  const dryRunDisabled = dirty || workflowBusy || conflict !== null || !state.validation.dryRunnable;
  const startDisabled = workflowBusy || conflict !== null || (destructiveChange && !destructiveWarningAcknowledged);
  const localPreview = localPreviewFromState(state);
  const fixedStarterCount = state.supportedBuilds.starterLevelIds.length;
  // C1: under the dynamic policy the bundle boundary derives from cumulative
  // shipped-package size (<= 200MB cap), not the curated fixed list.
  const bundledStarterCount = dynamicBundle && projection ? projection.boundaryIndex : fixedStarterCount;
  const remoteSequenceCount = Math.max(0, draftIds.length - bundledStarterCount);
  const projectionById = new Map((projection?.levels ?? []).map((l) => [l.id, l]));
  const buildArtifact = buildSize?.artifact ?? null;
  const buildArtifactType = buildArtifact === null ? null : inferBuildType(buildArtifact);
  const buildArtifactBudgetApplies = buildArtifact === null
    ? false
    : buildArtifact.budgetApplies ?? (buildArtifact.buildType === undefined ? true : buildArtifactType !== 'debug');
  const buildArtifactStoreOverLimit = buildArtifact === null
    ? false
    : buildArtifact.storeBudgetOverLimit ?? (buildArtifactBudgetApplies && buildArtifact.overLimit);
  const buildArtifactIsRelease = buildArtifactType === 'release';
  const buildArtifactIsDebug = buildArtifactType === 'debug';
  const buildArtifactKind = buildArtifact?.kind.toUpperCase() ?? 'APK/AAB';
  const buildBudgetChip = buildArtifact === null
    ? { label: 'No build artifact', kind: 'muted' as const }
    : buildArtifactBudgetApplies
      ? {
          label: buildArtifactStoreOverLimit ? 'Over 200 MB' : 'Under 200 MB',
          kind: buildArtifactStoreOverLimit ? 'bad' as const : 'good' as const,
        }
      : { label: 'Non-shipping build', kind: 'info' as const };

  return (
    <div className="sequence-page">
      <div className="sequence-hero">
        <div>
          <p className="sequence-eyebrow">Lineup</p>
          <h2>Choose the level order players get in the game</h2>
          <p>
            Gallery selects the completed levels. Lineup orders and validates them, then Start updates the playable game.
          </p>
        </div>
        <div className="sequence-hero-actions">
          <button className="btn" onClick={refresh} disabled={workflowBusy}>Reload</button>
          <button className="btn" onClick={resetDraft} disabled={workflowBusy || conflict !== null}>Reset to current game order</button>
          <button
            className="btn btn-primary"
            onClick={() => { void startPublish(); }}
            disabled={startDisabled || starting}
            data-sequence-start="true"
            title="Start validates the lineup, derives the bundle boundary, packages assets, and applies the playable game update."
          >
            {starting ? startStageLabel(startStage) : 'Start'}
          </button>
        </div>
      </div>

      {error && <div className="sequence-error" role="alert">{error}</div>}
      {startJob && (
        <section className="sequence-panel">
          <div className="sequence-panel-header">
            <div>
              <h3>Start job</h3>
              <p className="sequence-muted">
                Durable backend job <code>{startJob.id}</code> · {startJob.status}
                {startJob.stage ? ` · ${startJob.stage}` : ''}
              </p>
            </div>
            <span className={chipClass(startJob.status === 'succeeded' ? 'good' : isTerminalJobStatus(startJob.status) ? 'bad' : 'info')}>
              {startJob.status === 'succeeded' ? 'Complete' : isTerminalJobStatus(startJob.status) ? 'Needs review' : startStageLabel(startJob.stage)}
            </span>
          </div>
          {startJob.errorMessage && <p className="sequence-muted">{startJob.errorMessage}</p>}
        </section>
      )}
      <DiagnosticList title="Start blockers" diagnostics={activationDiagnostics} />
      {conflict && (
        <section className="sequence-panel sequence-panel-warning" data-sequence-conflict="true">
          <h3>Stale Lineup conflict</h3>
          <p>The current game order or level library changed while this Lineup was open.</p>
          <button className="btn btn-primary" onClick={refresh}>Reload current state</button>
        </section>
      )}

      <DiagnosticList title="Blocking validation" diagnostics={blockingDiagnostics} />
      <DiagnosticList title="Warnings" diagnostics={warnings} />

      <section className={`sequence-panel sequence-size-panel ${buildArtifactStoreOverLimit ? 'sequence-size-panel-over' : ''}`}>
        <div>
          <h3>Build size check</h3>
          {buildSizeError ? (
            <p className="sequence-muted">{buildSizeError}</p>
          ) : buildArtifact ? (
            <p className="sequence-muted">
              {buildArtifactIsRelease ? 'Release' : buildArtifactIsDebug && !buildArtifactBudgetApplies ? 'Non-shipping' : 'Build'} {buildArtifactKind}: <strong>{formatBytes(buildArtifact.sizeBytes)}</strong>
              {buildArtifactBudgetApplies ? ` of ${formatBytes(buildSize?.limitBytes ?? null)} max` : ' · not used for the 200 MB store budget'}
              {' '}· {buildArtifact.path} · {formatUnixSeconds(buildArtifact.modifiedAt)}
            </p>
          ) : (
            <p className="sequence-muted">No APK/AAB build artifact found yet.</p>
          )}
        </div>
        <div className="sequence-size-facts">
          <span className={chipClass(buildBudgetChip.kind)}>
            {buildBudgetChip.label}
          </span>
          <span className={chipClass('muted')}>Bundled levels {formatBytes(buildSize?.levelAssetsSizeBytes ?? null)}</span>
          <button className="btn" onClick={refreshBuildSize}>Refresh size</button>
        </div>
      </section>

      {state.validation.copyFixPrompt && (
        <section className="sequence-panel sequence-panel-warning">
          <div className="sequence-panel-header">
            <h3>Copy repair prompt for missing levels</h3>
            <button className="btn" onClick={copyPrompt}>Copy repair prompt</button>
          </div>
          <textarea className="sequence-copy-prompt" value={state.validation.copyFixPrompt} readOnly />
          {copyStatus && <p className="sequence-muted">{copyStatus}</p>}
        </section>
      )}

      <section className="sequence-panel">
        <div className="sequence-panel-header">
          <div>
            <h3>Selected levels</h3>
            <p className="sequence-muted">
              Drag these {draftIds.length} selected levels into the order players should receive. The first {bundledStarterCount} are bundled into this build; the remaining {remoteSequenceCount} stream as players progress.
            </p>
          </div>
          <div className="sequence-actions">
            <span className={chipClass('info')}>{draftIds.length} in game</span>
            <span className={chipClass('good')}>{bundledStarterCount} bundled</span>
            <span className={chipClass('muted')}>{remoteSequenceCount} remote</span>
            {projection && dynamicBundle && (
              <span className={chipClass(projection.bundledBytes > projection.capBytes * 0.9 ? 'warn' : 'good')} title="Cumulative bundled package size vs the 200MB cap">
                {(projection.bundledBytes / (1024 * 1024)).toFixed(1)} / {(projection.capBytes / (1024 * 1024)).toFixed(0)} MB bundled
              </span>
            )}
            <label className="sequence-checkbox" title="Derive the under-200MB bundle boundary from the current order.">
              <input type="checkbox" checked={dynamicBundle} onChange={(e) => setDynamicBundle(e.target.checked)} />
              dynamic bundle
            </label>
            {dirty && <span className={chipClass('warn')}>Unsaved order changes</span>}
            <button className="btn btn-primary" onClick={saveDraft} disabled={!dirty || workflowBusy || conflict !== null}>{saving ? 'Saving...' : 'Save order'}</button>
          </div>
        </div>
        {localPreview.missingStarterLevelIds.length > 0 && (
          <div className="sequence-error">
            Missing bundled starter package directories: {localPreview.missingStarterLevelIds.join(', ')}
          </div>
        )}

        <div className="sequence-card-grid sequence-list" data-sequence-draft-list="true">
          {draftCards.map((card, index) => {
            const neighbors = insertionNeighbors(draftCards, (item) => item.id, dragListKind === 'draft' ? dragCardId : null, dropCardId, dropPosition);
            return (
              <Fragment key={`${card.id}-${index}`}>
                {index === bundledStarterCount && (
                  <div className="sequence-boundary">
                    {dynamicBundle
                      ? `— 200MB bundle boundary — ${remoteSequenceCount} levels stream past this line.`
                      : `${remoteSequenceCount} remote levels continue from here as players progress.`}
                  </div>
                )}
                <SequenceLevelCardView
                  key={`${card.id}-${index}`}
                  card={card}
                  index={index}
                  listKind="draft"
                  disabled={draftMutationDisabled}
                  dragging={dragListKind === 'draft' && dragCardId === card.id}
                  dropHint={dragListKind === 'draft' && neighbors.rightId === card.id ? 'before' : dragListKind === 'draft' && neighbors.leftId === card.id ? 'after' : null}
                  onPointerDown={(event) => startSequenceCardDrag('draft', card.id, draftCards.map((item) => item.id), event)}
                  onRemove={() => removeLevel(card.id)}
                  sizeBytes={dynamicBundle ? projectionById.get(card.id)?.sizeBytes : undefined}
                  bundled={projectionById.get(card.id)?.bundled}
                />
              </Fragment>
            );
          })}
          {state.validation.rows.filter((row) => row.removed).map((row) => (
            <article key={`removed-${row.levelId}`} className="sequence-row sequence-row-removed">
              <div className="sequence-row-index">—</div>
              <div className="sequence-row-main">
                <strong>{row.name}</strong>
                <code>{row.levelId}</code>
                <div className="sequence-chip-row">
                  <span className={chipClass('muted')}>Live-listed</span>
                  <span className={chipClass('warn')}>Removed</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <details className="sequence-panel sequence-advanced-panel">
        <summary>Diagnostics and recovery</summary>
        <div className="sequence-advanced-section">
          <h3>Validation payload</h3>
        <label className="sequence-label">
          Changelog note
          <textarea
            className="sequence-note"
            value={changelogNote}
            onChange={(event) => setChangelogNote(event.target.value)}
            placeholder="Example: Add two approved levels after the starter set."
          />
        </label>
        <button className="btn" onClick={dryRun} disabled={dryRunDisabled} title="Validate only. Does not update the playable game.">
          {dryRunning ? 'Checking...' : 'Validation check only'}
        </button>
        {dirty && <p className="sequence-muted">Save order changes before running the validation-only check.</p>}
        {dryRunResult && (
          <div ref={dryRunResultRef} className="sequence-dry-run-result" data-sequence-dry-run-result="true">
            <p><strong>Validation payload ready.</strong> Game update mutated: {dryRunResult.globalActivationMutated ? 'yes' : 'no'}</p>
            <p><strong>Lineup version:</strong> {dryRunResult.payload.sequenceVersion}</p>
            <p><strong>SHA-256:</strong> <code>{dryRunResult.sha256Hex}</code></p>
            <textarea className="sequence-copy-prompt" value={dryRunResult.rawPayload} readOnly />
          </div>
        )}
        </div>
        <div className="sequence-advanced-section sequence-live-action">
          <strong>Start safety</strong>
          {destructiveChange && (
            <label className="sequence-checkbox">
              <input
                type="checkbox"
                checked={destructiveWarningAcknowledged}
                onChange={(event) => setDestructiveWarningAcknowledged(event.target.checked)}
              />
              I reviewed the moved/removed live-listed level warning.
            </label>
          )}
          <p className="sequence-muted">Playable game updates happen through Start above.{starting ? ' Start is running...' : ''}</p>
        </div>
        {activationResult && (
          <div className="sequence-dry-run-result" data-sequence-activation-result="true">
            <p><strong>{activationResult.idempotent ? 'Existing Start result reused.' : 'Lineup updated.'}</strong></p>
            <p><strong>Active version:</strong> {activationResult.version.sequenceVersion}</p>
            <p><strong>SHA-256:</strong> <code>{activationResult.version.sha256Hex}</code></p>
          </div>
        )}
      </details>
    </div>
  );
}
