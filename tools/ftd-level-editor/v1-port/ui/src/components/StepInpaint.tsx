import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConfigResponse, DogState, HiddennessLevel, Hitbox, SessionResponse } from '../types';
import type { InpaintStreamControls } from '../api/useInpaintStream';
import { dogVariantUrl, getRetryFailedDogsJob, getSession, recompositePreviewUrl, saveHitboxes, startRetryFailedDogsJob } from '../api/editorApi';
import type { RetryFailedDogsJobResponse } from '../api/editorApi';
import { sessionQueryKey, useSessionQuery } from '../api/useSessionQuery';
import CutoutReviewPanel from './CutoutReviewPanel';
import DogRegenList from './DogRegenList';
import LevelCanvas, { type CanvasMutation, type LevelCanvasState } from './LevelCanvas';
import StepHeader from './StepHeader';
import { effectiveInpaintPrompt } from '../lib/inpaintPrompt';

interface Props {
  sessionId: string | null;
  config: ConfigResponse | null;
  style: string | null;
  setting: string | null;
  scene: string | null;
  dogPrompt: string;
  includeStyleInInpaintPrompt: boolean;
  hiddennessLevel: HiddennessLevel;
  hardHiddenPercent: number;
  inpaintPadding: number;
  inpaintModel: string;
  showOverlay: boolean;
  radius: number;
  collapsed: boolean;
  inpaintStream: InpaintStreamControls;
}

function activeVariantPath(dog: DogState): string | null {
  if (dog.activeVariant === null) return null;
  const padded = String(dog.activeVariant).padStart(3, '0');
  return dog.variants.find((path) => path.endsWith(`/variant_${padded}.png`))
    ?? dog.variants.find((path) => path.endsWith(`variant_${padded}.png`))
    ?? dog.variants[dog.activeVariant]
    ?? null;
}

function dogStatusLabel(dog: DogState): string {
  if (dog.status === 'pending') return 'queued';
  if (dog.status === 'generating' && dog.error?.startsWith('retry ')) return dog.error;
  if (dog.status === 'generating') return 'generating';
  if (dog.status === 'done') return 'done';
  return 'failed';
}

function dogThumbPlaceholder(dog: DogState): string {
  if (dog.status === 'pending') return 'Queued';
  if (dog.status === 'generating') return 'Working';
  if (dog.status === 'done') return 'Done';
  return 'Failed';
}

function requestErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const apiDetail = (err as { detail?: { detail?: { error?: string }; error?: string } }).detail;
    const message = (err as { message?: string }).message;
    return apiDetail?.detail?.error ?? apiDetail?.error ?? message ?? fallback;
  }
  return fallback;
}

function isTerminalRetryStatus(status: RetryFailedDogsJobResponse['status']): boolean {
  return status === 'succeeded' ||
    status === 'failed_retryable' ||
    status === 'failed_terminal' ||
    status === 'orphaned_unknown' ||
    status === 'cancelled';
}

async function waitForRetryJob(sessionId: string, jobId: string): Promise<RetryFailedDogsJobResponse> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = await getRetryFailedDogsJob(sessionId, jobId);
    if (isTerminalRetryStatus(job.status)) return job;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for failed-dog retry job');
}

function mergeRetryErrors(session: SessionResponse, retryErrors: Map<number, string>): SessionResponse {
  if (retryErrors.size === 0) return session;
  return {
    ...session,
    dogs: session.dogs.map((dog) => {
      const error = retryErrors.get(dog.index);
      return error === undefined ? dog : { ...dog, status: 'error' as const, error };
    }),
  };
}

function applyDogComplete(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  dogIndex: number,
  file: string,
  variantIndex: number,
): void {
  queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), (current) =>
    current
      ? {
          ...current,
          dogs: current.dogs.map((dog) => (
            dog.index === dogIndex
              ? {
                  ...dog,
                  status: 'done',
                  activeVariant: variantIndex,
                  variants: [...dog.variants, file],
                  error: undefined,
                }
              : dog
          )),
        }
      : current,
  );
}

