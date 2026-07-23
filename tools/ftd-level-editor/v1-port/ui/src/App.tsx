import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConfigResponse, HiddennessLevel, Orientation, SessionResponse } from './types';
import { getConfig, getGenerationStatus, getSession } from './api/editorApi';
import { sessionQueryKey, useSessionQuery } from './api/useSessionQuery';
import { useBgStream } from './api/useBgStream';
import { useInpaintStream } from './api/useInpaintStream';
import { useBandGenStream } from './api/useBandGenStream';
import ApiErrorToast from './components/ApiErrorToast';
import AnimationLibraryPage from './components/AnimationLibraryPage';
import GalleryPage from './components/GalleryPage';
import SequencePage from './components/SequencePage';
import StepConfigure from './components/StepConfigure';
import StepBackgrounds from './components/StepBackgrounds';
import StepPlaceDogs from './components/StepPlaceDogs';
import StepInpaint from './components/StepInpaint';
import StepBandGeneration from './components/StepBandGeneration';
import StepHeader from './components/StepHeader';
import PromptsPage from './components/PromptsPage';
import { getInpaintModels } from './lib/modelOptions';

const DEFAULT_HITBOX_RADIUS = 50;
const DEFAULT_INPAINT_PADDING = 2.75;
const LS_HITBOX_RADIUS_KEY = 'ftd-builder-hitbox-radius-v2';

function loadHitboxRadius(): number {
  try {
    const parsed = Number(localStorage.getItem(LS_HITBOX_RADIUS_KEY));
    return Number.isFinite(parsed) && parsed >= 10 && parsed <= 200 ? parsed : DEFAULT_HITBOX_RADIUS;
  } catch {
    return DEFAULT_HITBOX_RADIUS;
  }
}

function defaultInpaintModel(config: ConfigResponse | null): string {
  const inpaintModels = getInpaintModels(config);
  return inpaintModels[0]?.id || config?.models[0]?.id || '';
}

function resolveInpaintModel(config: ConfigResponse | null, candidate: string | null | undefined): string {
  const inpaintModels = getInpaintModels(config);
  if (candidate && (inpaintModels.length === 0 || inpaintModels.some((model) => model.id === candidate))) {
    return candidate;
  }
  return defaultInpaintModel(config);
}

function defaultUpscaleModel(config: ConfigResponse | null): string {
  return config?.upscaleModels?.[0]?.id ?? 'fal-ai/esrgan';
}

function getSessionIdFromHash(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/session=([^&]+)/);
  return match ? match[1] : null;
}

type Tab = 'wizard' | 'gallery' | 'animations' | 'lineup' | 'prompts';

function normalizeRestoredDogs(dogs: SessionResponse['dogs']): SessionResponse['dogs'] {
  return dogs.map((dog) => {
    const status = (dog as { status: string }).status;
    if (status !== 'orphaned') return dog;
    return {
      ...dog,
      status: 'error',
      error: dog.error ?? 'stream disconnected before this dog finished; retry inpaint',
    };
  });
}

function getTabFromHash(): Tab {
  const h = window.location.hash;
  // Historical multi-scene bookmarks land on Wizard; multi-scene generation
  // belongs to the Wizard recipe flow, not a separate surface.
  if (h.startsWith('#batch')) return 'wizard';
  if (h.startsWith('#gallery')) return 'gallery';
  if (h.startsWith('#animations')) return 'animations';
  // Historical game/sequence bookmarks land on Lineup after navigation collapse.
  if (h.startsWith('#game')) return 'lineup';
  if (h.startsWith('#sequence')) return 'lineup';
  if (h.startsWith('#lineup')) return 'lineup';
  if (h.startsWith('#prompts')) return 'prompts';
  return 'wizard';
}

