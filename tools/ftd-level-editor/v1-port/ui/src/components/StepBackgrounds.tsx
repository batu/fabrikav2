import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConfigResponse, GenerationProgress, LevelSection, SessionResponse } from '../types';
import { isAbortError, selectBackground, upscaleBackground, bgFullUrl } from '../api/editorApi';
import { sessionQueryKey, useSessionQuery } from '../api/useSessionQuery';
import StepHeader from './StepHeader';

interface Props {
  sessionId: string | null;
  config: ConfigResponse;
  upscaleEnabled: boolean;
  upscaleModel: string;
  upscaleTargetLongEdge: number;
  generating: boolean;
  generationProgress: GenerationProgress;
  generationJobId: string | null;
  generationJobStatus: string | null;
  generationErrors: string[];
  generationCostEstimates: string[];
  upscaling: boolean;
  upscaleProgress: GenerationProgress;
  upscaleErrors: string[];
  collapsed: boolean;
  onUpscaleSettingsChange: (settings: { enabled: boolean; model: string; targetLongEdge: number }) => void;
  onBackgroundSelected: (selection: {
    selectedBgIndex: number;
    bgWidth: number;
    bgHeight: number;
    sections: LevelSection[];
  }) => void;
}

function upsertBackground(
  session: SessionResponse,
  background: SessionResponse['backgrounds'][number],
): SessionResponse {
  const byIndex = new Map(session.backgrounds.map((bg) => [bg.index, bg]));
  byIndex.set(background.index, background);
  return {
    ...session,
    backgrounds: [...byIndex.values()].sort((a, b) => a.index - b.index),
  };
}

