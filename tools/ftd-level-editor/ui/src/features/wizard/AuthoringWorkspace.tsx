import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  JobResource,
  SessionSnapshotResponse,
} from '../../api/generated.ts';
import {
  createJobsTransport,
  requestFtd,
  requestFtdBinary,
  type JobsTransportOptions,
} from '../../api/http.ts';
import { startBackgroundGeneration } from './durableStarts.ts';

interface GallerySession {
  session_id: string;
  revision: string;
  dog_count: number;
  tags: string[];
  archived: boolean;
}

interface GalleryItem {
  sessionId: string;
  job: JobResource;
  imageUrl: string | null;
}

interface PromptCatalog {
  scenes: string[];
  styles: string[];
  views: string[];
}

interface Props {
  context: JobsTransportOptions;
}

function requestId(): string {
  return `ui-${crypto.randomUUID()}`;
}

export function AuthoringWorkspace({ context }: Props) {
  const transport = useMemo(() => createJobsTransport(context), [context]);
  const [sessions, setSessions] = useState<GallerySession[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [catalog, setCatalog] = useState<PromptCatalog | null>(null);
  const [scene, setScene] = useState('japan_morning_market');
  const [style, setStyle] = useState('clean_old_cartoon');
  const [view, setView] = useState('isometric');
  const [levelId, setLevelId] = useState('');
  const [activeJob, setActiveJob] = useState<JobResource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [listed, promptCatalog] = await Promise.all([
      requestFtd<GallerySession[]>(context, 'GET', '/api/sessions'),
      requestFtd<PromptCatalog>(context, 'GET', '/api/prompts/catalog'),
    ]);
    setCatalog(promptCatalog);
    setSessions(listed);
    const next: GalleryItem[] = [];
    for (const session of listed) {
      const jobs = await transport.listJobs({ sessionId: session.session_id });
      for (const job of jobs.filter((item) => item.kind === 'ftd.background_generate')) {
        const artifact = job.artifacts.find((item) => item.mediaType.startsWith('image/'));
        let imageUrl: string | null = null;
        if (artifact) {
          const response = await requestFtdBinary(
            context,
            'GET',
            transport.artifactUrl(job.jobId, artifact.artifactId),
          );
          imageUrl = URL.createObjectURL(response.blob);
        }
        next.push({ sessionId: session.session_id, job, imageUrl });
      }
    }
    setGallery((previous) => {
      for (const item of previous) {
        if (item.imageUrl) URL.revokeObjectURL(item.imageUrl);
      }
      return next;
    });
  }, [context, transport]);

  useEffect(() => {
    void refresh().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'Could not load rehearsal sessions');
    });
  }, [refresh]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const id = levelId.trim() || `rehearsal-${Date.now()}`;
      let snapshot: SessionSnapshotResponse;
      const existing = sessions.find((item) => item.session_id === id);
      if (existing) {
        snapshot = await requestFtd<SessionSnapshotResponse>(
          context,
          'GET',
          `/api/sessions/${encodeURIComponent(id)}`,
        );
      } else {
        snapshot = await requestFtd<SessionSnapshotResponse>(
          context,
          'POST',
          '/api/sessions',
          { session: { id, dogs: [], sceneIntent: { scene, style, view } } },
        );
      }
      const started = await startBackgroundGeneration(
        {
          transport,
          sessionId: id,
          revision: snapshot.revision,
          requestId: requestId(),
        },
        { sceneIntent: { scene, style, view } },
      );
      setActiveJob(started.job);
      const terminal = await started.observer.run(
        (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      );
      setActiveJob(terminal.job);
      if (terminal.job?.status !== 'succeeded') {
        throw new Error(terminal.job?.error?.message || `Generation ended as ${terminal.job?.status}`);
      }
      await refresh();
      setLevelId('');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="authoring-workspace" aria-label="Level authoring rehearsal">
      <div className="authoring-form">
        <p className="eyebrow">Real-data rehearsal</p>
        <h2>Create one scene</h2>
        <p className="muted">Writes only to the isolated v2 rehearsal workspace.</p>
        <label>
          Level ID
          <input value={levelId} onChange={(event) => setLevelId(event.target.value)} placeholder="automatic rehearsal ID" />
        </label>
        <label>
          Scene
          <select value={scene} onChange={(event) => setScene(event.target.value)}>
            {(catalog?.scenes ?? [scene]).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <div className="authoring-pair">
          <label>
            Style
            <select value={style} onChange={(event) => setStyle(event.target.value)}>
              {(catalog?.styles ?? [style]).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
          <label>
            View
            <select value={view} onChange={(event) => setView(event.target.value)}>
              {(catalog?.views ?? [view]).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
        </div>
        <button className="primary-action" disabled={busy} onClick={() => void generate()}>
          {busy ? 'Generating…' : 'Generate real scene'}
        </button>
        {activeJob && (
          <p className="job-status" aria-live="polite">
            {activeJob.status} · {activeJob.stage}
          </p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div className="rehearsal-gallery">
        <div className="gallery-heading">
          <div>
            <p className="eyebrow">Gallery</p>
            <h2>Generated scenes</h2>
          </div>
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
        {gallery.length === 0 ? (
          <p className="empty-state">No v2 rehearsal images yet.</p>
        ) : (
          <div className="gallery-grid">
            {gallery.map((item) => (
              <article className="gallery-card" key={item.job.jobId}>
                {item.imageUrl ? <img src={item.imageUrl} alt={`Generated scene ${item.sessionId}`} /> : <div className="image-placeholder" />}
                <div>
                  <strong>{item.sessionId}</strong>
                  <p>{item.job.status} · {item.job.artifacts.length} artifact</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
