import { useCallback, useEffect, useRef, useState } from 'react';

const APPROACHES = [
  { id: 'crop', label: 'Crop inpaint', blurb: 'per-bird crops, the production path' },
  { id: 'magenta', label: 'Magenta overlay', blurb: 'one whole-image call, all birds at once' },
] as const;

type ApproachId = (typeof APPROACHES)[number]['id'];

interface ComparisonEntry {
  mode: string;
  sessionId: string;
  jobId: string;
  status?: string;
  error?: string | null;
}

/** Queue any subset of the three inpaint approaches; each runs in an isolated
 *  clone of this session so the results can be compared side by side. */
export function ComparePanel({ sessionId }: { sessionId: string }) {
  const [selected, setSelected] = useState<Record<ApproachId, boolean>>({
    crop: true,
    magenta: true,
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonEntry[]>([]);
  const pollRef = useRef<number | null>(null);

  const chosen = APPROACHES.filter((approach) => selected[approach.id]);

  const poll = useCallback(async (entries: ComparisonEntry[]) => {
    const next = await Promise.all(entries.map(async (entry) => {
      if (entry.status === 'succeeded' || entry.status === 'failed_terminal') return entry;
      try {
        const response = await fetch(`/api/jobs/${entry.jobId}`);
        if (!response.ok) return entry;
        const job = await response.json();
        return { ...entry, status: job.status, error: job.errorMessage ?? null };
      } catch {
        return entry;
      }
    }));
    setComparisons(next);
    const unfinished = next.some((entry) => !['succeeded', 'failed_terminal', 'failed_retryable', 'cancelled'].includes(entry.status ?? ''));
    if (unfinished) {
      pollRef.current = window.setTimeout(() => { void poll(next); }, 3000);
    }
  }, []);

  useEffect(() => () => { if (pollRef.current !== null) window.clearTimeout(pollRef.current); }, []);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/compare-inpaint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modes: chosen.map((a) => a.id) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail?.error ?? body?.error ?? `HTTP ${response.status}`);
      }
      const body = await response.json();
      setComparisons(body.comparisons);
      void poll(body.comparisons);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed to start');
    } finally {
      setRunning(false);
    }
  }, [chosen, poll, sessionId]);

  return (
    <div className="compare-panel" style={{ border: '1px solid #333', borderRadius: 6, padding: 12, marginTop: 12 }}>
      <strong>Compare inpaint approaches</strong>
      <p style={{ color: '#999', fontSize: '0.8rem', margin: '4px 0 8px' }}>
        Each selected approach runs in its own clone of this session (shared background and
        hitboxes) — nothing here touches the current session's birds.
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {APPROACHES.map((approach) => (
          <label key={approach.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <input
              type="checkbox"
              checked={selected[approach.id]}
              onChange={(e) => setSelected((current) => ({ ...current, [approach.id]: e.target.checked }))}
            />
            <span>{approach.label} <em style={{ color: '#888', fontSize: '0.75rem' }}>{approach.blurb}</em></span>
          </label>
        ))}
      </div>
      <button
        className="btn"
        style={{ marginTop: 8 }}
        disabled={running || chosen.length === 0}
        onClick={() => void start()}
      >
        {running ? 'Queuing…' : `Run comparison (${chosen.length})`}
      </button>
      {error !== null && <div style={{ color: '#ff9c9c', fontSize: '0.8rem', marginTop: 6 }}>{error}</div>}
      {comparisons.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          {comparisons.map((entry) => (
            <div key={entry.mode} style={{ width: 180, border: '1px solid #333', borderRadius: 6, padding: 8 }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{entry.mode}</div>
              <div style={{ fontSize: '0.75rem', color: entry.status === 'succeeded' ? '#8fdc9a' : entry.error ? '#ff9c9c' : '#ccc' }}>
                {entry.status ?? 'queued'}{entry.error ? ` — ${entry.error.slice(0, 80)}` : ''}
              </div>
              {entry.status === 'succeeded' && (
                <>
                  <img
                    src={`/levels/${entry.sessionId}/color.png?ts=${entry.jobId}`}
                    alt={`${entry.mode} result`}
                    style={{ width: '100%', borderRadius: 4, marginTop: 6 }}
                  />
                  <a
                    className="btn"
                    style={{ display: 'block', textAlign: 'center', marginTop: 6, fontSize: '0.75rem' }}
                    href={`#batch=${entry.sessionId}`}
                    onClick={() => { window.location.hash = `#batch=${entry.sessionId}`; window.location.reload(); }}
                  >
                    Open in Wizard
                  </a>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