export default function StepBackgrounds({
  sessionId,
  config,
  upscaleEnabled,
  upscaleModel,
  upscaleTargetLongEdge,
  generating,
  generationProgress,
  generationJobId,
  generationJobStatus,
  generationErrors,
  generationCostEstimates,
  upscaling,
  upscaleProgress,
  upscaleErrors,
  collapsed,
  onUpscaleSettingsChange,
  onBackgroundSelected,
}: Props) {
  const queryClient = useQueryClient();
  const { data: session } = useSessionQuery(sessionId);
  const [forceOpen, setForceOpen] = useState(false);
  const upscaleModels = config.upscaleModels ?? [];
  const effectiveUpscaleModel = upscaleModels.some((m) => m.id === upscaleModel)
    ? upscaleModel
    : upscaleModels[0]?.id ?? upscaleModel;
  const [manualUpscaling, setManualUpscaling] = useState(false);
  const [upscaleError, setUpscaleError] = useState<string | null>(null);
  const sessionRef = useRef<SessionResponse | undefined>(session);
  const manualSeqRef = useRef(0);
  const manualAbortRef = useRef<AbortController | null>(null);
  const selectSeqRef = useRef(0);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => () => {
    manualSeqRef.current += 1;
    selectSeqRef.current += 1;
    manualAbortRef.current?.abort();
    manualAbortRef.current = null;
  }, []);

  useEffect(() => {
    manualSeqRef.current += 1;
    selectSeqRef.current += 1;
    manualAbortRef.current?.abort();
    manualAbortRef.current = null;
    setManualUpscaling(false);
    setUpscaleError(null);
  }, [sessionId]);

  const handleSelectBg = useCallback(
    async (bgIndex: number) => {
      if (!sessionId) return;
      const sourceSessionId = sessionId;
      const requestSeq = selectSeqRef.current + 1;
      selectSeqRef.current = requestSeq;
      const { bgWidth, bgHeight, sections } = await selectBackground(sourceSessionId, bgIndex);
      if (
        selectSeqRef.current !== requestSeq ||
        sessionRef.current?.id !== sourceSessionId
      ) {
        return;
      }
      queryClient.setQueryData<SessionResponse>(sessionQueryKey(sourceSessionId), (current) => {
        if (!current) return current;
        return {
          ...current,
          selectedBgIndex: bgIndex,
          bgWidth,
          bgHeight,
          sections,
          hitboxes: [],
          dogs: [],
          maskParams: { radial: 0, feather: 0 },
          exported: false,
          catalogUploaded: false,
          catalogListable: false,
          catalogTombstoned: false,
          bundledInApp: false,
        };
      });
      onBackgroundSelected({ selectedBgIndex: bgIndex, bgWidth, bgHeight, sections });
      setForceOpen(false);
    },
    [onBackgroundSelected, queryClient, sessionId],
  );

  const handleUpscaleSelected = useCallback(async () => {
    if (!sessionId || session?.selectedBgIndex === null || session?.selectedBgIndex === undefined) return;
    const sourceSessionId = sessionId;
    const sourceBgIndex = session.selectedBgIndex;
    const requestSeq = manualSeqRef.current + 1;
    manualSeqRef.current = requestSeq;
    manualAbortRef.current?.abort();
    const controller = new AbortController();
    manualAbortRef.current = controller;
    setManualUpscaling(true);
    setUpscaleError(null);
    try {
      const result = await upscaleBackground(
        sourceSessionId,
        sourceBgIndex,
        effectiveUpscaleModel,
        upscaleTargetLongEdge,
        false,
        controller.signal,
      );
      if (manualSeqRef.current !== requestSeq) return;
      const current = sessionRef.current;
      if (current?.id !== sourceSessionId) return;
      queryClient.setQueryData<SessionResponse>(sessionQueryKey(sourceSessionId), (cached) =>
        cached ? upsertBackground(cached, result.background) : cached,
      );

      if (
        current.selectedBgIndex === sourceBgIndex &&
        current.hitboxes.length === 0 &&
        !generating
      ) {
        const selectionSeq = selectSeqRef.current + 1;
        selectSeqRef.current = selectionSeq;
        const selection = await selectBackground(sourceSessionId, result.background.index);
        const latest = sessionRef.current;
        if (
          manualSeqRef.current !== requestSeq ||
          selectSeqRef.current !== selectionSeq ||
          latest?.id !== sourceSessionId ||
          latest.selectedBgIndex !== sourceBgIndex ||
          latest.hitboxes.length > 0 ||
          generating
        ) {
          return;
        }
        queryClient.setQueryData<SessionResponse>(sessionQueryKey(sourceSessionId), (cached) => {
          if (!cached) return cached;
          return {
            ...upsertBackground(cached, result.background),
            selectedBgIndex: result.background.index,
            bgWidth: selection.bgWidth,
            bgHeight: selection.bgHeight,
            sections: selection.sections,
            hitboxes: [],
            dogs: [],
            maskParams: { radial: 0, feather: 0 },
            exported: false,
            catalogUploaded: false,
            catalogListable: false,
            catalogTombstoned: false,
            bundledInApp: false,
          };
        });
        onBackgroundSelected({
          selectedBgIndex: result.background.index,
          bgWidth: selection.bgWidth,
          bgHeight: selection.bgHeight,
          sections: selection.sections,
        });
      }
    } catch (err) {
      if (
        manualSeqRef.current !== requestSeq ||
        sessionRef.current?.id !== sourceSessionId ||
        controller.signal.aborted ||
        isAbortError(err)
      ) {
        return;
      }
      const detail = (err as { detail?: { detail?: { error?: string } } }).detail?.detail?.error;
      setUpscaleError(detail ?? (err as Error).message ?? 'Background upscale failed');
    } finally {
      if (manualSeqRef.current === requestSeq) {
        setManualUpscaling(false);
        if (manualAbortRef.current === controller) {
          manualAbortRef.current = null;
        }
      }
    }
  }, [effectiveUpscaleModel, generating, onBackgroundSelected, queryClient, session, sessionId, upscaleTargetLongEdge]);

  const isCollapsed = collapsed && !forceOpen;

  const selectedBgUrl =
    sessionId && session?.selectedBgIndex !== null && session?.selectedBgIndex !== undefined
      ? bgFullUrl(sessionId, session.selectedBgIndex)
      : null;
  const selectedBg = session?.backgrounds.find((bg) => bg.index === session.selectedBgIndex);
  const selectedLongEdge = selectedBg ? Math.max(selectedBg.width ?? session?.bgWidth ?? 0, selectedBg.height ?? session?.bgHeight ?? 0) : 0;
  const canUpscale =
    sessionId !== null &&
    session?.selectedBgIndex !== null &&
    session?.selectedBgIndex !== undefined &&
    upscaleModels.length > 0 &&
    (session?.hitboxes.length ?? 0) === 0 &&
    !generating &&
    !upscaling &&
    selectedLongEdge < upscaleTargetLongEdge;
  const busyUpscaling = upscaling || manualUpscaling;

  return (
    <div className={`step ${isCollapsed ? 'collapsed' : ''}`}>
      <StepHeader
        stepNumber={2}
        title="Pick Background"
        collapsed={isCollapsed}
        onToggle={collapsed ? () => setForceOpen(!forceOpen) : undefined}
        summary={session?.selectedBgIndex !== null && session?.selectedBgIndex !== undefined ? `Background #${session.selectedBgIndex} selected` : undefined}
      />

      {isCollapsed && selectedBgUrl && (
        <div className="step-collapsed-preview">
          <img src={selectedBgUrl} alt="Selected background" className="collapsed-bg-thumb" />
          <button className="btn btn-link" onClick={() => setForceOpen(true)}>
            Change
          </button>
        </div>
      )}

      {!isCollapsed && (
        <div className="step-content">
          {generating && (
            <div className="generation-status">
              <span className="loading-spinner small" />
              <span className="generation-badge">
                {generationProgress.succeeded}/{generationProgress.total} ready
                {generationProgress.failed > 0 && (
                  <span className="generation-warning"> ({generationProgress.failed} failed)</span>
                )}
              </span>
              {generationJobId && (
                <span className="generation-badge" title="Durable server job. Safe to reload; the stream replays persisted job events.">
                  job {generationJobStatus ?? 'queued'} · {generationJobId}
                </span>
              )}
            </div>
          )}

          {upscaling && (
            <div className="generation-status">
              <span className="loading-spinner small" />
              <span className="generation-badge">
                Upscaling {upscaleProgress.succeeded}/{upscaleProgress.total} ready
                {upscaleProgress.failed > 0 && (
                  <span className="generation-warning"> ({upscaleProgress.failed} failed)</span>
                )}
              </span>
            </div>
          )}

          {generationErrors.length > 0 && (
            <div style={{
              background: '#2a1010',
              border: '1px solid #7a1f1f',
              borderRadius: 6,
              padding: '10px 12px',
              margin: '8px 0 12px',
              color: '#ffb4b4',
              fontSize: '0.85rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              <strong style={{ color: '#ff8080' }}>Background generation errors:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {generationErrors.map((msg, i) => (
                  <li key={i} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{msg}</li>
                ))}
              </ul>
            </div>
          )}

          {generationCostEstimates.length > 0 && (
            <div className="generation-cost-notes">
              {generationCostEstimates.map((msg) => (
                <div key={msg}>{msg}</div>
              ))}
            </div>
          )}

          {(session?.backgrounds.length ?? 0) > 0 && (
            <div className="upscale-panel">
              <div className="upscale-controls">
                <div className="form-group">
                  <label>Background Upscale</label>
                  <select
                    value={upscaleModel}
                    onChange={(e) => onUpscaleSettingsChange({
                      enabled: upscaleEnabled,
                      model: e.target.value,
                      targetLongEdge: upscaleTargetLongEdge,
                    })}
                    disabled={busyUpscaling || sessionId !== null || upscaleModels.length === 0}
                  >
                    {upscaleModels.length > 0 ? (
                      upscaleModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))
                    ) : (
                      <option value="">FAL_KEY missing</option>
                    )}
                  </select>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={handleUpscaleSelected}
                  disabled={!canUpscale || busyUpscaling}
                  title={
                    (session?.hitboxes.length ?? 0) > 0
                      ? 'Upscale before placing hitboxes so coordinates stay clean.'
                      : selectedLongEdge >= upscaleTargetLongEdge
                        ? 'Selected background is already 4K or larger.'
                        : 'Create a new 4K background candidate from the selected image.'
                  }
                >
                  {manualUpscaling ? (
                    <>
                      <span className="loading-spinner small" />
                      Upscaling...
                    </>
                  ) : (
                    `Upscale selected to ${Math.round(upscaleTargetLongEdge / 1000)}K`
                  )}
                </button>
              </div>
              <div className="upscale-hint">
                {upscaleEnabled
                  ? `Auto-upscale is on: generated candidates below ${upscaleTargetLongEdge}px are duplicated as 4K upscaled options. Last ESRGAN run was about $0.02 each.`
                  : 'Creates a new background candidate and selects it. Original images stay in the grid for comparison.'}
              </div>
              {upscaleError && <div className="upscale-error">{upscaleError}</div>}
              {upscaleErrors.length > 0 && (
                <div className="upscale-error">
                  {upscaleErrors.map((msg) => <div key={msg}>{msg}</div>)}
                </div>
              )}
            </div>
          )}

          <div className="bg-grid">
            {(session?.backgrounds ?? [])
              .sort((a, b) => a.index - b.index)
              .map((bg) => {
                const selectable = bg.selectable !== false;
                const cost =
                  bg.actualCreativeUnits !== null && bg.actualCreativeUnits !== undefined
                    ? `${bg.actualCreativeUnits.toFixed(4)} CU`
                    : bg.estimatedCreativeUnits !== null && bg.estimatedCreativeUnits !== undefined
                      ? `est ${bg.estimatedCreativeUnits.toFixed(4)} CU`
                      : null;
                return (
                <button
                  key={bg.index}
                  className={`bg-card ${session?.selectedBgIndex === bg.index ? 'bg-card-selected' : ''} ${!selectable ? 'bg-card-disabled' : ''}`}
                  onClick={() => selectable && handleSelectBg(bg.index)}
                  disabled={busyUpscaling || !selectable}
                >
                  <img
                    src={sessionId ? bgFullUrl(sessionId, bg.index) : ''}
                    alt={`Background ${bg.index}`}
                    className="bg-thumb"
                  />
                  <span className="bg-meta">
                    {bg.kind === 'upscaled' ? 'upscaled' : `${bg.generationTime}s`}
                    {bg.width && bg.height ? ` · ${bg.width}x${bg.height}` : ''}
                  </span>
                  {(bg.provider || cost || bg.status) && (
                    <span className="bg-provider-meta">
                      {[bg.provider, bg.status, cost].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
