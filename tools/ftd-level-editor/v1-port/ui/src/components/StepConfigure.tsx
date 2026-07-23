import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

// localStorage key for the Configure step's sticky selections (setting, scene,
// style, view, entity). Survives page reloads so iterating inside the same
// region/style bucket doesn't require re-picking every dropdown.
const LS_CONFIGURE_KEY = 'ftd-builder-configure-v3';
const LS_MULTI_SCENE_JOBS_KEY = 'ftd-builder-many-scene-jobs-v1';
const DEFAULT_STYLE = 'clean_old_cartoon';
const DEFAULT_MODEL = 'openai/gpt-image-2';
const DEFAULT_INPAINT_MODEL = 'openai/gpt-image-2';
const DEFAULT_UPSCALE_MODEL = 'fal-ai/esrgan';
type StickyConfig = {
  setting?: string;
  scene?: string;
  style?: string;
  view?: string;
  entity?: string;
  model?: string;
  bgModel?: string;
  inpaintModel?: string;
  upscaleEnabled?: boolean;
  upscaleModel?: string;
  upscaleTargetLongEdge?: number;
  nDogs?: number;
};
function loadSticky(): StickyConfig {
  try {
    const raw = localStorage.getItem(LS_CONFIGURE_KEY);
    return raw ? (JSON.parse(raw) as StickyConfig) : {};
  } catch {
    return {};
  }
}
function saveSticky(s: StickyConfig): void {
  try {
    localStorage.setItem(LS_CONFIGURE_KEY, JSON.stringify(s));
  } catch {
    // quota / private mode — silently ignore, in-memory state still works
  }
}
import type { Background, ConfigResponse, GenerationProgress, Orientation } from '../types';
import { createSession, getBackgroundGenerationJob, startBackgroundGenerationJob, upscaleBackground } from '../api/editorApi';
import type { BgStreamControls } from '../api/useBgStream';
import StepHeader from './StepHeader';
import { PromptSaver } from './PromptSaver';
import { findModelLabel, getInpaintModels } from '../lib/modelOptions';

interface Props {
  config: ConfigResponse;
  orientation: Orientation;
  configSummary: string;
  generating: boolean;
  generationProgress: GenerationProgress;
  generationErrors: string[];
  generationJobId: string | null;
  generationJobStatus: string | null;
  upscaling: boolean;
  upscaleProgress: GenerationProgress;
  collapsed: boolean;
  bgStream: BgStreamControls;
  onUpscaleSettingsChange: (settings: { enabled: boolean; model: string; targetLongEdge: number }) => void;
  onOrientationChange: (orientation: Orientation) => void;
  onGenerationStart: (params: { total: number; summary: string }) => void;
  onGenerationCreateFailed: () => void;
  onSessionOpen: (sessionId: string) => void;
  onSessionConfigured: (params: {
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
  }) => void;
}

type GenerationMode = 'single' | 'many';
type MultiSceneJobStatus = 'creating' | 'generating' | 'upscaling' | 'ready' | 'failed';
type ManySceneEntry = {
  settingKey: string;
  sceneKey: string;
  label: string;
  description: string;
};

interface MultiSceneJob {
  sceneKey: string;
  label: string;
  sessionId: string | null;
  jobId: string | null;
  jobStatus: string | null;
  status: MultiSceneJobStatus;
  succeeded: number;
  failed: number;
  total: number;
  backgroundFile: string | null;
  costLines: string[];
  retryLines: string[];
  errors: string[];
}

const TERMINAL_MULTI_SCENE_STATUSES = new Set<MultiSceneJobStatus>(['ready', 'failed']);

function isMultiSceneJob(value: unknown): value is MultiSceneJob {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MultiSceneJob>;
  return (
    typeof candidate.sceneKey === 'string'
    && typeof candidate.label === 'string'
    && (candidate.sessionId === null || typeof candidate.sessionId === 'string')
    && (candidate.jobId === null || typeof candidate.jobId === 'string')
    && (candidate.jobStatus === null || typeof candidate.jobStatus === 'string')
    && typeof candidate.status === 'string'
    && ['creating', 'generating', 'upscaling', 'ready', 'failed'].includes(candidate.status)
    && typeof candidate.succeeded === 'number'
    && typeof candidate.failed === 'number'
    && typeof candidate.total === 'number'
    && (candidate.backgroundFile === null || typeof candidate.backgroundFile === 'string')
    && Array.isArray(candidate.costLines)
    && Array.isArray(candidate.retryLines)
    && Array.isArray(candidate.errors)
  );
}

function normalizeRestoredMultiSceneJob(job: MultiSceneJob): MultiSceneJob {
  if (TERMINAL_MULTI_SCENE_STATUSES.has(job.status) || (job.sessionId && job.jobId)) return job;
  return {
    ...job,
    status: 'failed',
    jobStatus: job.jobStatus ?? 'resume_unavailable',
    errors: [...job.errors, 'reload recovery unavailable before session/job id was created'],
  };
}

function loadMultiSceneJobs(): MultiSceneJob[] {
  try {
    const raw = localStorage.getItem(LS_MULTI_SCENE_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMultiSceneJob).map(normalizeRestoredMultiSceneJob);
  } catch {
    return [];
  }
}