function applyDogError(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  dogIndex: number,
  error: string,
): void {
  queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), (current) =>
    current
      ? {
          ...current,
          dogs: current.dogs.map((dog) => (
            dog.index === dogIndex ? { ...dog, status: 'error', error } : dog
          )),
        }
      : current,
  );
}

function applyActiveVariant(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  dogIndex: number,
  variantIndex: number | null,
): void {
  queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), (current) =>
    current
      ? {
          ...current,
          dogs: current.dogs.map((dog) => (
            dog.index === dogIndex ? { ...dog, activeVariant: variantIndex } : dog
          )),
        }
      : current,
  );
}

function updateHitboxesForMutation(
  hitboxes: Hitbox[],
  mutation: CanvasMutation,
): Hitbox[] {
  if (mutation.type === 'move') {
    return hitboxes.map((hitbox, index) => {
      const matches = mutation.dogId ? hitbox.id === mutation.dogId : index === mutation.index;
      return matches ? { ...hitbox, x: mutation.x, y: mutation.y } : hitbox;
    });
  }
  if (mutation.type === 'add') return [...hitboxes, mutation.hitbox];
  if (mutation.type === 'remove') {
    return hitboxes.filter((hitbox, index) =>
      mutation.dogId ? hitbox.id !== mutation.dogId : index !== mutation.index,
    );
  }
  return hitboxes;
}

function updateDogsForMutation(
  dogs: DogState[],
  mutation: CanvasMutation,
): DogState[] {
  if (mutation.type !== 'remove') return dogs;
  return dogs.filter((dog, index) =>
    mutation.dogId ? dog.id !== mutation.dogId : index !== mutation.index,
  );
}