export default function App() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [configSummary, setConfigSummary] = useState('');
  const [style, setStyle] = useState<string | null>(null);
  const [setting, setSetting] = useState<string | null>(null);
  const [scene, setScene] = useState<string | null>(null);
  const [entity, setEntity] = useState<string | null>(null);
  const [dogPrompt, setDogPrompt] = useState('');
  const [includeStyleInInpaintPrompt, setIncludeStyleInInpaintPrompt] = useState(true);
  const [hiddennessLevel, setHiddennessLevel] = useState<HiddennessLevel>('easy');
  const [hardHiddenPercent, setHardHiddenPercent] = useState(30);
  const [inpaintPadding, setInpaintPadding] = useState(DEFAULT_INPAINT_PADDING);
  const [inpaintModel, setInpaintModel] = useState('');
  const [upscaleEnabled, setUpscaleEnabled] = useState(true);
  const [upscaleModel, setUpscaleModel] = useState('fal-ai/esrgan');
  const [upscaleTargetLongEdge, setUpscaleTargetLongEdge] = useState(3840);
  const [radius, setRadiusState] = useState(loadHitboxRadius);
  const [showOverlay, setShowOverlay] = useState(true);
  const [, setLoadingSession] = useState(false);
  const [tab, setTab] = useState<Tab>(getTabFromHash);

  // SSE streams live here (App root) rather than in the step components so
  // they survive tab switches. If a user kicks off bg gen in the wizard
  // then navigates to Gallery or Lineup, the generation keeps running — a
  // step component holding the EventSource would unmount on tab switch
  // and (via React cleanup or GC + server disconnect) abort the stream.
  const bgStream = useBgStream();
  const inpaintStream = useInpaintStream();
  const bandGenStream = useBandGenStream();
  const { reset: resetBgStream, resume: resumeBgStream, status: bgStatus } = bgStream;
  const { reset: resetInpaintStream, status: inpaintStatus } = inpaintStream;
  const { reset: resetBandGenStream } = bandGenStream;
  const { data: activeSession } = useSessionQuery(currentSessionId);

  const loadedSessionRef = useRef<string | null>(null);
  const restoreSeqRef = useRef(0);
  // Mirror currentSessionId into a ref so the hashchange listener below can
  // short-circuit when Step 1 writes the hash after session creation.
  const currentSessionIdRef = useRef<string | null>(null);
  const lastAcceptedHashRef = useRef(window.location.hash);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  const setRadius = useCallback((nextRadius: number): void => {
    try {
      localStorage.setItem(LS_HITBOX_RADIUS_KEY, String(nextRadius));
    } catch {
      // Ignore private-mode/quota failures; the in-memory radius still updates.
    }
    setRadiusState(nextRadius);
  }, []);

  const applySession = useCallback((session: SessionResponse): void => {
    const normalizedSession: SessionResponse = {
      ...session,
      dogs: normalizeRestoredDogs(session.dogs),
    };
    queryClient.setQueryData<SessionResponse>(sessionQueryKey(session.id), normalizedSession);
    setCurrentSessionId(session.id);
    setOrientation(session.orientation);
    setStyle(session.style);
    setSetting(session.setting ?? null);
    setScene(session.scene ?? null);
    setEntity(session.entity ?? null);
    setDogPrompt(session.dogPrompt);
    setInpaintModel(resolveInpaintModel(config, session.inpaintModel ?? session.model));
    setUpscaleEnabled(Boolean(session.upscaleEnabled));
    setUpscaleModel(session.upscaleModel ?? defaultUpscaleModel(config));
    setUpscaleTargetLongEdge(session.upscaleTargetLongEdge ?? 3840);
  }, [config, queryClient]);

  const resumeBackgroundGenerationIfActive = useCallback((sessionId: string): void => {
    getGenerationStatus()
      .then((status) => {
        const sessionStatus = status.backgrounds.sessions[sessionId];
        const jobId = sessionStatus && typeof sessionStatus.jobId === 'string' ? sessionStatus.jobId : null;
        if (jobId) resumeBgStream(sessionId, jobId);
      })
      .catch((err: unknown) => {
        console.warn('[App] background generation status restore failed', sessionId, err);
      });
  }, [resumeBgStream]);

  const resetWizardSettings = useCallback((): void => {
    setCurrentSessionId(null);
    setOrientation('portrait');
    setConfigSummary('');
    setStyle(null);
    setSetting(null);
    setScene(null);
    setEntity(null);
    setDogPrompt('');
    setIncludeStyleInInpaintPrompt(true);
    setHiddennessLevel('easy');
    setHardHiddenPercent(30);
    setInpaintPadding(DEFAULT_INPAINT_PADDING);
    setInpaintModel(defaultInpaintModel(config));
    setUpscaleEnabled((config?.upscaleModels?.length ?? 0) > 0);
    setUpscaleModel(defaultUpscaleModel(config));
    setUpscaleTargetLongEdge(3840);
    setRadius(loadHitboxRadius());
    setShowOverlay(true);
  }, [config, setRadius]);

  // Unified session-restore: fires on mount AND on hashchange. A ref
  // tracks what we already have loaded so opening the same session
  // twice (or a hashchange that matches the current session) doesn't
  // refetch. Replaces the earlier pair of effects that both fetched on
  // mount for the same hash.
  useEffect(() => {
    const restoreIfNeeded = (nextSessionId: string | null) => {
      lastAcceptedHashRef.current = window.location.hash;
      setTab(getTabFromHash());
      if (!nextSessionId) {
        restoreSeqRef.current += 1;
        return;
      }
      if (loadedSessionRef.current === nextSessionId) return;
      // Same sessionId we already hold → we put it in the hash ourselves
      // (Step 1 / Gallery open). No need to refetch and clobber in-flight
      // generating state.
      if (currentSessionIdRef.current === nextSessionId) {
        loadedSessionRef.current = nextSessionId;
        return;
      }
      resetBgStream();
      resetInpaintStream();
      resetBandGenStream();
      const restoreSeq = restoreSeqRef.current + 1;
      restoreSeqRef.current = restoreSeq;
      loadedSessionRef.current = nextSessionId;
      setLoadingSession(true);
      getSession(nextSessionId)
        .then((session: SessionResponse) => {
          if (
            restoreSeqRef.current !== restoreSeq ||
            loadedSessionRef.current !== nextSessionId ||
            getSessionIdFromHash() !== nextSessionId
          ) {
            return;
          }
          applySession(session);
          resumeBackgroundGenerationIfActive(nextSessionId);
        })
        .catch((err) => {
          if (
            restoreSeqRef.current !== restoreSeq ||
            loadedSessionRef.current !== nextSessionId ||
            getSessionIdFromHash() !== nextSessionId
          ) {
            return;
          }
          console.warn('[App] session restore failed', nextSessionId, err);
          loadedSessionRef.current = null;
          window.location.hash = '';
        })
        .finally(() => {
          if (restoreSeqRef.current === restoreSeq) setLoadingSession(false);
        });
    };
    restoreIfNeeded(getSessionIdFromHash());
    const onHashChange = () => restoreIfNeeded(getSessionIdFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applySession, resetBgStream, resetInpaintStream, resetBandGenStream, resumeBackgroundGenerationIfActive]);

  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);
  const step5Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getConfig().then((nextConfig) => {
      setConfig(nextConfig);
      setInpaintModel((current) => resolveInpaintModel(nextConfig, current));
      setUpscaleModel((current) => (
        nextConfig.upscaleModels?.some((model) => model.id === current)
          ? current
          : defaultUpscaleModel(nextConfig)
      ));
      setUpscaleEnabled((current) => current && (nextConfig.upscaleModels?.length ?? 0) > 0);
    });
  }, [resetBgStream, resetInpaintStream, resetBandGenStream]);

  const handleLoadLevel = useCallback((sessionId: string) => {
    resetBgStream();
    resetInpaintStream();
    resetBandGenStream();
    const restoreSeq = restoreSeqRef.current + 1;
    restoreSeqRef.current = restoreSeq;
    setLoadingSession(true);
    loadedSessionRef.current = sessionId;
    getSession(sessionId)
      .then((session: SessionResponse) => {
        if (restoreSeqRef.current !== restoreSeq || loadedSessionRef.current !== sessionId) return;
        window.location.hash = `session=${sessionId}`;
        applySession(session);
        resumeBackgroundGenerationIfActive(sessionId);
      })
      .catch((err: unknown) => {
        if (restoreSeqRef.current !== restoreSeq) return;
        console.warn('[App] handleLoadLevel failed', sessionId, err);
        loadedSessionRef.current = null;
        const msg = err instanceof Error ? err.message : String(err);
        alert(`Failed to load level: ${msg}`);
      })
      .finally(() => {
        if (restoreSeqRef.current === restoreSeq) setLoadingSession(false);
      });
  }, [applySession, resetBgStream, resetInpaintStream, resetBandGenStream, resumeBackgroundGenerationIfActive]);

  const handleReset = useCallback(() => {
    resetBgStream();
    resetInpaintStream();
    resetBandGenStream();
    restoreSeqRef.current += 1;
    loadedSessionRef.current = null;
    window.location.hash = '';
    resetWizardSettings();
  }, [resetBgStream, resetInpaintStream, resetBandGenStream, resetWizardSettings]);

  const handleConfigureUpscaleSettingsChange = useCallback((settings: {
    enabled: boolean;
    model: string;
    targetLongEdge: number;
  }): void => {
    setUpscaleEnabled(settings.enabled);
    setUpscaleModel(settings.model);
    setUpscaleTargetLongEdge(settings.targetLongEdge);
  }, []);

  const handleConfigureOrientationChange = useCallback((nextOrientation: Orientation): void => {
    resetBgStream();
    resetInpaintStream();
    resetBandGenStream();
    setOrientation(nextOrientation);
    setCurrentSessionId(null);
    setConfigSummary('');
    setStyle(null);
    setSetting(null);
    setScene(null);
    setEntity(null);
    setDogPrompt('');
  }, []);

  const handleConfigureGenerationStart = useCallback((params: { total: number; summary: string }): void => {
    setConfigSummary(params.summary);
  }, []);

  const handleConfigureGenerationCreateFailed = useCallback((): void => {
    // Clear the preemptively-set summary so the collapsed Step 1 header
    // doesn't show a fake session summary when no session was actually created.
    setConfigSummary('');
  }, []);

  const handleConfigureSessionConfigured = useCallback((params: {
    sessionId: string;
    style: string;
    setting: string;
    scene: string;
    entity: string;
    dogPrompt: string;
    inpaintModel: string;
    upscaleEnabled: boolean;
    upscaleModel: string;
    upscaleTargetLongEdge: number;
  }): void => {
    setCurrentSessionId(params.sessionId);
    setStyle(params.style);
    setSetting(params.setting);
    setScene(params.scene);
    setEntity(params.entity);
    setDogPrompt(params.dogPrompt);
    setInpaintModel(params.inpaintModel);
    setUpscaleEnabled(params.upscaleEnabled);
    setUpscaleModel(params.upscaleModel);
    setUpscaleTargetLongEdge(params.upscaleTargetLongEdge);
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey(params.sessionId) });
  }, [queryClient]);

  const handleBackgroundSelected = useCallback((): void => {
    // StepBackgrounds owns the query-cache selection write. App keeps this
    // callback only as a narrow hook for future local UI state.
  }, []);

  // Step visibility rules
  const backgroundCount = activeSession?.backgrounds.length ?? 0;
  const selectedBgIndex = activeSession?.selectedBgIndex ?? null;
  const queryDogs = activeSession?.dogs ? normalizeRestoredDogs(activeSession.dogs) : [];
  const queryHitboxes = activeSession?.hitboxes ?? [];
  const showStep2 = bgStatus.generating || bgStatus.upscaling || backgroundCount > 0;
  const showStep3 = selectedBgIndex !== null && !bgStatus.upscaling;
  const showStep4 = inpaintStatus.inpainting || inpaintStatus.inpaintFailed || queryDogs.some((d) => d.status !== 'pending');
  // "Settled" means a dog has reached a terminal outcome OR has at least one
  // painted variant on disk. A dog that already has variants counts as settled
  // even during regen so the Gallery/Lineup handoff panel does not flicker.
  const showStep5 =
    queryDogs.length > 0 &&
    queryDogs.every(
      (d) =>
        d.status === 'done' ||
        d.status === 'error' ||
        (d.status === 'generating' && d.variants.length > 0),
    );

  // Auto-scroll when steps become visible
  const prevShowRef = useRef({ s2: false, s3: false, s4: false, s5: false });
  useEffect(() => {
    const prev = prevShowRef.current;
    if (showStep2 && !prev.s2) step2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (showStep3 && !prev.s3) step3Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (showStep4 && !prev.s4) step4Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (showStep5 && !prev.s5) step5Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    prevShowRef.current = { s2: showStep2, s3: showStep3, s4: showStep4, s5: showStep5 };
  }, [showStep2, showStep3, showStep4, showStep5]);

  if (!config) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading editor...</p>
      </div>
    );
  }

  const goToTab = (next: Tab) => {
    // Navigate via hash so back button and session links work.
    // Carry the loaded session in the hash so tab navigation and reloads
    // preserve the current level.
    const sid = currentSessionIdRef.current;
    window.location.hash = next === 'wizard'
      ? (sid ? `session=${sid}` : '')
      : (sid ? `${next}&session=${sid}` : next);
    setTab(next);
  };

  const TabNav = ({ active }: { active: Tab }) => (
    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
      <button className={active === 'wizard' ? 'btn btn-primary' : 'btn'} disabled={active === 'wizard'} onClick={() => goToTab('wizard')}>Wizard</button>
      <button className={active === 'gallery' ? 'btn btn-primary' : 'btn'} disabled={active === 'gallery'} onClick={() => goToTab('gallery')}>Gallery</button>
      <button className={active === 'lineup' ? 'btn btn-primary' : 'btn'} disabled={active === 'lineup'} onClick={() => goToTab('lineup')} title="The game lineup: order, bundle boundary, validation, and Start.">Lineup</button>
      <button className={active === 'prompts' ? 'btn btn-primary' : 'btn'} disabled={active === 'prompts'} onClick={() => goToTab('prompts')} title="Central prompt library (versioned)">Prompts</button>
    </div>
  );

  // Render body based on active tab. ApiErrorToast is hoisted out of
  // each branch to a single wrapping fragment below — prior code rendered
  // it 4 times (once per early return), meaning each tab switch tore down
  // the prior toast listener and its transient queue state. With a single
  // mount at the App root, toasts survive tab navigation and the event
  // listener is registered exactly once per session.
  let body: ReactNode;
  if (tab === 'gallery') {
    body = (
      <div className="app">
        <div className="pipeline">
          <div className="pipeline-header">
            <h1>Find the Dog - Level Editor</h1>
            <TabNav active="gallery" />
          </div>
          <GalleryPage config={config} onOpen={handleLoadLevel} />
        </div>
      </div>
    );
  } else if (tab === 'animations') {
    body = (
      <div className="app">
        <div className="pipeline">
          <div className="pipeline-header">
            <h1>Find the Dog - Level Editor</h1>
            <TabNav active="animations" />
          </div>
          <AnimationLibraryPage />
        </div>
      </div>
    );
  } else if (tab === 'lineup') {
    body = (
      <div className="app">
        <div className="pipeline">
          <div className="pipeline-header">
            <h1>Find the Dog - Level Editor</h1>
            <TabNav active="lineup" />
          </div>
          <SequencePage />
        </div>
      </div>
    );
  } else if (tab === 'prompts') {
    body = (
      <div className="app">
        <div className="pipeline">
          <div className="pipeline-header">
            <h1>Find the Dog - Level Editor</h1>
            <div style={{ marginLeft: 'auto' }}>
              <TabNav active="prompts" />
            </div>
          </div>
          <PromptsPage />
        </div>
      </div>
    );
  } else {
    body = (
    <div className="app">
      <div className="pipeline">
        <div className="pipeline-header">
          <h1>Find the Dog - Level Editor</h1>
          {currentSessionId && (
            <span className="pipeline-session">#{currentSessionId}</span>
          )}
          {currentSessionId && (
            <button
              className="btn btn-primary"
              onClick={handleReset}
              title="Reset the wizard to an empty Step 1. This does not delete the current session on disk."
              style={{ marginLeft: 'auto' }}
            >
              New Level
            </button>
          )}
          <div style={{ marginLeft: currentSessionId ? 8 : 'auto' }}>
            <TabNav active="wizard" />
          </div>
        </div>

        <StepConfigure
          config={config}
          orientation={orientation}
          configSummary={configSummary}
          generating={bgStatus.generating}
          generationProgress={bgStatus.generationProgress}
          generationErrors={bgStatus.generationErrors}
          generationJobId={bgStatus.generationJobId}
          generationJobStatus={bgStatus.generationJobStatus}
          upscaling={bgStatus.upscaling}
          upscaleProgress={bgStatus.upscaleProgress}
          collapsed={showStep2}
          bgStream={bgStream}
          onUpscaleSettingsChange={handleConfigureUpscaleSettingsChange}
          onOrientationChange={handleConfigureOrientationChange}
          onGenerationStart={handleConfigureGenerationStart}
          onGenerationCreateFailed={handleConfigureGenerationCreateFailed}
          onSessionOpen={handleLoadLevel}
          onSessionConfigured={handleConfigureSessionConfigured}
        />

        {showStep2 && (
          <div ref={step2Ref}>
            <StepBackgrounds
              sessionId={currentSessionId}
              config={config}
              upscaleEnabled={upscaleEnabled}
              upscaleModel={upscaleModel}
              upscaleTargetLongEdge={upscaleTargetLongEdge}
              generating={bgStatus.generating}
              generationProgress={bgStatus.generationProgress}
              generationJobId={bgStatus.generationJobId}
              generationJobStatus={bgStatus.generationJobStatus}
              generationErrors={bgStatus.generationErrors}
              generationCostEstimates={bgStatus.generationCostEstimates}
              upscaling={bgStatus.upscaling}
              upscaleProgress={bgStatus.upscaleProgress}
              upscaleErrors={bgStatus.upscaleErrors}
              collapsed={showStep3}
              onUpscaleSettingsChange={handleConfigureUpscaleSettingsChange}
              onBackgroundSelected={handleBackgroundSelected}
            />
          </div>
        )}

        {showStep3 && (
          <div ref={step3Ref}>
            <StepPlaceDogs
              sessionId={currentSessionId}
              config={config}
              style={style}
              setting={setting}
              scene={scene}
              entity={entity}
              dogPrompt={dogPrompt}
              includeStyleInInpaintPrompt={includeStyleInInpaintPrompt}
              hiddennessLevel={hiddennessLevel}
              hardHiddenPercent={hardHiddenPercent}
              inpaintPadding={inpaintPadding}
              inpaintModel={inpaintModel}
              radius={radius}
              showOverlay={showOverlay}
              hitboxes={queryHitboxes}
              inpainting={inpaintStatus.inpainting}
              inpaintProgress={inpaintStatus.inpaintProgress}
              collapsed={showStep4}
              inpaintStream={inpaintStream}
              onRadiusChange={setRadius}
              onIncludeStyleInInpaintPromptChange={setIncludeStyleInInpaintPrompt}
              onHiddennessLevelChange={setHiddennessLevel}
              onHardHiddenPercentChange={setHardHiddenPercent}
              onInpaintPaddingChange={setInpaintPadding}
              onInpaintModelChange={setInpaintModel}
              onToggleOverlay={() => setShowOverlay((current) => !current)}
            />
          </div>
        )}

        {showStep4 && (
          <div ref={step4Ref}>
            <StepInpaint
              sessionId={currentSessionId}
              config={config}
              style={style}
              setting={setting}
              scene={scene}
              dogPrompt={dogPrompt}
              includeStyleInInpaintPrompt={includeStyleInInpaintPrompt}
              hiddennessLevel={hiddennessLevel}
              hardHiddenPercent={hardHiddenPercent}
              inpaintPadding={inpaintPadding}
              inpaintModel={inpaintModel}
              showOverlay={showOverlay}
              radius={radius}
              collapsed={false}
              inpaintStream={inpaintStream}
            />
          </div>
        )}

        {showStep5 && currentSessionId && (
          <StepBandGeneration
            sessionId={currentSessionId}
            extension={activeSession?.extension ?? null}
            extensionBands={activeSession?.extensionBands}
            bandGen={bandGenStream}
            collapsed={false}
          />
        )}

        {showStep5 && (
          <div ref={step5Ref}>
            <div className="step">
              <StepHeader stepNumber={6} title="Review Complete" collapsed={false} summary="Use Gallery to select this level for the game." />
              <div className="step-content">
                <p style={{ color: '#aaa', marginTop: 0 }}>
                  This level is ready for Gallery review. Select completed levels in Gallery, then order and validate the game in Lineup.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => goToTab('gallery')}>Open Gallery</button>
                  <button className="btn" onClick={() => goToTab('lineup')}>Open Lineup</button>
                  <button className="btn" onClick={handleReset}>New Level</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    );
  }

  return (
    <>
      {body}
      <ApiErrorToast />
    </>
  );
}