function saveMultiSceneJobs(jobs: MultiSceneJob[]): void {
  try {
    if (jobs.length === 0) {
      localStorage.removeItem(LS_MULTI_SCENE_JOBS_KEY);
      return;
    }
    localStorage.setItem(LS_MULTI_SCENE_JOBS_KEY, JSON.stringify(jobs));
  } catch {
    // quota / private mode — the visible cards still work for this session.
  }
}

export default function StepConfigure({
  config,
  orientation,
  configSummary,
  generating,
  generationProgress,
  generationErrors,
  generationJobId,
  generationJobStatus,
  upscaling,
  upscaleProgress,
  collapsed,
  bgStream,
  onUpscaleSettingsChange,
  onOrientationChange,
  onGenerationStart,
  onGenerationCreateFailed,
  onSessionOpen,
  onSessionConfigured,
}: Props) {
  const viewKeys = Object.keys(config.views);
  const styleKeys = Object.keys(config.styles);
  const settingKeys = Object.keys(config.settings);
  const entityKeys = Object.keys(config.entities);
  const inpaintModels = getInpaintModels(config);
  const upscaleModels = config.upscaleModels ?? [];
  const settingKeySignature = settingKeys.join('|');

  // Hydrate defaults from the sticky localStorage snapshot when present so
  // repeated sessions in the same region/style/entity don't require reselect.
  // Each field is validated against the current canonical dicts — if a slug
  // was removed server-side between sessions we fall back to the hardcoded
  // default rather than leaving the dropdown stuck on an invalid value.
  const sticky = loadSticky();

  const defaultSetting =
    sticky.setting && settingKeys.includes(sticky.setting)
      ? sticky.setting
      : settingKeys.includes('japan') ? 'japan' : settingKeys[0] ?? '';
  const defaultSceneList = config.settings[defaultSetting]?.scenes ?? {};
  const firstScene = Object.keys(defaultSceneList)[0] ?? '';
  const defaultScene =
    sticky.scene && sticky.scene in defaultSceneList ? sticky.scene : firstScene;
  const defaultView =
    sticky.view && viewKeys.includes(sticky.view) ? sticky.view : viewKeys[0] ?? '';
  const defaultStyle =
    sticky.style && styleKeys.includes(sticky.style)
      ? sticky.style
      : styleKeys.includes(DEFAULT_STYLE) ? DEFAULT_STYLE : styleKeys[0] ?? '';
  const defaultEntity =
    sticky.entity && entityKeys.includes(sticky.entity)
      ? sticky.entity
      : entityKeys.includes('dog') ? 'dog' : entityKeys[0] ?? 'dog';
  const defaultBgModel =
    sticky.bgModel && config.models.some((m) => m.id === sticky.bgModel)
      ? sticky.bgModel
      : sticky.model && config.models.some((m) => m.id === sticky.model)
        ? sticky.model
        : config.models.some((m) => m.id === DEFAULT_MODEL)
          ? DEFAULT_MODEL
          : config.models[0]?.id ?? '';
  const defaultInpaintModel =
    sticky.inpaintModel && inpaintModels.some((m) => m.id === sticky.inpaintModel)
      ? sticky.inpaintModel
      : sticky.model && inpaintModels.some((m) => m.id === sticky.model)
        ? sticky.model
        : inpaintModels.some((m) => m.id === DEFAULT_INPAINT_MODEL)
          ? DEFAULT_INPAINT_MODEL
          : inpaintModels[0]?.id ?? defaultBgModel;
  const defaultUpscaleModel =
    sticky.upscaleModel && upscaleModels.some((m) => m.id === sticky.upscaleModel)
      ? sticky.upscaleModel
      : upscaleModels.some((m) => m.id === DEFAULT_UPSCALE_MODEL)
        ? DEFAULT_UPSCALE_MODEL
        : upscaleModels[0]?.id ?? DEFAULT_UPSCALE_MODEL;

  const [view, setView] = useState(defaultView);
  const [style, setStyle] = useState(defaultStyle);
  const [setting, setSetting] = useState(defaultSetting);
  const [scene, setScene] = useState(defaultScene);
  const [entity, setEntity] = useState(defaultEntity);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('single');
  const [selectedScenes, setSelectedScenes] = useState<Record<string, boolean>>({ [defaultScene]: true });
  const [bgModel, setBgModel] = useState(defaultBgModel);
  const [inpaintModel, setInpaintModel] = useState(defaultInpaintModel);
  const [nDogs, setNDogs] = useState(sticky.nDogs ?? 30);
  const [upscaleEnabled, setUpscaleEnabled] = useState((sticky.upscaleEnabled ?? true) && upscaleModels.length > 0);
  const [upscaleModel, setUpscaleModel] = useState(defaultUpscaleModel);
  const [upscaleTargetLongEdge] = useState(sticky.upscaleTargetLongEdge ?? 3840);

  // Persist any change to the sticky snapshot. Writes are idempotent and
  // cheap enough to run on every dependency change.
  useEffect(() => {
    const effectiveUpscaleEnabled = upscaleEnabled && upscaleModels.length > 0;
    saveSticky({
      setting,
      scene,
      style,
      view,
      entity,
      model: bgModel,
      bgModel,
      inpaintModel,
      upscaleEnabled: effectiveUpscaleEnabled,
      upscaleModel,
      upscaleTargetLongEdge,
      nDogs,
    });
    onUpscaleSettingsChange({
      enabled: effectiveUpscaleEnabled,
      model: upscaleModel,
      targetLongEdge: upscaleTargetLongEdge,
    });
  }, [setting, scene, style, view, entity, bgModel, inpaintModel, upscaleEnabled, upscaleModel, upscaleTargetLongEdge, nDogs, upscaleModels.length, onUpscaleSettingsChange]);

  // Scenes available for the currently selected setting
  const sceneKeys = Object.keys(config.settings[setting]?.scenes ?? {});
  const sceneKeySignature = sceneKeys.join('|');
  const allSceneEntries = useMemo<ManySceneEntry[]>(() => (
    settingKeys.flatMap((settingKey) => (
      Object.keys(config.settings[settingKey]?.scenes ?? {}).map((sceneKey) => {
        const label = sceneKey.replace(`${settingKey}_`, '').replace(/_/g, ' ');
        return {
          settingKey,
          sceneKey,
          label,
          description: config.settings[settingKey]?.shortDescriptions?.[sceneKey]
            || config.settings[settingKey]?.scenes?.[sceneKey]?.split('. ', 1)[0]
            || label,
        };
      })
    ))
  ), [config.settings, settingKeySignature]);
  const selectedManySceneEntries = useMemo(
    () => allSceneEntries.filter((entry) => selectedScenes[entry.sceneKey]),
    [allSceneEntries, selectedScenes],
  );
  const selectedSceneKeys = selectedManySceneEntries.map((entry) => entry.sceneKey);
  const selectedSceneCount = selectedSceneKeys.length;

  // Prompt previews are loaded from the prompt library. Generation submits only
  // recipe choices; the backend owns final prompt assembly.
  const [viewPrompt, setViewPrompt] = useState(config.views[defaultView] ?? '');
  const [stylePrompt, setStylePrompt] = useState(config.styles[defaultStyle] ?? '');
  const [contentPrompt, setContentPrompt] = useState(defaultSceneList[defaultScene] ?? '');

  // Portrait is the only normal editor flow in this branch. Landscape was
  // intentionally retired from Configure and can be reintroduced as a separate
  // product slice later.
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [imageSize, setImageSize] = useState('1K');
  const [forceOpen, setForceOpen] = useState(false);
  const [multiSceneJobs, setMultiSceneJobs] = useState<MultiSceneJob[]>(loadMultiSceneJobs);
  const [multiSceneRunning, setMultiSceneRunning] = useState(false);
  const multiSceneResumeKeysRef = useRef<Set<string> | null>(null);
  if (multiSceneResumeKeysRef.current === null) {
    multiSceneResumeKeysRef.current = new Set(
      multiSceneJobs
        .filter((job) => !TERMINAL_MULTI_SCENE_STATUSES.has(job.status) && job.sessionId && job.jobId)
        .map((job) => job.sceneKey),
    );
  }
  const multiSceneStreamsRef = useRef<Map<string, EventSource>>(new Map());
  const multiSceneUpscaleAbortRef = useRef<Map<string, AbortController>>(new Map());

  // Authoritative orientation is provided by App so the strangler phase can
  // mirror this choice into both the legacy reducer and the query-backed flow.
  const effectiveUpscaleEnabled = upscaleEnabled && upscaleModels.length > 0;
  const layerBackgroundSelected = bgModel.startsWith('layer/');

  const { start: startBgStream, reset: resetBgStream } = bgStream;
  const closeMultiSceneStreams = useCallback(() => {
    for (const stream of multiSceneStreamsRef.current.values()) stream.close();
    multiSceneStreamsRef.current.clear();
    for (const controller of multiSceneUpscaleAbortRef.current.values()) controller.abort();
    multiSceneUpscaleAbortRef.current.clear();
  }, []);

  useEffect(() => () => closeMultiSceneStreams(), [closeMultiSceneStreams]);

  useEffect(() => {
    saveMultiSceneJobs(multiSceneJobs);
  }, [multiSceneJobs]);

  useEffect(() => {
    if (orientation !== 'portrait') {
      resetBgStream();
      onOrientationChange('portrait');
    }
  }, [orientation, onOrientationChange, resetBgStream]);

  useEffect(() => {
    setSelectedScenes((current) => {
      const validKeys = generationMode === 'many'
        ? allSceneEntries.map((entry) => entry.sceneKey)
        : sceneKeys;
      const next: Record<string, boolean> = {};
      for (const key of validKeys) {
        if (current[key]) next[key] = true;
      }
      const currentKeys = Object.keys(current).filter((key) => current[key]).sort();
      const nextKeys = Object.keys(next).filter((key) => next[key]).sort();
      if (currentKeys.length === nextKeys.length && currentKeys.every((key, index) => key === nextKeys[index])) {
        return current;
      }
      if (Object.values(next).some(Boolean)) return next;
      return scene ? { [scene]: true } : {};
    });
  }, [allSceneEntries, generationMode, sceneKeySignature, scene]);

  // Synchronous re-entrancy guard. `generating` disables the button
  // after the first click, but the React render takes ~16 ms — a double-
  // click inside that window could fire two createSession calls and orphan
  // one of the sessions. busyRef flips before any await, so the second
  // invocation bails immediately.
  const busyRef = useRef(false);

  const handleGenerate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const bgModelLabel = findModelLabel(config.models, bgModel);
      const inpaintModelLabel = findModelLabel(inpaintModels, inpaintModel);
      const effectiveUpscaleEnabled = upscaleEnabled && upscaleModels.length > 0;
      const upscaleModelLabel = findModelLabel(upscaleModels, upscaleModel);
      const sceneLabel = scene.replace(`${setting}_`, '').replace(/_/g, ' ');
      const settingLabel = config.settings[setting]?.label ?? setting;
      const upscaleSummary = effectiveUpscaleEnabled
        ? ` / upscale:${upscaleModelLabel} ${upscaleTargetLongEdge}px`
        : '';
      const summary = `${settingLabel} / ${sceneLabel} / ${style.replace(/_/g, ' ')} / ${entity.replace(/_/g, ' ')} / bg:${bgModelLabel} / inpaint:${inpaintModelLabel}${upscaleSummary}`;
      onGenerationStart({ total: 1, summary });

      let sessionId: string;
      try {
        const resp = await createSession(
          {
            style,
            bgModel,
            inpaintModel,
            nDogs,
            aspectRatio,
            imageSize,
            setting,
            scene,
            entity,
            view,
            upscaleEnabled: effectiveUpscaleEnabled,
            upscaleModel,
            upscaleTargetLongEdge,
          },
        );
        sessionId = resp.sessionId;
        onSessionConfigured({
          sessionId,
          style,
          setting,
          scene,
          entity,
          dogPrompt: resp.dogPrompt,
          inpaintModel,
          upscaleEnabled: effectiveUpscaleEnabled,
          upscaleModel,
          upscaleTargetLongEdge,
        });
      } catch (err) {
        // createSession already dispatched an ftd:api-error toast via the
        // request() wrapper — we just need to drop the loading state so
        // the wizard doesn't sit spinning forever.
        console.warn('[StepConfigure] createSession failed', err);
        onGenerationCreateFailed();
        return;
      }

    // Use replaceState — not `window.location.hash = ...` — so this URL
    // update does NOT trigger the App-level hashchange listener. Setting
    // `.hash` would dispatch a hashchange in the same microtask, which
    // races with the React effect that mirrors the current session into a ref;
    // the hashchange handler would see a stale null ref and refetch the
    // just-created (still-empty) session, dispatching RESTORE_SESSION and
    // wiping our in-flight `generating: true` state ("snap back" bug).
      history.replaceState(null, '', `#session=${sessionId}`);

      startBgStream(
        sessionId,
        {
          total: 1,
          upscale: effectiveUpscaleEnabled
            ? {
              enabled: true,
              model: upscaleModel,
              targetLongEdge: upscaleTargetLongEdge,
            }
            : undefined,
        },
      );
      setForceOpen(false);
    } finally {
      // Release the guard once we've either started the stream or
      // bailed on a creation error. The parent generating flag protects against
      // further double-submits while the stream runs.
      busyRef.current = false;
    }
  }, [style, entity, bgModel, inpaintModel, upscaleEnabled, upscaleModel, upscaleTargetLongEdge, upscaleModels, nDogs, aspectRatio, imageSize, setting, scene, view, config, onGenerationStart, onGenerationCreateFailed, onSessionConfigured, startBgStream]);

  const updateMultiSceneJob = useCallback((sceneKey: string, patch: Partial<MultiSceneJob>) => {
    setMultiSceneJobs((jobs) => jobs.map((job) => (
      job.sceneKey === sceneKey ? { ...job, ...patch } : job
    )));
  }, []);

  useEffect(() => {
    const unfinishedJobs = multiSceneJobs.filter((job) => !TERMINAL_MULTI_SCENE_STATUSES.has(job.status));
    const resumableJobs = unfinishedJobs.filter((job) => (
      job.sessionId
      && job.jobId
      && multiSceneResumeKeysRef.current?.has(job.sceneKey)
    ));
    setMultiSceneRunning(unfinishedJobs.length > 0);
    if (resumableJobs.length === 0) return undefined;

    let cancelled = false;
    const pollJobs = async (): Promise<void> => {
      await Promise.all(resumableJobs.map(async (job) => {
        const sessionId = job.sessionId;
        const jobId = job.jobId;
        if (!sessionId || !jobId) return;
        try {
          const response = await getBackgroundGenerationJob(sessionId, jobId);
          if (cancelled) return;
          const latestBackground = response.backgrounds.at(-1);
          const failed = response.status.startsWith('failed');
          const terminal = failed || response.status === 'succeeded';
          if (terminal) multiSceneResumeKeysRef.current?.delete(job.sceneKey);
          updateMultiSceneJob(job.sceneKey, {
            status: terminal ? (failed ? 'failed' : 'ready') : 'generating',
            jobStatus: response.status,
            succeeded: response.succeeded,
            failed: response.failed,
            backgroundFile: latestBackground?.file ?? job.backgroundFile,
            errors: response.error ? [response.error] : job.errors,
          });
        } catch (err) {
          if (cancelled) return;
          multiSceneResumeKeysRef.current?.delete(job.sceneKey);
          updateMultiSceneJob(job.sceneKey, {
            status: 'failed',
            jobStatus: 'resume_failed',
            errors: [err instanceof Error ? err.message : String(err)],
          });
        }
      }));
    };

    void pollJobs();
    const timer = window.setInterval(() => void pollJobs(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [multiSceneJobs, updateMultiSceneJob]);

  const streamMultiSceneBackground = useCallback((sceneKey: string, sessionId: string): Promise<void> => (
    new Promise((resolve) => {
      const readyBackgrounds: Background[] = [];
      let stream: EventSource | null = null;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        stream?.close();
        multiSceneStreamsRef.current.delete(sceneKey);
        resolve();
      };

      startBackgroundGenerationJob(sessionId)
        .then((job) => {
          updateMultiSceneJob(sceneKey, {
            jobId: job.jobId,
            jobStatus: job.status,
            succeeded: job.succeeded,
            failed: job.failed,
          });
          stream = new EventSource(`/api/sessions/${sessionId}/generate`);
          multiSceneStreamsRef.current.set(sceneKey, stream);

      stream.addEventListener('bg_ready', (event: MessageEvent) => {
        const background = JSON.parse(event.data) as Background;
        readyBackgrounds.push(background);
        updateMultiSceneJob(sceneKey, {
          succeeded: readyBackgrounds.length,
          backgroundFile: background.file,
        });
      });

      stream.addEventListener('bg_error', (event: MessageEvent) => {
        const data = JSON.parse(event.data) as { index?: number; error?: string };
        updateMultiSceneJob(sceneKey, {
          failed: 1,
          errors: [`bg #${data.index ?? 0}: ${data.error ?? 'unknown error'}`],
        });
      });

      stream.addEventListener('bg_retry', (event: MessageEvent) => {
        const data = JSON.parse(event.data) as { index?: number; attempt?: number; maxAttempts?: number; error?: string };
        updateMultiSceneJob(sceneKey, {
          retryLines: [`bg #${data.index ?? 0}: retry ${data.attempt ?? '?'} / ${data.maxAttempts ?? '?'} - ${data.error ?? 'retrying'}`],
        });
      });

      stream.addEventListener('bg_cost_estimate', (event: MessageEvent) => {
        const data = JSON.parse(event.data) as { index?: number; provider?: string; estimatedCreativeUnits?: number | null };
        const estimate = typeof data.estimatedCreativeUnits === 'number'
          ? `${data.estimatedCreativeUnits.toFixed(4)} CUs`
          : 'cost unknown';
        updateMultiSceneJob(sceneKey, {
          costLines: [`bg #${data.index ?? 0}: ${data.provider ?? 'provider'} ${estimate}`],
        });
      });

      stream.addEventListener('generate_complete', () => {
        if (!effectiveUpscaleEnabled || readyBackgrounds.length === 0) {
          updateMultiSceneJob(sceneKey, {
            status: readyBackgrounds.length > 0 ? 'ready' : 'failed',
            jobStatus: readyBackgrounds.length > 0 ? 'succeeded' : 'failed_retryable',
          });
          finish();
          return;
        }

        updateMultiSceneJob(sceneKey, { status: 'upscaling' });
        const controller = new AbortController();
        multiSceneUpscaleAbortRef.current.set(sceneKey, controller);
        void Promise.all(readyBackgrounds.map((background) => (
          upscaleBackground(sessionId, background.index, upscaleModel, upscaleTargetLongEdge, false, controller.signal)
        )))
          .then((responses) => {
            const latest = responses.at(-1)?.background;
            updateMultiSceneJob(sceneKey, {
              status: 'ready',
              backgroundFile: latest?.file ?? readyBackgrounds.at(-1)?.file ?? null,
            });
          })
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            updateMultiSceneJob(sceneKey, {
              status: 'failed',
              errors: [err instanceof Error ? err.message : String(err)],
            });
          })
          .finally(() => {
            multiSceneUpscaleAbortRef.current.delete(sceneKey);
            finish();
          });
      });

      stream.onerror = () => {
        updateMultiSceneJob(sceneKey, {
          status: 'failed',
          jobStatus: 'replay_disconnected',
          errors: ['stream disconnected: SSE connection closed'],
        });
        finish();
      };
        })
        .catch((err: unknown) => {
          updateMultiSceneJob(sceneKey, {
            status: 'failed',
            jobStatus: 'start_failed',
            errors: [err instanceof Error ? err.message : String(err)],
          });
          finish();
        });
    })
  ), [effectiveUpscaleEnabled, upscaleModel, upscaleTargetLongEdge, updateMultiSceneJob]);

  const handleGenerateMany = useCallback(async () => {
    if (multiSceneRunning || selectedSceneKeys.length === 0) return;
    closeMultiSceneStreams();
    multiSceneResumeKeysRef.current?.clear();
    setMultiSceneRunning(true);
    const jobs = selectedManySceneEntries.map((entry): MultiSceneJob & { settingKey: string } => ({
      sceneKey: entry.sceneKey,
      settingKey: entry.settingKey,
      label: `${config.settings[entry.settingKey]?.label ?? entry.settingKey} / ${entry.label}`,
      sessionId: null,
      jobId: null,
      jobStatus: null,
      status: 'creating',
      succeeded: 0,
      failed: 0,
      total: 1,
      backgroundFile: null,
      costLines: [],
      retryLines: [],
      errors: [],
    }));
    setMultiSceneJobs(jobs);

    try {
      await Promise.all(jobs.map(async (job) => {
        try {
          const response = await createSession({
            style,
            bgModel,
            inpaintModel,
            nDogs,
            aspectRatio,
            imageSize,
            setting: job.settingKey,
            scene: job.sceneKey,
            entity,
            view,
            upscaleEnabled: effectiveUpscaleEnabled,
            upscaleModel,
            upscaleTargetLongEdge,
          });
          updateMultiSceneJob(job.sceneKey, {
            sessionId: response.sessionId,
            status: 'generating',
          });
          await streamMultiSceneBackground(job.sceneKey, response.sessionId);
        } catch (err) {
          updateMultiSceneJob(job.sceneKey, {
            status: 'failed',
            errors: [err instanceof Error ? err.message : String(err)],
          });
        }
      }));
    } finally {
      setMultiSceneRunning(false);
    }
  }, [multiSceneRunning, selectedSceneKeys.length, selectedManySceneEntries, closeMultiSceneStreams, config.settings, style, bgModel, inpaintModel, nDogs, aspectRatio, imageSize, entity, view, effectiveUpscaleEnabled, upscaleModel, upscaleTargetLongEdge, updateMultiSceneJob, streamMultiSceneBackground]);

  const isCollapsed = collapsed && !forceOpen;
  const entityLabel = entity.replace(/_/g, ' ');
  const entityDescription = config.entities[entity] ?? entityLabel;
  const showEntityDescription = entityDescription.trim().toLowerCase() !== entityLabel.trim().toLowerCase();
  const selectedSceneDescription =
    config.settings[setting]?.shortDescriptions?.[scene]
    || contentPrompt.split('. ', 1)[0]?.trim()
    || 'No scene description available.';

  return (
    <div className={`step ${isCollapsed ? 'collapsed' : ''}`}>
      <StepHeader
        stepNumber={1}
        title="Configure"
        collapsed={isCollapsed}
        onToggle={collapsed ? () => setForceOpen(!forceOpen) : undefined}
        summary={configSummary}
      />

      {!isCollapsed && (
        <div className="step-content">
          <div className="setup-form configure-shell">
            <div className="configure-summary-bar" aria-label="Current generation recipe">
              <span className="recipe-chip">{config.settings[setting]?.label ?? setting}</span>
              <span className="recipe-chip">{style.replace(/_/g, ' ')}</span>
              <span className="recipe-chip">{generationMode === 'single' ? 'mode: one scene' : `mode: ${selectedSceneCount} scenes`}</span>
            </div>

            <div className="configure-section configure-section-grid">
            {/* View */}
            <div className="form-group">
              <label>
                View
                <select
                  value={view}
                  onChange={(e) => { setView(e.target.value); setViewPrompt(config.views[e.target.value] ?? ''); }}
                  className="inline-select"
                >
                  {viewKeys.map((k) => (
                    <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <PromptSaver kind={`view:${view}`} value={viewPrompt} onLoadDefault={setViewPrompt} showSave={false} />
            </div>

            {/* Style */}
            <div className="form-group">
              <label>
                Style
                <select
                  value={style}
                  onChange={(e) => { setStyle(e.target.value); setStylePrompt(config.styles[e.target.value] ?? ''); }}
                  className="inline-select"
                >
                  {styleKeys.map((k) => (
                    <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <PromptSaver kind={`style:${style}`} value={stylePrompt} onLoadDefault={setStylePrompt} showSave={false} />
            </div>

            {/* Entity — what hides in the scene. Game code + on-disk layout
                stay "dog"-named; this only controls the inpaint prompt. */}
            <div className="form-group">
              <label>
                Hidden Entity
                <select
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                  className="inline-select"
                >
                  {entityKeys.map((k) => (
                    <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              {showEntityDescription && (
                <div style={{ color: '#888', fontSize: '0.85rem', marginTop: 4 }}>
                  {entityDescription}
                </div>
              )}
            </div>

            {/* Setting + Scene — the Setting dropdown picks a region;
                the Scene dropdown then restricts to its 5 canonical scenes. */}
            <div className="form-group">
              <label>
                Setting
                <select
                  value={setting}
                  onChange={(e) => {
                    const nextSetting = e.target.value;
                    const nextSceneKey = Object.keys(config.settings[nextSetting]?.scenes ?? {})[0] ?? '';
                    setSetting(nextSetting);
                    setScene(nextSceneKey);
                    setSelectedScenes(nextSceneKey ? { [nextSceneKey]: true } : {});
                    setContentPrompt(config.settings[nextSetting]?.scenes?.[nextSceneKey] ?? '');
                  }}
                  className="inline-select"
                >
                  {settingKeys.map((k) => (
                    <option key={k} value={k}>{config.settings[k].label}</option>
                  ))}
                </select>
              </label>
            </div>

            {generationMode === 'single' && (
              <div className="form-group">
                <label>
                  Scene
                  <select
                    value={scene}
                    onChange={(e) => {
                      const nextScene = e.target.value;
                      setScene(nextScene);
                      setSelectedScenes({ [nextScene]: true });
                      setContentPrompt(config.settings[setting]?.scenes?.[nextScene] ?? '');
                    }}
                    className="inline-select"
                  >
                    {sceneKeys.map((k) => (
                      <option key={k} value={k}>{k.replace(`${setting}_`, '').replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </label>
                <PromptSaver kind={`scene:${setting}.${scene}`} value={contentPrompt} onLoadDefault={setContentPrompt} showSave={false} />
                <div className="configure-muted">
                  {selectedSceneDescription}
                </div>
              </div>
            )}
            </div>

            <div className="configure-section">
              <div className="section-kicker">Generation mode</div>
              <div className="segmented-control" role="tablist" aria-label="Generation mode">
                <button
                  type="button"
                  className={generationMode === 'single' ? 'segment-button selected' : 'segment-button'}
                  onClick={() => setGenerationMode('single')}
                  data-testid="mode-single-scene"
                >
                  One scene
                </button>
                <button
                  type="button"
                  className={generationMode === 'many' ? 'segment-button selected' : 'segment-button'}
                  onClick={() => setGenerationMode('many')}
                  data-testid="mode-many-scenes"
                >
                  Many scenes
                </button>
              </div>
            </div>

            {generationMode === 'many' && (
              <div className="form-group configure-section" data-testid="many-scene-picker">
                <label>Scenes</label>
                <div className="configure-muted">
                  {selectedSceneCount} selected across all settings
                </div>
                <div className="scene-setting-stack">
                  {settingKeys.map((settingKey) => {
                    const entries = allSceneEntries.filter((entry) => entry.settingKey === settingKey);
                    if (entries.length === 0) return null;
                    return (
                      <section key={settingKey} className="scene-setting-group">
                        <h4>{config.settings[settingKey]?.label ?? settingKey}</h4>
                        <div className="scene-choice-grid">
                          {entries.map((entry) => (
                            <label
                              key={entry.sceneKey}
                              className="scene-choice-card"
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(selectedScenes[entry.sceneKey])}
                                onChange={(event) => {
                                  setSelectedScenes((current) => ({ ...current, [entry.sceneKey]: event.target.checked }));
                                  if (event.target.checked) {
                                    setSetting(entry.settingKey);
                                    setScene(entry.sceneKey);
                                    setContentPrompt(config.settings[entry.settingKey]?.scenes?.[entry.sceneKey] ?? '');
                                  }
                                }}
                                data-testid={`scene-check-${entry.sceneKey}`}
                                style={{ marginTop: 2 }}
                              />
                              <span>
                                <span className="scene-choice-title">{entry.label}</span>
                                <span className="scene-choice-copy">{entry.description}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="form-row configure-section">
              <div className="form-group">
                <label>Background Model</label>
                <select value={bgModel} onChange={(e) => setBgModel(e.target.value)}>
                  {config.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                {layerBackgroundSelected && (
                  <div style={{ color: '#d6b75c', fontSize: '0.85rem', marginTop: 6 }}>
                    Layer cost is shown as unknown until the generation stream returns an estimate. The run uses the normal review grid before continuing.
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Inpaint Model</label>
                <select value={inpaintModel} onChange={(e) => setInpaintModel(e.target.value)}>
                  {inpaintModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Entities per Level</label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={nDogs}
                  onChange={(e) => setNDogs(Math.min(40, Math.max(1, parseInt(e.target.value) || 1)))}
                />
              </div>
            </div>

            <details className="configure-section image-settings-panel">
              <summary>Image settings</summary>
              <div className="form-row" style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label>Aspect Ratio</label>
                  <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                    <option value="9:16">9:16 (tall)</option>
                    <option value="3:4">3:4 (portrait)</option>
                    <option value="1:1">1:1 (square)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Resolution</label>
                  <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                    <option value="1K">1K (1024px)</option>
                    <option value="2K">2K (2048px)</option>
                    <option value="4K">4K (3840px)</option>
                  </select>
                </div>
              </div>

              <div className={`upscale-config-panel ${effectiveUpscaleEnabled ? 'enabled' : ''}`}>
                <label className="toolbar-toggle">
                  <input
                    type="checkbox"
                    checked={effectiveUpscaleEnabled}
                    disabled={upscaleModels.length === 0}
                    onChange={(e) => setUpscaleEnabled(e.target.checked)}
                  />
                  <span>Auto-upscale background candidates to 4K</span>
                </label>
                <div className="upscale-config-row">
                  <div className="form-group">
                    <label>Upscale Model</label>
                    <select
                      value={upscaleModel}
                      onChange={(e) => setUpscaleModel(e.target.value)}
                      disabled={!effectiveUpscaleEnabled || upscaleModels.length === 0}
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
                  <div className="upscale-config-copy">
                    {upscaleModels.length === 0
                      ? 'FAL_KEY is required before the upscale stage can run.'
                      : effectiveUpscaleEnabled
                        ? `Adds 4K candidates after generation. Target long edge: ${upscaleTargetLongEdge}px; last ESRGAN run was about $0.02 per candidate.`
                        : 'Keeps generation native-only. You can still upscale a selected background manually in Step 2.'}
                  </div>
                </div>
              </div>
            </details>

            {(generating || generationErrors.length > 0) && (
              <div className="generation-status configure-generation-status" role={generationErrors.length > 0 ? 'alert' : 'status'}>
                {generating && (
                  <>
                    <span className="loading-spinner small" />
                    <span className="generation-badge">
                      Generating background {generationProgress.succeeded}/{generationProgress.total || 1}
                      {generationProgress.failed > 0 && (
                        <span className="generation-warning"> ({generationProgress.failed} failed)</span>
                      )}
                    </span>
                    {generationJobId && (
                      <span className="generation-badge" title="Durable server job. Safe to reload while generation continues.">
                        job {generationJobStatus ?? 'queued'} · {generationJobId}
                      </span>
                    )}
                  </>
                )}
                {generationErrors.length > 0 && (
                  <div className="generation-error-list">
                    <strong>Background generation errors:</strong>
                    <ul>
                      {generationErrors.map((message, index) => (
                        <li key={`${message}-${index}`}>{message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {generationMode === 'single' ? (
              <button
                className="btn btn-primary btn-large"
                onClick={handleGenerate}
                disabled={generating || upscaling || multiSceneRunning || !contentPrompt.trim()}
              >
                {upscaling ? (
                  <>
                    <span className="loading-spinner small" />
                    Upscaling... ({upscaleProgress.succeeded}/{upscaleProgress.total})
                  </>
                ) : generating ? (
                  <>
                    <span className="loading-spinner small" />
                    Generating... ({generationProgress.succeeded}/1)
                  </>
                ) : (
                  'Generate Level'
                )}
              </button>
            ) : (
              <button
                className="btn btn-primary btn-large"
                onClick={handleGenerateMany}
                disabled={generating || upscaling || multiSceneRunning || selectedSceneCount === 0}
                data-testid="generate-many-scenes"
              >
                {multiSceneRunning ? (
                  <>
                    <span className="loading-spinner small" />
                    Generating scenes...
                  </>
                ) : (
                  `Generate ${selectedSceneCount} Scene${selectedSceneCount === 1 ? '' : 's'}`
                )}
              </button>
            )}

            {multiSceneJobs.length > 0 && (
              <div className="many-scene-jobs" data-testid="many-scene-jobs">
                <div className="configure-muted">
                  Many-scene jobs use the same recipe/session API as a single level. Open any ready card to continue in Dogs.
                </div>
                <div className="many-scene-job-grid">
                  {multiSceneJobs.map((job) => (
                    <div
                      key={job.sceneKey}
                      data-testid={`many-scene-job-${job.sceneKey}`}
                      className="many-scene-job-card"
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <strong style={{ textTransform: 'capitalize' }}>{job.label}</strong>
                        <span style={{ color: job.status === 'failed' ? '#ff8080' : job.status === 'ready' ? '#86efac' : '#d6b75c', fontSize: '0.78rem' }}>
                          {job.status}
                        </span>
                      </div>
                      <div style={{ color: '#aaa', fontSize: '0.8rem', marginTop: 6 }}>
                        bg {job.succeeded + job.failed}/{job.total}
                        {job.sessionId ? ` · #${job.sessionId}` : ''}
                      </div>
                      {job.jobId && (
                        <div style={{ color: '#777', fontSize: '0.74rem', marginTop: 4, overflowWrap: 'anywhere' }}>
                          job {job.jobStatus ?? 'queued'} · {job.jobId}
                        </div>
                      )}
                      {[...job.costLines, ...job.retryLines, ...job.errors].map((line) => (
                        <div key={line} style={{ color: job.errors.includes(line) ? '#ff8080' : '#888', fontSize: '0.75rem', marginTop: 4 }}>
                          {line}
                        </div>
                      ))}
                      {job.backgroundFile && (
                        <div style={{ color: '#777', fontSize: '0.74rem', marginTop: 4, overflowWrap: 'anywhere' }}>
                          {job.backgroundFile}
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn"
                        onClick={() => job.sessionId && onSessionOpen(job.sessionId)}
                        disabled={!job.sessionId || job.status !== 'ready'}
                        style={{ marginTop: 10 }}
                      >
                        Open in Wizard
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