export default function StepInpaint({
  sessionId,
  config,
  style,
  setting,
  scene,
  dogPrompt,
  includeStyleInInpaintPrompt,
  hiddennessLevel,
  hardHiddenPercent,
  inpaintPadding,
  inpaintModel,
  showOverlay,
  radius,
  collapsed,
  inpaintStream,
}: Props) {
  const queryClient = useQueryClient();
  const { data: session } = useSessionQuery(sessionId);
  const [forceOpen, setForceOpen] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [selectedDogIndex, setSelectedDogIndex] = useState<number | null>(null);
  const isCollapsed = collapsed && !forceOpen;

  useEffect(() => {
    if (!sessionId) return;
    inpaintStream.resume(sessionId);
  }, [inpaintStream.resume, sessionId]);

  const promptState = useMemo(() => ({
    config,
    style,
    setting,
    scene,
    dogPrompt,
    includeStyleInInpaintPrompt,
    hiddennessLevel,
  }), [config, dogPrompt, hiddennessLevel, includeStyleInInpaintPrompt, scene, setting, style]);
  const sharedPrompt = effectiveInpaintPrompt(promptState);
  const hardMixPrompt = hiddennessLevel === 'easy'
    ? effectiveInpaintPrompt(promptState, 'hard')
    : '';

  const { start: startInpaint } = inpaintStream;
  const inpaintStatus = inpaintStream.status;
  const handleRegen = useCallback(() => {
    if (!sessionId || !session) return;
    startInpaint(sessionId, session.hitboxes, sharedPrompt, 'crop', '', inpaintModel, hardMixPrompt, hardHiddenPercent, inpaintPadding);
  }, [sessionId, session, sharedPrompt, hardMixPrompt, inpaintModel, hardHiddenPercent, inpaintPadding, startInpaint]);
  const failedDogIndices = useMemo(
    () => (session?.dogs ?? []).filter((d) => d.status === 'error').map((d) => d.index),
    [session?.dogs],
  );
  const handleRetryFailed = useCallback(async () => {
    if (!sessionId || retryingFailed || failedDogIndices.length === 0) return;
    setRetryingFailed(true);
    let regeneratedAny = false;
    try {
      for (const dogIndex of failedDogIndices) {
        queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), (current) =>
          current
            ? {
                ...current,
                dogs: current.dogs.map((dog) => dog.index === dogIndex ? { ...dog, status: 'generating', error: undefined } : dog),
              }
            : current,
        );
      }
      const started = await startRetryFailedDogsJob(
        sessionId,
        failedDogIndices,
        sharedPrompt,
        inpaintPadding,
        inpaintModel,
      );
      const completed = await waitForRetryJob(sessionId, started.jobId);
      const retryErrors = new Map<number, string>();
      for (const unit of completed.units) {
        if (unit.status === 'succeeded' && unit.file !== null && unit.variantIndex !== null) {
          regeneratedAny = true;
          applyDogComplete(queryClient, sessionId, unit.dogIndex, unit.file, unit.variantIndex);
        } else if (unit.status !== 'queued' && unit.status !== 'running') {
          retryErrors.set(unit.dogIndex, unit.error ?? completed.error ?? 'Dog regeneration failed');
          applyDogError(queryClient, sessionId, unit.dogIndex, retryErrors.get(unit.dogIndex) ?? 'Dog regeneration failed');
        }
      }
      if (!regeneratedAny && completed.status !== 'succeeded' && retryErrors.size === 0) {
        for (const dogIndex of failedDogIndices) {
          retryErrors.set(dogIndex, completed.error ?? 'Dog regeneration failed');
        }
      }
      const session = await getSession(sessionId);
      queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), mergeRetryErrors(session, retryErrors));
    } catch (err) {
      console.warn('[StepInpaint] retry failed dogs failed', requestErrorMessage(err, 'Failed to retry errored dogs'));
    } finally {
      setRetryingFailed(false);
    }
  }, [failedDogIndices, inpaintModel, inpaintPadding, queryClient, retryingFailed, sessionId, sharedPrompt]);

  const dogs = session?.dogs ?? [];
  const hitboxes = session?.hitboxes ?? [];
  const doneCount = dogs.filter((d) => d.status === 'done').length;
  const errorCount = dogs.filter((d) => d.status === 'error').length;
  const totalCount = dogs.length;
  const settledCount = doneCount + errorCount;
  const inProgress = inpaintStatus.inpainting || dogs.some((d) => d.status === 'generating');
  // Show controls once every dog has a terminal outcome, even if some
  // errored. Pre-fix, `allDone` required doneCount == totalCount; one
  // error kept the wizard's whole post-inpaint UI hidden forever — the
  // user saw a spinner that never resolved and no sign the run failed.
  const allSettled = settledCount === totalCount && totalCount > 0 && !inProgress;
  const allDone = doneCount === totalCount && totalCount > 0 && !inProgress;
  const progressPct = totalCount > 0 ? (settledCount / totalCount) * 100 : 0;
  const passText = inpaintStatus.inpaintProgress.totalPasses > 1 && inpaintStatus.inpaintProgress.currentPass > 0
    ? ` · pass ${inpaintStatus.inpaintProgress.currentPass}/${inpaintStatus.inpaintProgress.totalPasses}`
    : '';
  const failedDogs = dogs.filter((d) => d.status === 'error');
  const dogErrors = failedDogs.map((d) => ({
    index: d.index,
    error: d.error ?? 'Dog is still marked failed; retry or inspect backend logs.',
  }));

  useEffect(() => {
    if (!sessionId || !inProgress) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const fresh = await getSession(sessionId);
        if (!cancelled) queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), fresh);
      } catch {
        // SSE remains the primary channel. This poll is only a repair path
        // for missed early status events, so avoid adding a second error UI.
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [inProgress, queryClient, sessionId]);

  const variantKey = dogs.map((d) => `${d.index}:${d.activeVariant}`).join(',');
  const canvasBgUrl = useMemo(() => {
    if (doneCount === 0 || !sessionId) return undefined;
    return recompositePreviewUrl(sessionId, `${doneCount}-${variantKey}`);
  }, [doneCount, sessionId, variantKey]);

  const handleCanvasMutation = useCallback((mutation: CanvasMutation): void => {
    if (mutation.type === 'select') {
      setSelectedDogIndex(mutation.index);
      return;
    }
    if (!sessionId) return;
    const current = queryClient.getQueryData<SessionResponse>(sessionQueryKey(sessionId));
    if (!current) return;
    const nextHitboxes = updateHitboxesForMutation(current.hitboxes, mutation);
    const nextDogs = updateDogsForMutation(current.dogs, mutation);
    queryClient.setQueryData<SessionResponse>(sessionQueryKey(sessionId), {
      ...current,
      hitboxes: nextHitboxes,
      dogs: nextDogs,
    });
    void saveHitboxes(sessionId, nextHitboxes, 'inpaint-adjust');
  }, [queryClient, sessionId]);

  const canvasState = useMemo<LevelCanvasState | null>(() => {
    if (!session) return null;
    return {
      sessionId: session.id,
      bgWidth: session.bgWidth,
      bgHeight: session.bgHeight,
      selectedBgIndex: session.selectedBgIndex,
      orientation: session.orientation,
      sections: session.sections,
      hitboxes,
      dogs,
      selectedDogIndex,
      showOverlay,
      radius,
      inpaintPadding,
    };
  }, [dogs, hitboxes, inpaintPadding, radius, selectedDogIndex, session, showOverlay]);

  return (
    <div className={`step ${isCollapsed ? 'collapsed' : ''}`}>
      <StepHeader
        stepNumber={4}
        title="Inpainting Results"
        collapsed={isCollapsed}
        onToggle={collapsed ? () => setForceOpen(!forceOpen) : undefined}
        summary={`${doneCount}/${totalCount} dogs done`}
      />

      {!isCollapsed && (
        <div className="step-content">
          {inProgress && (
            <div className="inpaint-progress">
              <div className="inpaint-progress-bar">
                <div
                  className="inpaint-progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="inpaint-progress-text">
                Inpainting: {doneCount}/{totalCount} dogs done{passText}
              </span>
            </div>
          )}

          {inpaintStatus.inpaintFailed && (
            <div className="inpaint-error">
              <strong>Inpainting failed:</strong> {inpaintStatus.inpaintError ?? 'stream closed before results arrived'}
            </div>
          )}

          {allDone && (
            <div className="inpaint-complete-badge">
              All {totalCount} dogs inpainted — drag hitboxes to adjust alignment
            </div>
          )}

          {inpaintStatus.inpaintFailed && (
            <div
              style={{
                background: '#2b1a1a',
                color: '#ffd9d9',
                border: '1px solid #c54040',
                borderRadius: 6,
                padding: '10px 12px',
                margin: '8px 0',
                fontSize: 13,
              }}
            >
              <strong>Stream disconnected.</strong> The inpaint stream closed before finishing.
              Click Regenerate to retry.
            </div>
          )}

          {failedDogs.length > 0 && (
            <div
              style={{
                background: '#2b1a1a',
                color: '#ffd9d9',
                border: '1px solid #c54040',
                borderRadius: 6,
                padding: '10px 12px',
                margin: '8px 0',
                fontSize: 13,
              }}
            >
              <strong>{dogErrors.length} of {totalCount} dog{dogErrors.length === 1 ? '' : 's'} failed to paint.</strong>
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                {dogErrors.map((e) => (
                  <li key={e.index} style={{ opacity: 0.9, wordBreak: 'break-word' }}>
                    dog #{e.index}: {e.error}
                  </li>
                ))}
              </ul>
              <button
                className="btn"
                onClick={handleRetryFailed}
                disabled={retryingFailed || failedDogIndices.length === 0}
                style={{ marginTop: 8 }}
              >
                {retryingFailed ? `Retrying failed dogs (${failedDogIndices.length})` : `Retry failed dogs (${failedDogIndices.length})`}
              </button>
            </div>
          )}

          {dogs.length > 0 && sessionId && (
            <div
              style={{
                alignSelf: 'stretch',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 8,
                margin: '8px 0 10px',
              }}
            >
              {dogs.map((dog) => {
                const variantPath = activeVariantPath(dog);
                const thumbUrl = dog.status === 'done' && variantPath
                  ? `${dogVariantUrl(sessionId, variantPath)}?v=${dog.activeVariant ?? 'done'}`
                  : null;
                const isRetrying = dog.status === 'generating' && dog.error?.startsWith('retry ');
                const statusColor = dog.status === 'done'
                  ? '#9be28f'
                  : dog.status === 'error'
                    ? '#ff8b8b'
                    : isRetrying
                      ? '#ffd37a'
                      : dog.status === 'generating'
                        ? '#9ad7ff'
                        : '#888';
                return (
                  <div
                    key={dog.index}
                    style={{
                      minWidth: 0,
                      border: `1px solid ${dog.status === 'error' ? '#5a2525' : dog.status === 'done' ? '#285238' : '#2d3340'}`,
                      background: dog.status === 'done' ? '#0f1f15' : dog.status === 'error' ? '#241111' : '#101216',
                      borderRadius: 6,
                      overflow: 'hidden',
                    }}
                    title={dog.error ?? dogStatusLabel(dog)}
                  >
                    <div
                      style={{
                        height: 74,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#080808',
                      }}
                    >
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt={`dog ${dog.index} inpaint`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <span style={{ color: statusColor, fontSize: 12, fontWeight: 700 }}>
                          {dogThumbPlaceholder(dog)}
                        </span>
                      )}
                    </div>
                    <div style={{ padding: '6px 7px', minWidth: 0 }}>
                      <div style={{ color: '#ddd', fontSize: 12, fontWeight: 700 }}>#{dog.index + 1}</div>
                      <div
                        style={{
                          color: statusColor,
                          fontSize: 11,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {dogStatusLabel(dog)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {canvasState && (
            <div className="canvas-centered">
              <LevelCanvas
                state={canvasState}
                dispatch={() => {}}
                onMutate={handleCanvasMutation}
                allowAddRemove={false}
                backgroundOverride={canvasBgUrl}
                hideVariants
                readOnly={inProgress}
              />
            </div>
          )}

          {allSettled && (
            <>
              {allDone && (
                <p className="placement-hint">
                  Drag the hitbox circles to match the dog positions. These positions drive gameplay hit targets, visibility validation, Gallery selection, and Lineup Start.
                </p>
              )}
              <button
                className="btn btn-primary btn-large"
                onClick={handleRegen}
                style={{ marginTop: 16, alignSelf: 'center' }}
              >
                Regenerate All Dogs ({totalCount})
              </button>
              {sessionId && session && (
                <>
                  <CutoutReviewPanel
                    sessionId={sessionId}
                    sharedPrompt={sharedPrompt}
                    inpaintModel={inpaintModel}
                    hitboxes={hitboxes}
                    dogs={dogs}
                    onDogComplete={(dogIndex, file, variantIndex) => applyDogComplete(queryClient, sessionId, dogIndex, file, variantIndex)}
                  />
                  <DogRegenList
                    sessionId={sessionId}
                    sharedPrompt={sharedPrompt}
                    inpaintModel={inpaintModel}
                    bgWidth={session.bgWidth}
                    bgHeight={session.bgHeight}
                    dogs={dogs}
                    hitboxes={hitboxes}
                    onDogComplete={(dogIndex, file, variantIndex) => applyDogComplete(queryClient, sessionId, dogIndex, file, variantIndex)}
                    onActiveVariantChange={(dogIndex, variantIndex) => applyActiveVariant(queryClient, sessionId, dogIndex, variantIndex)}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
