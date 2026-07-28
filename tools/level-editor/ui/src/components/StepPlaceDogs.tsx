import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ConfigResponse, HiddennessLevel, Hitbox, SessionResponse } from '../types';
import {
  autoPlaceHitboxes,
  checkMobileVisibility,
  getSession,
  type AutoPlaceHitboxesResponse,
  type VisibilityIssue,
} from '../api/editorApi';
import type { InpaintMode } from '../api/editorApi';
import type { InpaintStreamControls } from '../api/useInpaintStream';
import DogsCanvas from './DogsCanvas';
import { useQueryClient } from '@tanstack/react-query';
import { sessionQueryKey } from '../api/useSessionQuery';
import StepHeader from './StepHeader';
import { getInpaintModels } from '../lib/modelOptions';
import { HIDDENNESS_PROMPTS, backgroundStylePrompt, effectiveInpaintPrompt, settingContextPrompt } from '../lib/inpaintPrompt';
import { blockingVisibilitySummaries, summarizeVisibilityIssues, visibilitySummaryLabel } from '../lib/visibilityWarnings';

interface Props {
  sessionId: string | null;
  config: ConfigResponse | null;
  style: string | null;
  setting: string | null;
  scene: string | null;
  entity: string | null;
  dogPrompt: string;
  includeStyleInInpaintPrompt: boolean;
  hiddennessLevel: HiddennessLevel;
  hardHiddenPercent: number;
  inpaintPadding: number;
  inpaintModel: string;
  radius: number;
  showOverlay: boolean;
  hitboxes: Hitbox[];
  inpainting: boolean;
  inpaintProgress: {
    done: number;
    total: number;
  };
  collapsed: boolean;
  inpaintStream: InpaintStreamControls;
  onRadiusChange: (radius: number) => void;
  onIncludeStyleInInpaintPromptChange: (include: boolean) => void;
  onHiddennessLevelChange: (level: HiddennessLevel) => void;
  onHardHiddenPercentChange: (percent: number) => void;
  onInpaintPaddingChange: (padding: number) => void;
  onInpaintModelChange: (model: string) => void;
  onToggleOverlay: () => void;
}

type SmartPlacement = NonNullable<AutoPlaceHitboxesResponse['placements']>[number];

type InpaintApproach = {
  id: InpaintMode;
  label: string;
  meta: string;
  description: string;
};

const INPAINT_APPROACHES: InpaintApproach[] = [
  {
    id: 'crop',
    label: 'Crop only',
    meta: 'N masked calls',
    description: 'Fastest controlled path. Sends only each padded hitbox crop and keeps per-entity variants.',
  },
  {
    id: 'crop_reference',
    label: 'Full ref + crop',
    meta: 'N reference calls',
    description: 'Sends the full scene as context beside each crop, then extracts the edited crop back into the level.',
  },
  {
    id: 'magenta',
    label: 'Magenta full scene',
    meta: '1 scene call',
    description: 'Paints all targets magenta in one full-scene edit. Better global coherence, no per-entity variants.',
  },
];

function hitboxSignature(hitboxes: Hitbox[]): string {
  return hitboxes.map((hitbox) => `${hitbox.x}:${hitbox.y}:${hitbox.r}`).join('|');
}

function formatPlacementScore(score: number): string {
  return Number.isFinite(score) ? String(Math.round(score)) : 'n/a';
}

