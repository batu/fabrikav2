import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * PROMPTS tab (plan 2026-06-10-002, D1): the central editing surface for the
 * versioned prompt library (`prompts_library.json`). Kinds are namespaced
 * (`inpaint:default`, `view:isometric`, `style:flatvector`, `scene:*`); each
 * has an append-only version list + a default pointer. This page replaces
 * scattered per-step textarea editing — Configure keeps selectors only (D1
 * slice 2 strips its textareas once generation reads library defaults).
 */

interface PromptVersion {
  version: number;
  text: string;
  created_at: string;
}

interface PromptKind {
  default_version: number;
  versions: PromptVersion[];
}

type Library = Record<string, PromptKind>;

async function fetchLibrary(): Promise<Library> {
  const r = await fetch('/api/prompts');
  if (!r.ok) throw new Error(`Failed to load prompt library (${r.status})`);
  return r.json() as Promise<Library>;
}

async function saveVersion(kind: string, text: string): Promise<PromptKind> {
  const r = await fetch(`/api/prompts/${encodeURIComponent(kind)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`Save failed (${r.status})`);
  return r.json() as Promise<PromptKind>;
}

async function setDefault(kind: string, version: number): Promise<PromptKind> {
  const r = await fetch(`/api/prompts/${encodeURIComponent(kind)}/default`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
  if (!r.ok) throw new Error(`Set default failed (${r.status})`);
  return r.json() as Promise<PromptKind>;
}

function namespaceOf(kind: string): string {
  const i = kind.indexOf(':');
  return i > 0 ? kind.slice(0, i) : kind;
}

export default function PromptsPage() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftBase, setDraftBase] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    fetchLibrary()
      .then(setLibrary)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const kindsByNamespace = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const kind of Object.keys(library ?? {})) {
      const ns = namespaceOf(kind);
      g.set(ns, [...(g.get(ns) ?? []), kind]);
    }
    return Array.from(g.entries());
  }, [library]);

  const selected = selectedKind && library ? library[selectedKind] : null;
  const defaultVersion = selected?.versions.find((v) => v.version === selected.default_version) ?? null;

  const openKind = useCallback((kind: string) => {
    setSelectedKind(kind);
    setStatus(null);
    const k = library?.[kind];
    const def = k?.versions.find((v) => v.version === k.default_version);
    setDraft(def?.text ?? '');
    setDraftBase(def?.version ?? null);
  }, [library]);

  const handleSave = useCallback(async () => {
    if (!selectedKind || !draft.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const updated = await saveVersion(selectedKind, draft);
      setLibrary((prev) => (prev ? { ...prev, [selectedKind]: updated } : prev));
      setDraftBase(updated.default_version);
      setStatus(`✓ Saved as v${updated.default_version} (now default)`);
    } catch (e) {
      setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedKind, draft, busy]);

  const handleSetDefault = useCallback(async (version: number) => {
    if (!selectedKind || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const updated = await setDefault(selectedKind, version);
      setLibrary((prev) => (prev ? { ...prev, [selectedKind]: updated } : prev));
      setStatus(`✓ v${version} is now the default`);
    } catch (e) {
      setStatus(`Set default failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [selectedKind, busy]);

  if (error) {
    return (
      <div className="prompts-page" data-testid="prompts-page-error" style={{ padding: 24 }}>
        <p>Failed to load the prompt library: {error}</p>
        <button className="btn" onClick={reload}>Retry</button>
      </div>
    );
  }
  if (!library) {
    return <div className="prompts-page" style={{ padding: 24 }}><div className="loading-spinner" /> Loading prompt library…</div>;
  }

  return (
    <div className="prompts-page" data-testid="prompts-page" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: 16 }}>
      <aside style={{ minWidth: 260, maxWidth: 320 }}>
        <h2 style={{ marginTop: 0 }}>Prompt library</h2>
        {kindsByNamespace.map(([ns, kinds]) => (
          <section key={ns} style={{ marginBottom: 12 }}>
            <h3 style={{ margin: '8px 0 4px', fontSize: '0.85rem', opacity: 0.7, textTransform: 'uppercase' }}>{ns}</h3>
            {kinds.map((kind) => (
              <button
                key={kind}
                className={kind === selectedKind ? 'btn btn-primary' : 'btn'}
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4, fontSize: '0.85rem' }}
                onClick={() => openKind(kind)}
                data-testid={`prompt-kind-${kind}`}
              >
                {kind}
                <span style={{ float: 'right', opacity: 0.6 }}>v{library[kind].default_version}</span>
              </button>
            ))}
          </section>
        ))}
        {Object.keys(library).length === 0 && <p>No prompts saved yet — the 💾 buttons in Configure seed this library.</p>}
      </aside>

      {selected && selectedKind ? (
        <main style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ marginTop: 0 }}>
            <code>{selectedKind}</code>
            <span style={{ fontSize: '0.8rem', opacity: 0.6, marginLeft: 8 }}>
              {selected.versions.length} version{selected.versions.length === 1 ? '' : 's'} · default v{selected.default_version}
            </span>
          </h2>
          <textarea
            className="prompt-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.82rem' }}
            data-testid="prompt-editor"
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={busy || !draft.trim() || draft === (defaultVersion?.text ?? '')}
              title="Append as a new version and make it the default"
              data-testid="prompt-save"
            >
              💾 Save as v{(selected.versions.at(-1)?.version ?? 0) + 1}
            </button>
            {draftBase !== null && <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>editing from v{draftBase}</span>}
            {status && <span style={{ fontSize: '0.85rem' }}>{status}</span>}
          </div>

          <h3 style={{ marginTop: 20 }}>History</h3>
          {[...selected.versions].reverse().map((v) => (
            <details key={v.version} style={{ marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer' }}>
                v{v.version}
                {v.version === selected.default_version && <strong> · default</strong>}
                <span style={{ opacity: 0.6 }}> · {new Date(v.created_at).toLocaleString()}</span>
                {v.version !== selected.default_version && (
                  <button
                    className="btn"
                    style={{ marginLeft: 8, fontSize: '0.75rem' }}
                    disabled={busy}
                    onClick={(e) => { e.preventDefault(); void handleSetDefault(v.version); }}
                  >
                    make default
                  </button>
                )}
                <button
                  className="btn"
                  style={{ marginLeft: 8, fontSize: '0.75rem' }}
                  onClick={(e) => { e.preventDefault(); setDraft(v.text); setDraftBase(v.version); setStatus(null); }}
                >
                  load into editor
                </button>
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.78rem', background: '#111', padding: 8, borderRadius: 4 }}>{v.text}</pre>
            </details>
          ))}
        </main>
      ) : (
        <main style={{ flex: 1, opacity: 0.7, paddingTop: 40 }}>
          <p>Select a prompt kind to view and edit its versions.</p>
        </main>
      )}
    </div>
  );
}
