import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createAnimationJob } from '../api/editorApi';
import type { AnimationJob, SpriteCandidate } from '../types';

interface Props {
  sessionId: string;
  candidate: SpriteCandidate;
  onJobCreated?: (job: AnimationJob) => void;
  assetBase?: 'levels' | 'public-levels';
}

interface AnimationPreset {
  id: string;
  label: string;
  prompt: string;
}

const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: 'tail_wag',
    label: 'Tail wag',
    prompt: 'Animate this dog sprite with a gentle tail wag. Keep the dog in place, preserve the cartoon 2D style, and make it a short seamless loop.',
  },
  {
    id: 'blink',
    label: 'Blink',
    prompt: 'Animate this dog sprite with a small blink and subtle head motion. Keep the body position stable, preserve the cartoon 2D style, and make it a short seamless loop.',
  },
  {
    id: 'sniff',
    label: 'Sniff',
    prompt: 'Animate this dog sprite with a curious sniffing motion. Add a tiny nose and head bob while keeping the paws planted and the cartoon 2D style unchanged.',
  },
  {
    id: 'happy_bounce',
    label: 'Happy bounce',
    prompt: 'Animate this dog sprite with a small happy bounce. Keep the dog centered, preserve the original proportions and cartoon 2D style, and make it loop cleanly.',
  },
  {
    id: 'idle_breathing',
    label: 'Idle breathing',
    prompt: 'Animate this dog sprite with subtle idle breathing and a tiny ear or head movement. Keep the silhouette readable and preserve the cartoon 2D style.',
  },
];

const DEFAULT_DURATION_SECONDS = 3;
const DEFAULT_FPS = 24;
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 8;
const MIN_FPS = 8;
const MAX_FPS = 30;

function spriteLabel(candidate: SpriteCandidate): string {
  return `dog #${candidate.dogIndex} · sprite ${String(candidate.spriteIndex).padStart(3, '0')}`;
}