export default function StepPlaceDogs({
  sessionId,
  config,
  style,
  setting,
  scene,
  entity,
  dogPrompt,
  includeStyleInInpaintPrompt,
  hiddennessLevel,
  hardHiddenPercent,
  inpaintPadding,
  inpaintModel,
  radius,
  showOverlay,
  hitboxes,
  inpainting,
  inpaintProgress,
  collapsed,
  inpaintStream,
  onRadiusChange,
  onIncludeStyleInInpaintPromptChange,
  onHiddennessLevelChange,
  onHardHiddenPercentChange,
  onInpaintPaddingChange,
  onInpaintModelChange,
  onToggleOverlay,
}: Props) {
  const queryClient = useQueryClient();
  const [forceOpen, setForceOpen] = useState(false);
  const isCollapsed = collapsed && !forceOpen;
  const { start: startInpaint } = inpaintStream;
  const entitySlug = entity ?? 'dog';
  const entityLabel = entitySlug.replace(/_/g, ' ');
  const entityPlural = entityLabel === 'teddy bear' ? 'teddy bears' : `${entityLabel}s`;
  const promptState = { config, style, setting, scene, dogPrompt, includeStyleInInpaintPrompt, hiddennessLevel };
  const stylePrompt = backgroundStylePrompt(promptState);
  const settingPrompt = settingContextPrompt(promptState);
  const styleLabel = style?.replace(/_/g, ' ') ?? 'selected style';
  const inpaintPrompt = effectiveInpaintPrompt(promptState);
  const hardMixPrompt = hiddennessLevel === 'easy'
    ? effectiveInpaintPrompt(promptState, 'hard')
    : '';


  // Placement persistence now lives ENTIRELY in DogsCanvas (reconcile-by-id,
  // optimistic cache, tombstone-safe). This step's old LevelCanvas + its
  // debounced full-array reducer save — the legacy auto-POST that re-asserted
  // stale arrays (twin-store seam, ledger 054) — are deleted (D-phase slice 1).
  const handleRadiusChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onRadiusChange(parseInt(e.target.value) || 75);
    },
    [onRadiusChange],
  );

  const [autoPlaceN, setAutoPlaceN] = useState(30);
  const [autoPlacing, setAutoPlacing] = useState(false);
  const [smartPlacing, setSmartPlacing] = useState(false);
  const [smartPlacementError, setSmartPlacementError] = useState<string | null>(null);
  const [smartPlacements, setSmartPlacements] = useState<SmartPlacement[] | null>(null);
  const smartPlacementHitboxSignatureRef = useRef<string | null>(null);
  const [visibilityIssues, setVisibilityIssues] = useState<VisibilityIssue[]>([]);
  const [inpaintMode, setInpaintMode] = useState<InpaintMode>(() => {
    const saved = localStorage.getItem('ftd.inpaintMode');
    return saved === 'magenta' || saved === 'crop_reference' ? saved : 'crop';
  });
  const inpaintModels = getInpaintModels(config);
  const visibleInpaintModels = inpaintMode !== 'crop'
    ? inpaintModels.filter((m) => !m.id.startsWith('fal-ai/'))
    : inpaintModels;
  const selectedInpaintModel = visibleInpaintModels.some((m) => m.id === inpaintModel)
    ? inpaintModel
    : visibleInpaintModels[0]?.id || '';

  useEffect(() => {
    localStorage.setItem('ftd.inpaintMode', inpaintMode);
  }, [inpaintMode]);

  useEffect(() => {
    if (!sessionId || hitboxes.length === 0) {
      setVisibilityIssues([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkMobileVisibility(sessionId)
        .then((report) => {
          if (!cancelled) setVisibilityIssues(report.issues);
        })
        .catch(() => {
          if (!cancelled) setVisibilityIssues([]);
        });
    }, 650);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hitboxes, sessionId]);

  useEffect(() => {
    if (visibleInpaintModels.length === 0) return;
    if (!visibleInpaintModels.some((m) => m.id === inpaintModel)) {
      onInpaintModelChange(visibleInpaintModels[0].id);
    }
  }, [inpaintModel, onInpaintModelChange, visibleInpaintModels]);

  const handleInpaintAll = useCallback(async () => {
    if (!sessionId) return;
    // Placement now persists through DogsCanvas (query cache), so the reducer
    // array can be stale here — and startInpaint SENDS hitboxes in the request.
    // Fetch server truth immediately before the PAID run (ledger 054 D-slice).
    const fresh = await getSession(sessionId);
    if (fresh.hitboxes.length === 0) return;
    startInpaint(
      sessionId,
      fresh.hitboxes,
      inpaintPrompt,
      inpaintMode,
      '',
      selectedInpaintModel,
      inpaintMode === 'magenta' ? '' : hardMixPrompt,
      hardHiddenPercent,
      inpaintPadding,
    );
  }, [hardHiddenPercent, hardMixPrompt, inpaintMode, inpaintPadding, inpaintPrompt, selectedInpaintModel, sessionId, startInpaint]);

  const visibilitySummaries = useMemo(() => summarizeVisibilityIssues(visibilityIssues), [visibilityIssues]);
  const blockerCount = blockingVisibilitySummaries(visibilitySummaries).length;
  const currentHitboxSignature = useMemo(() => hitboxSignature(hitboxes), [hitboxes]);

  const clearSmartPlacements = useCallback(() => {
    smartPlacementHitboxSignatureRef.current = null;
    setSmartPlacements(null);
  }, []);

  useEffect(() => {
    if (smartPlacements === null) return;
    if (smartPlacementHitboxSignatureRef.current === currentHitboxSignature) return;
    clearSmartPlacements();
  }, [clearSmartPlacements, currentHitboxSignature, smartPlacements]);

  const handleAutoPlace = useCallback(async () => {
    if (!sessionId) return;
    setSmartPlacementError(null);
    clearSmartPlacements();
    setAutoPlacing(true);
    try {
      // Fresh nonce per click so repeated presses produce different layouts.
      const nonce = Date.now();
      const response = await autoPlaceHitboxes(sessionId, autoPlaceN, nonce, radius, 'random');
      queryClient.setQueryData<SessionResponse | undefined>(sessionQueryKey(sessionId), (current) => (
        current ? { ...current, hitboxes: response.hitboxes } : current
      ));
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionId) });
    } finally {
      setAutoPlacing(false);
    }
  }, [autoPlaceN, clearSmartPlacements, queryClient, radius, sessionId]);

  const handleSmartAutoPlace = useCallback(async () => {
    if (!sessionId) return;
    setSmartPlacementError(null);
    clearSmartPlacements();
    setSmartPlacing(true);
    try {
      const nonce = Date.now();
      const response = await autoPlaceHitboxes(sessionId, autoPlaceN, nonce, radius, 'smart');
      smartPlacementHitboxSignatureRef.current = hitboxSignature(response.hitboxes);
      setSmartPlacements(response.placements ?? []);
      queryClient.setQueryData<SessionResponse | undefined>(sessionQueryKey(sessionId), (current) => (
        current ? { ...current, hitboxes: response.hitboxes } : current
      ));
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionId) });
    } catch (err) {
      const detail = (err as { detail?: { detail?: { error?: string } } }).detail?.detail?.error;
      setSmartPlacementError(detail ?? (err instanceof Error ? err.message : String(err)));
    } finally {
      setSmartPlacing(false);
    }
  }, [autoPlaceN, clearSmartPlacements, queryClient, radius, sessionId]);

  return (
    <div className={`step ${isCollapsed ? 'collapsed' : ''}`}>
      <StepHeader
        stepNumber={3}
        title="Place Dogs"
        collapsed={isCollapsed}
        onToggle={collapsed ? () => setForceOpen(!forceOpen) : undefined}
        summary={`${hitboxes.length} dogs placed`}
      />

      {!isCollapsed && <div className="step-content">
        <div className="placement-controls placement-controls-modern">
          <div className="placement-control-group">
            <label>
              Radius: <strong>{radius}px</strong>
            </label>
            <input
              type="range"
              min={20}
              max={120}
              value={radius}
              onChange={handleRadiusChange}
              className="radius-slider"
            />
          </div>

          <div className="placement-control-group">
            <div className="placement-stats">
              <span className="stat-value">{hitboxes.length}</span>
              <span className="stat-label">entities placed</span>
            </div>
          </div>

          <div className="placement-control-group">
            <label className="toolbar-toggle">
              <input
                type="checkbox"
                checked={showOverlay}
                onChange={onToggleOverlay}
              />
              <span>Overlay</span>
            </label>
          </div>
        </div>

        <div className="recipe-console">
          <div className="recipe-console-header">
            <div>
              <span className="section-kicker">Inpaint Recipe</span>
              <h3>Approach and prompt controls</h3>
            </div>
            <div className="recipe-chip-row" aria-label="Current recipe">
              <span className="recipe-chip">{entityLabel}</span>
              <span className="recipe-chip">{hiddennessLevel}</span>
              <span className="recipe-chip">{inpaintPadding.toFixed(1)}x pad</span>
            </div>
          </div>

          <div className="approach-grid" role="radiogroup" aria-label="Inpaint approach">
            {INPAINT_APPROACHES.map((approach) => (
              <button
                key={approach.id}
                type="button"
                className={`approach-card ${inpaintMode === approach.id ? 'selected' : ''}`}
                onClick={() => setInpaintMode(approach.id)}
                disabled={inpainting}
                role="radio"
                aria-checked={inpaintMode === approach.id}
                data-testid={`inpaint-mode-${approach.id}`}
              >
                <span className="approach-card-topline">
                  <span className="approach-card-title">{approach.label}</span>
                  <span className="approach-card-meta">{approach.meta}</span>
                </span>
                <span className="approach-card-copy">{approach.description}</span>
              </button>
            ))}
          </div>

          <div className="recipe-controls-grid">
            <label className="recipe-field">
              <span>Model</span>
              <select
                value={selectedInpaintModel}
                onChange={(e) => onInpaintModelChange(e.target.value)}
                disabled={inpainting || visibleInpaintModels.length === 0}
                className="inline-select"
                title="Model used by the inpaint step. Crop-only supports Gemini, OpenAI, and fal; reference-crop and magenta use image-edit models only."
              >
                {visibleInpaintModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>

            <label className="recipe-field">
              <span>Hiddenness</span>
              <select
                value={hiddennessLevel}
                onChange={(e) => onHiddennessLevelChange(e.target.value as HiddennessLevel)}
                disabled={inpainting}
                className="inline-select"
                title={HIDDENNESS_PROMPTS[hiddennessLevel]}
              >
                <option value="easy">Easy - mixed hard</option>
                <option value="hard">Hard - deeply hidden</option>
              </select>
            </label>

            <label className="recipe-field recipe-field-wide">
              <span>Inpaint padding <strong>{inpaintPadding.toFixed(1)}x</strong></span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.25}
                value={inpaintPadding}
                onChange={(e) => onInpaintPaddingChange(parseFloat(e.target.value) || 2.75)}
                disabled={inpainting || inpaintMode === 'magenta'}
                className="radius-slider"
              />
            </label>
          </div>

          {hiddennessLevel === 'easy' && inpaintMode !== 'magenta' && (
            <label className="recipe-field recipe-range-row">
              <span>Hard-hidden mix <strong>{hardHiddenPercent}%</strong></span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={hardHiddenPercent}
                onChange={(e) => onHardHiddenPercentChange(parseInt(e.target.value, 10) || 0)}
                disabled={inpainting}
                className="radius-slider"
              />
            </label>
          )}

          <label className="toolbar-toggle recipe-style-toggle">
            <input
              type="checkbox"
              checked={includeStyleInInpaintPrompt}
              onChange={(e) => onIncludeStyleInInpaintPromptChange(e.target.checked)}
              disabled={!stylePrompt || inpainting}
            />
            <span>
              Include style context
              {stylePrompt && <span className="muted-inline"> ({styleLabel})</span>}
            </span>
          </label>
          <div className="recipe-note">
            {inpaintMode === 'crop_reference'
              ? 'Full reference + crop uses each crop as the editable panel and the full scene as visual context.'
              : inpaintMode === 'magenta'
                ? 'Magenta mode ignores crop padding and creates one full-scene edit for all targets.'
                : 'Crop mode sends only the padded crop for each target and keeps the most predictable variant workflow.'}
            {includeStyleInInpaintPrompt && stylePrompt ? ' Style text is appended to the inpaint prompt.' : ''}
            {settingPrompt ? ' Setting context is appended automatically.' : ''}
          </div>
        </div>

        {/* The validated B2 surface replaces this step's own canvas (D-phase
            slice 1): by-id selection/drag/delete, variant rail, paid regen —
            one save path for the whole editor. */}
        <DogsCanvas sessionId={sessionId} />

        {visibilitySummaries.length > 0 && (
          <div style={{
            alignSelf: 'center',
            width: 'min(720px, 100%)',
            background: blockerCount > 0 ? '#2a1111' : '#2a210d',
            border: `1px solid ${blockerCount > 0 ? '#7a3232' : '#7a5a1d'}`,
            borderRadius: 8,
            padding: '10px 12px',
            color: '#ffd98a',
            fontSize: '0.82rem',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 5 }}>
              {blockerCount > 0
                ? `${blockerCount} hitbox${blockerCount === 1 ? '' : 'es'} touching danger zones before inpaint`
                : `${visibilitySummaries.length} hitbox${visibilitySummaries.length === 1 ? '' : 'es'} near mobile border`}
            </div>
            {visibilitySummaries.slice(0, 5).map((summary) => (
              <div key={summary.dogId} style={{ marginBottom: 2 }}>
                {visibilitySummaryLabel(summary)}
              </div>
            ))}
            {visibilitySummaries.length > 5 && (
              <div style={{ color: '#caa866' }}>...and {visibilitySummaries.length - 5} more</div>
            )}
          </div>
        )}

        {smartPlacementError && (
          <div style={{
            alignSelf: 'center',
            width: 'min(720px, 100%)',
            background: '#2b1a1a',
            color: '#ffd9d9',
            border: '1px solid #c54040',
            borderRadius: 6,
            padding: '10px 12px',
            marginTop: 12,
            fontSize: 13,
            wordBreak: 'break-word',
          }}>
            <strong>Smart auto-place failed:</strong> {smartPlacementError}
          </div>
        )}

        {smartPlacements !== null && (
          <div style={{
            alignSelf: 'center',
            width: 'min(720px, 100%)',
            background: '#162032',
            color: '#dbe8ff',
            border: '1px solid #385170',
            borderRadius: 6,
            padding: '10px 12px',
            marginTop: 12,
            fontSize: 13,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Smart placement reasoning</div>
            {smartPlacements.length > 0 ? (
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {smartPlacements.map((placement, index) => (
                  <li
                    key={`${placement.candidateId}-${index}`}
                    title={`Candidate ${placement.candidateId} - ${placement.source}`}
                    style={{ marginBottom: index === smartPlacements.length - 1 ? 0 : 4 }}
                  >
                    <strong>Score {formatPlacementScore(placement.score)}:</strong>{' '}
                    {placement.reason || 'No reason returned.'}
                  </li>
                ))}
              </ol>
            ) : (
              <div style={{ color: '#a9bdd8' }}>Smart auto-place returned no placement reasons.</div>
            )}
          </div>
        )}

        <div className="action-strip">
          <label className="action-strip-field">
            N=
            <input
              type="number"
              min={1}
              max={40}
              value={autoPlaceN}
              onChange={(e) => setAutoPlaceN(Math.min(40, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ width: 56 }}
              disabled={autoPlacing || smartPlacing}
            />
          </label>
          <button
            className="btn"
            onClick={handleAutoPlace}
            disabled={!sessionId || inpainting || autoPlacing || smartPlacing}
            title="Auto-place N hitboxes with spacing that keeps padded inpaint crops from overlapping. Click again for a new layout."
          >
            {autoPlacing ? 'Placing…' : 'Auto-place'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleSmartAutoPlace}
            disabled={!sessionId || inpainting || autoPlacing || smartPlacing}
            title="Ask vision to score numbered candidate crops, then pick geometry-safe spots. Best for avoiding walls, sky, and impossible placements."
          >
            {smartPlacing ? 'Thinking…' : 'Smart auto-place'}
          </button>
          <button
            className="btn btn-primary btn-large"
            onClick={handleInpaintAll}
            disabled={inpainting || hitboxes.length === 0}
          >
            {inpainting
              ? `Inpainting... (${inpaintProgress.done}/${inpaintProgress.total})`
              : `Inpaint All ${entityPlural} (${hitboxes.length})`}
          </button>
        </div>
      </div>}
    </div>
  );
}
