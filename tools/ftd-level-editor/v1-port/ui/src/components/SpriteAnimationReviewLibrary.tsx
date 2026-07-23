import { useEffect, useMemo, useState } from 'react';
import { listAnimationJobs } from '../api/editorApi';
import type { AnimationJob, AnimationReviewStatus, SpriteCandidate } from '../types';

interface Props {
  sessionId: string;
  selectedCandidate: SpriteCandidate | null;
  refreshKey: number;
  assetBase?: 'levels' | 'public-levels';
}

function previewUrl(sessionId: string, job: AnimationJob, assetBase: 'levels' | 'public-levels'): string | null {
  if (job.previewPath === null || job.previewExists === false) return null;
  return `/${assetBase}/${sessionId}/${job.previewPath}`;
}

function reviewStatus(job: AnimationJob): AnimationReviewStatus {
  if (job.reviewStatus) return job.reviewStatus;
  if (job.status === 'failed') return 'failed';
  if (job.status === 'running') return 'running';
  if (job.status === 'completed' && job.previewExists === true) return 'generated';
  return 'missing_file';
}

function statusLabel(status: AnimationReviewStatus): string {
  if (status === 'generated') return 'Generated';
  if (status === 'missing_file') return 'Missing file';
  if (status === 'failed') return 'Failed';
  return 'Running';
}

function formatDate(value: string | null): string {
  if (!value) return 'not completed';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function presetLabel(value: string | null): string {
  if (value === null || value === '') return 'Custom motion';
  return value.replaceAll('_', ' ');
}

function jobTitle(job: AnimationJob): string {
  return `${presetLabel(job.motionPreset)} · ${job.durationSeconds}s @ ${job.fps} FPS`;
}

function metadataRows(job: AnimationJob): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Status', statusLabel(reviewStatus(job))],
    ['Provider', job.provider],
    ['Model', job.model],
  ];
  if (job.providerJobId) rows.push(['Job ID', job.providerJobId]);
  rows.push(['Created', formatDate(job.createdAt)]);
  rows.push(['Completed', formatDate(job.completedAt)]);
  return rows;
}

export default function SpriteAnimationReviewLibrary({ sessionId, selectedCandidate, refreshKey, assetBase = 'levels' }: Props) {
  const [jobs, setJobs] = useState<AnimationJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualRefreshKey, setManualRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAnimationJobs(sessionId)
      .then((response) => {
        if (cancelled) return;
        setJobs(response.jobs);
        setSelectedJobId((current) => (
          current && response.jobs.some((job) => job.id === current) ? current : null
        ));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [manualRefreshKey, refreshKey, sessionId]);

  const visibleJobs = useMemo(() => {
    const filtered = selectedCandidate
      ? jobs.filter((job) => job.sourceCandidateId === selectedCandidate.id)
      : jobs;
    return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [jobs, selectedCandidate]);
  const selectedJob = visibleJobs.find((job) => job.id === selectedJobId) ?? visibleJobs[0] ?? null;

  return (
    <div className="sprite-animation-library">
      <div className="sprite-animation-library-header">
        <div>
          <h3>Animation Candidates</h3>
          <p>
            {selectedCandidate
              ? `${visibleJobs.length} saved attempt${visibleJobs.length === 1 ? '' : 's'} for selected sprite`
              : `${jobs.length} saved animation attempt${jobs.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button type="button" onClick={() => setManualRefreshKey((current) => current + 1)} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && <div className="animation-library-empty">Loading saved animation candidates...</div>}
      {error && (
        <div className="animation-job-error">
          <strong>Could not load animation candidates.</strong> {error}
        </div>
      )}
      {!loading && !error && visibleJobs.length === 0 && (
        <div className="animation-library-empty">
          No saved animation attempts for this sprite yet.
        </div>
      )}

      {!loading && !error && visibleJobs.length > 0 && (
        <div className="animation-library-layout">
          <div className="animation-library-list">
            {visibleJobs.map((job) => {
              const status = reviewStatus(job);
              return (
                <button
                  key={job.id}
                  type="button"
                  className={`animation-library-item ${selectedJob?.id === job.id ? 'selected' : ''}`}
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <span className={`animation-library-status ${status}`}>{statusLabel(status)}</span>
                  <strong>{jobTitle(job)}</strong>
                  <span>{formatDate(job.createdAt)}</span>
                  {job.providerJobId && <span>{job.providerJobId}</span>}
                </button>
              );
            })}
          </div>

          {selectedJob && (
            <div className="animation-library-detail">
              <div className="animation-job-meta">
                <div>
                  <strong>{jobTitle(selectedJob)}</strong>
                  <dl className="animation-library-metadata">
                    {metadataRows(selectedJob).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
              <div className="animation-library-prompt">
                <span>Prompt</span>
                <p>{selectedJob.prompt}</p>
                {selectedJob.customPrompt && <p>Custom direction: {selectedJob.customPrompt}</p>}
              </div>
              {previewUrl(sessionId, selectedJob, assetBase) && reviewStatus(selectedJob) === 'generated' && (
                <div className="animation-video-frame">
                  <video src={previewUrl(sessionId, selectedJob, assetBase) ?? undefined} controls muted loop playsInline />
                </div>
              )}
              {reviewStatus(selectedJob) === 'failed' && selectedJob.error && (
                <div className="animation-job-error">
                  <strong>Animation failed.</strong> {selectedJob.error}
                </div>
              )}
              {reviewStatus(selectedJob) === 'missing_file' && (
                <div className="animation-library-missing">
                  <strong>Preview file missing.</strong> This completed candidate no longer has an MP4 preview on disk.
                </div>
              )}
              {reviewStatus(selectedJob) === 'running' && (
                <div className="animation-job-status">Animation job is still running.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
