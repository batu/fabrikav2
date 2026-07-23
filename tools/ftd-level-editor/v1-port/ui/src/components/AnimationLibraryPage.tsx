import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listAnimationJobs,
  listSessions,
  listSpriteCandidates,
  type SessionListItem,
} from '../api/editorApi';
import type { AnimationJob, SpriteCandidate } from '../types';
import SpriteAnimationReviewLibrary from './SpriteAnimationReviewLibrary';
import SpriteAnimationWizard from './SpriteAnimationWizard';

interface LoadedSession {
  session: SessionListItem;
  candidates: SpriteCandidate[];
  jobs: AnimationJob[];
  error: string | null;
}

interface SpriteEntry {
  session: SessionListItem;
  candidate: SpriteCandidate;
  jobs: AnimationJob[];
}

function spriteLabel(candidate: SpriteCandidate): string {
  return `dog #${candidate.dogIndex} · sprite ${String(candidate.spriteIndex).padStart(3, '0')}`;
}

function assetBase(session: SessionListItem): 'levels' | 'public-levels' {
  return session.assetBase ?? 'levels';
}

function candidateImageUrl(session: SessionListItem, candidate: SpriteCandidate): string | null {
  if (candidate.image === null) return null;
  return `/${assetBase(session)}/${session.id}/${candidate.image}`;
}

function sessionCreatedAtMs(session: SessionListItem): number {
  const value = session.createdAt ? Date.parse(session.createdAt) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
}

function candidateSourceKey(sessionId: string, candidate: SpriteCandidate): string {
  return [
    sessionId,
    candidate.id,
    candidate.image ?? 'no-image',
    candidate.sourceVariant ?? 'no-source',
    candidate.metadataPath ?? 'no-metadata',
    candidate.width ?? 'unknown-width',
    candidate.height ?? 'unknown-height',
  ].join(':');
}

function statusLabel(candidate: SpriteCandidate): string {
  if (candidate.status === 'ready') return 'Ready';
  if (candidate.status === 'missing_image') return 'Missing image';
  if (candidate.status === 'invalid_image') return 'Invalid image';
  if (candidate.status === 'not_pickup_usable') return 'Not usable';
  return 'Invalid metadata';
}