function previewUrl(sessionId: string, job: AnimationJob, assetBase: 'levels' | 'public-levels'): string | null {
  if (job.previewPath === null) return null;
  return `/${assetBase}/${sessionId}/${job.previewPath}`;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parseClampedNumber(value: string, min: number, max: number, fallback: number): number {
  return clampNumber(Number(value), min, max, fallback);
}

function presetLabel(presetId: string | null): string {
  if (presetId === null) return 'Custom motion';
  return ANIMATION_PRESETS.find((preset) => preset.id === presetId)?.label ?? presetId;
}

function buildPromptSummary(preset: AnimationPreset, customDirection: string): string {
  if (!customDirection) return preset.prompt;
  return `${preset.prompt} Custom direction: ${customDirection}`;
}

function detailRecord(detail: unknown): Record<string, unknown> | null {
  if (detail === null || typeof detail !== 'object') return null;
  const record = detail as Record<string, unknown>;
  const nested = record.detail;
  if (nested !== null && typeof nested === 'object') return nested as Record<string, unknown>;
  return record;
}

function jobFromDetail(detail: unknown): AnimationJob | null {
  const record = detailRecord(detail);
  const job = record?.job;
  if (job !== null && typeof job === 'object') return job as AnimationJob;
  return null;
}

function errorMessageFromDetail(detail: unknown, fallback: string): string {
  const record = detailRecord(detail);
  return typeof record?.error === 'string' ? record.error : fallback;
}

export default function SpriteAnimationWizard({ sessionId, candidate, onJobCreated, assetBase = 'levels' }: Props) {
  const [selectedPresetId, setSelectedPresetId] = useState(ANIMATION_PRESETS[0].id);
  const [customPrompt, setCustomPrompt] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(String(DEFAULT_DURATION_SECONDS));
  const [fps, setFps] = useState(String(DEFAULT_FPS));
  const [job, setJob] = useState<AnimationJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const selectedPreset = useMemo(
    () => ANIMATION_PRESETS.find((preset) => preset.id === selectedPresetId) ?? ANIMATION_PRESETS[0],
    [selectedPresetId],
  );
  const customDirection = customPrompt.trim();
  const finalPromptSummary = buildPromptSummary(selectedPreset, customDirection);
  const currentPreviewUrl = job ? previewUrl(sessionId, job, assetBase) : null;
  const jobState = submitting ? 'running' : job?.status ?? 'configure';
  const promptSummaryLabel = job || submitting ? 'Prompt sent' : 'Prompt to send';
  const previewLabel = job ? presetLabel(job.motionPreset) : selectedPreset.label;

  const clearCompletedPreview = () => {
    if (job) {
      setJob(null);
      setDraftDirty(true);
    }
    if (error) setError(null);
  };

  const submit = async () => {
    const safeDurationSeconds = parseClampedNumber(durationSeconds, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS, DEFAULT_DURATION_SECONDS);
    const safeFps = parseClampedNumber(fps, MIN_FPS, MAX_FPS, DEFAULT_FPS);
    setDurationSeconds(String(safeDurationSeconds));
    setFps(String(safeFps));
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setSubmitting(true);
    setError(null);
    try {
      const createdJob = await createAnimationJob(sessionId, {
        sourceCandidateId: candidate.id,
        prompt: selectedPreset.prompt,
        motionPreset: selectedPreset.id,
        customPrompt: customDirection || null,
        durationSeconds: safeDurationSeconds,
        fps: safeFps,
      }, {
        signal: controller.signal,
        suppressToast: true,
      });
      setJob(createdJob);
      setDraftDirty(false);
      onJobCreated?.(createdJob);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError) {
        const failedJob = jobFromDetail(err.detail);
        if (failedJob) {
          setJob(failedJob);
          onJobCreated?.(failedJob);
        }
        setError(errorMessageFromDetail(err.detail, err.message));
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="sprite-animation-wizard">
      <div className="sprite-animation-wizard-header">
        <div>
          <h3>Animation Wizard</h3>
          <p>{spriteLabel(candidate)}</p>
        </div>
      </div>

      <div className="animation-flow" aria-label="Animation workflow">
        <span className={jobState === 'configure' ? 'active' : ''}>Configure</span>
        <span className={jobState === 'running' ? 'active' : ''}>Generate</span>
        <span className={jobState === 'completed' ? 'active' : ''}>Preview</span>
      </div>

      <div className="animation-preset-grid" role="group" aria-label="Animation preset">
        {ANIMATION_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`animation-preset-button ${preset.id === selectedPresetId ? 'selected' : ''}`}
            onClick={() => {
              setSelectedPresetId(preset.id);
              clearCompletedPreview();
            }}
            disabled={submitting}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="animation-prompt-summary">
        <span>{promptSummaryLabel}</span>
        <p>{finalPromptSummary}</p>
      </div>

      <label className="animation-custom-prompt">
        Custom direction
        <textarea
          value={customPrompt}
          onChange={(event) => {
            setCustomPrompt(event.target.value);
            clearCompletedPreview();
          }}
          disabled={submitting}
          placeholder="Optional: add constraints like keep paws planted, no camera movement, or only animate ears."
          rows={3}
        />
      </label>

      <div className="animation-controls-row">
        <label>
          Duration
          <input
            type="number"
            min={1}
            max={8}
            step={1}
            value={durationSeconds}
            onChange={(event) => {
              setDurationSeconds(event.target.value);
              clearCompletedPreview();
            }}
            onBlur={() => {
              setDurationSeconds(String(parseClampedNumber(
                durationSeconds,
                MIN_DURATION_SECONDS,
                MAX_DURATION_SECONDS,
                DEFAULT_DURATION_SECONDS,
              )));
            }}
            disabled={submitting}
          />
        </label>
        <label>
          FPS
          <input
            type="number"
            min={8}
            max={30}
            step={1}
            value={fps}
            onChange={(event) => {
              setFps(event.target.value);
              clearCompletedPreview();
            }}
            onBlur={() => {
              setFps(String(parseClampedNumber(fps, MIN_FPS, MAX_FPS, DEFAULT_FPS)));
            }}
            disabled={submitting}
          />
        </label>
        <button type="button" className="animation-submit-button" onClick={submit} disabled={submitting}>
          {submitting ? 'Generating preview...' : 'Animate sprite'}
        </button>
      </div>

      {submitting && (
        <div className="animation-job-status" role="status">
          Layer job running. This request is creating a short MP4 preview for the selected sprite.
        </div>
      )}

      {draftDirty && !job && !submitting && (
        <div className="animation-job-status" role="status">
          Animation settings changed. Generate a new preview for this draft.
        </div>
      )}

      {error && (
        <div className="animation-job-error">
          <strong>Animation failed.</strong> {error}
        </div>
      )}

      {job && (
        <div className="animation-preview">
          <div className="animation-job-meta">
            <div>
              <strong>{job.status === 'completed' ? 'Preview ready' : `Job ${job.status}`}</strong>
              <span>{previewLabel} · {job.durationSeconds}s at {job.fps} FPS</span>
            </div>
            <button type="button" onClick={submit} disabled={submitting}>
              Regenerate
            </button>
          </div>
          {currentPreviewUrl && (
            <div className="animation-video-frame">
              <video src={currentPreviewUrl} controls muted loop playsInline />
            </div>
          )}
          {job.status === 'failed' && job.error && (
            <div className="animation-job-error">{job.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