function formatDate(value: string | undefined): string {
  if (!value) return 'unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AnimationLibraryPage() {
  const [loadedSessions, setLoadedSessions] = useState<LoadedSession[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listSessions({ includePublic: true })
      .then(async (sessions) => {
        const recentSessions = [...sessions].sort((a, b) => sessionCreatedAtMs(b) - sessionCreatedAtMs(a));
        const results = await Promise.all(recentSessions.map(async (session): Promise<LoadedSession> => {
          try {
            const [candidateResponse, jobResponse] = await Promise.all([
              listSpriteCandidates(session.id),
              listAnimationJobs(session.id),
            ]);
            return {
              session,
              candidates: candidateResponse.candidates,
              jobs: jobResponse.jobs,
              error: null,
            };
          } catch (err) {
            return {
              session,
              candidates: [],
              jobs: [],
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }));
        if (!cancelled) setLoadedSessions(results);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => refresh(), [refresh, refreshKey]);

  const spriteEntries = useMemo<SpriteEntry[]>(() => {
    const entries: SpriteEntry[] = [];
    for (const loaded of loadedSessions) {
      for (const candidate of loaded.candidates) {
        entries.push({
          session: loaded.session,
          candidate,
          jobs: loaded.jobs.filter((job) => job.sourceCandidateId === candidate.id),
        });
      }
    }
    return entries.sort((a, b) => {
      const statusRank = Number(b.candidate.status === 'ready') - Number(a.candidate.status === 'ready');
      if (statusRank !== 0) return statusRank;
      const dateRank = sessionCreatedAtMs(b.session) - sessionCreatedAtMs(a.session);
      if (dateRank !== 0) return dateRank;
      if (a.session.id !== b.session.id) return a.session.id.localeCompare(b.session.id);
      if (a.candidate.dogIndex !== b.candidate.dogIndex) return a.candidate.dogIndex - b.candidate.dogIndex;
      return a.candidate.spriteIndex - b.candidate.spriteIndex;
    });
  }, [loadedSessions]);

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return spriteEntries;
    return spriteEntries.filter(({ session, candidate }) => (
      session.id.toLowerCase().includes(needle) ||
      session.name.toLowerCase().includes(needle) ||
      (session.scene ?? '').toLowerCase().includes(needle) ||
      (session.entity ?? '').toLowerCase().includes(needle) ||
      candidate.id.toLowerCase().includes(needle)
    ));
  }, [query, spriteEntries]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (selectedKey && filteredEntries.some((entry) => `${entry.session.id}:${entry.candidate.id}` === selectedKey)) return;
    const firstReady = filteredEntries.find((entry) => entry.candidate.status === 'ready') ?? filteredEntries[0];
    setSelectedKey(`${firstReady.session.id}:${firstReady.candidate.id}`);
  }, [filteredEntries, selectedKey]);

  const selectedEntry = filteredEntries.find((entry) => `${entry.session.id}:${entry.candidate.id}` === selectedKey) ?? null;
  const readyCount = spriteEntries.filter((entry) => entry.candidate.status === 'ready').length;
  const sessionsWithSprites = loadedSessions.filter((loaded) => loaded.candidates.length > 0).length;
  const failedSessionCount = loadedSessions.filter((loaded) => loaded.error !== null).length;

  return (
    <div className="animation-page">
      <div className="animation-page-header">
        <div>
          <h2>Sprite Animations</h2>
          <p>{readyCount} ready sprites across {sessionsWithSprites} level session{sessionsWithSprites === 1 ? '' : 's'}</p>
        </div>
        <div className="animation-page-actions">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions or sprites"
            aria-label="Search animation sprites"
          />
          <button type="button" className="btn" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {failedSessionCount > 0 && (
        <div className="animation-page-warning">
          {failedSessionCount} session{failedSessionCount === 1 ? '' : 's'} could not load sprite animation metadata.
        </div>
      )}

      {loading && <div className="sprite-browser-empty">Loading generated dog sprites...</div>}
      {error && (
        <div className="sprite-browser-error">
          <strong>Could not load animation library.</strong> {error}
        </div>
      )}
      {!loading && !error && spriteEntries.length === 0 && (
        <div className="sprite-browser-empty">
          No generated dog sprites found yet. Generate dogs in the Wizard, then return here to animate them.
        </div>
      )}

      {!loading && !error && spriteEntries.length > 0 && (
        <div className="animation-page-layout">
          <aside className="animation-page-sidebar">
            <div className="animation-page-count">
              Showing {filteredEntries.length} of {spriteEntries.length} sprite candidate{spriteEntries.length === 1 ? '' : 's'}
            </div>
            <div className="animation-page-sprite-list">
              {filteredEntries.map((entry) => {
                const key = `${entry.session.id}:${entry.candidate.id}`;
                const selected = key === selectedKey;
                const ready = entry.candidate.status === 'ready';
                const imageUrl = candidateImageUrl(entry.session, entry.candidate);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`animation-page-sprite ${selected ? 'selected' : ''} ${ready ? '' : 'disabled'}`}
                    onClick={() => setSelectedKey(key)}
                  >
                    <div className="sprite-candidate-thumb">
                      {imageUrl ? <img src={imageUrl} alt={spriteLabel(entry.candidate)} /> : <span>No image</span>}
                    </div>
                    <div className="animation-page-sprite-meta">
                      <strong>{spriteLabel(entry.candidate)}</strong>
                      <span>{entry.session.name || entry.session.id}</span>
                      <span>{formatDate(entry.session.createdAt)}</span>
                      <span className={`sprite-candidate-status ${ready ? 'ready' : 'invalid'}`}>{statusLabel(entry.candidate)}</span>
                      <span>{entry.jobs.length} animation attempt{entry.jobs.length === 1 ? '' : 's'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="animation-page-detail">
            {selectedEntry && (
              <>
                <div className="animation-page-selected">
                  <div className="sprite-candidate-thumb">
                    {candidateImageUrl(selectedEntry.session, selectedEntry.candidate) ? (
                      <img
                        src={candidateImageUrl(selectedEntry.session, selectedEntry.candidate) ?? undefined}
                        alt={spriteLabel(selectedEntry.candidate)}
                      />
                    ) : (
                      <span>No image</span>
                    )}
                  </div>
                  <div>
                    <h3>{spriteLabel(selectedEntry.candidate)}</h3>
                    <p>{selectedEntry.session.name || selectedEntry.session.id}</p>
                    <p>{selectedEntry.session.scene ?? 'unknown scene'} · {selectedEntry.session.entity ?? 'dog'}</p>
                  </div>
                </div>

                {selectedEntry.candidate.status === 'ready' ? (
                  <SpriteAnimationWizard
                    key={candidateSourceKey(selectedEntry.session.id, selectedEntry.candidate)}
                    sessionId={selectedEntry.session.id}
                    candidate={selectedEntry.candidate}
                    assetBase={assetBase(selectedEntry.session)}
                    onJobCreated={() => {
                      setLibraryRefreshKey((current) => current + 1);
                      setRefreshKey((current) => current + 1);
                    }}
                  />
                ) : (
                  <div className="sprite-browser-error">
                    <strong>This sprite is not ready for animation.</strong> {selectedEntry.candidate.reason ?? statusLabel(selectedEntry.candidate)}
                  </div>
                )}

                <SpriteAnimationReviewLibrary
                  sessionId={selectedEntry.session.id}
                  selectedCandidate={selectedEntry.candidate}
                  refreshKey={libraryRefreshKey + refreshKey}
                  assetBase={assetBase(selectedEntry.session)}
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
