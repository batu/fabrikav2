import { useEffect, useRef, useState } from 'react';

interface PromptKindResponse {
  default_version: number;
  versions: { version: number; text: string; created_at: string }[];
}

interface Props {
  /** Stable key like `view:grounded_3_4`, `inpaint:dog`, `scene:japan.night_harbor`. */
  kind: string;
  /** Current textarea value. */
  value: string;
  /** Called when a saved default is loaded from the server on kind-change. */
  onLoadDefault?: (text: string) => void;
  /** D1 slice 2: false = load-only (editing lives in the Prompts tab). */
  showSave?: boolean;
}

export function PromptSaver({ kind, value, onLoadDefault, showSave = true }: Props) {
  const [version, setVersion] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const onLoadRef = useRef(onLoadDefault);
  const valueRef = useRef(value);
  const lastLoadedTextRef = useRef<string | null>(null);
  useEffect(() => { onLoadRef.current = onLoadDefault; }, [onLoadDefault]);
  useEffect(() => { valueRef.current = value; }, [value]);

  // Fetch latest saved default whenever `kind` changes. Prefill only when
  // safe — if the textarea is empty or still holds the previously-loaded
  // default, overwrite; otherwise preserve the user's typed edits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/prompts/${encodeURIComponent(kind)}`);
        if (!r.ok) return;
        const data: PromptKindResponse = await r.json();
        if (cancelled) return;
        setVersion(data.default_version ?? 0);
        if (data.default_version > 0 && onLoadRef.current) {
          const v = data.versions.find((x) => x.version === data.default_version);
          if (!v) return;
          const current = valueRef.current;
          const prevLoaded = lastLoadedTextRef.current;
          // Rules:
          //  - First load for this kind (prevLoaded === null): always load
          //    the saved default, replacing whatever static config default
          //    was prefilled. This is the behavior users expect from a
          //    "saved prompts" feature.
          //  - Subsequent loads (after kind changes): only overwrite if the
          //    textarea is empty or still holds the prior loaded default —
          //    preserves unsaved typed edits.
          const isFirstLoad = prevLoaded === null;
          const canOverwrite = isFirstLoad || current.trim() === '' || current === prevLoaded;
          lastLoadedTextRef.current = v.text;
          if (canOverwrite) onLoadRef.current(v.text);
        } else {
          lastLoadedTextRef.current = null;
        }
      } catch {
        // offline is fine; keep local default
      }
    })();
    return () => { cancelled = true; };
  }, [kind]);

  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
  }, []);

  const save = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/prompts/${encodeURIComponent(kind)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      if (!r.ok) throw new Error(`save failed: ${r.status}`);
      const data: PromptKindResponse = await r.json();
      setVersion(data.default_version);
      lastLoadedTextRef.current = value;
      setSavedPulse(true);
      if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => {
        setSavedPulse(false);
        pulseTimerRef.current = null;
      }, 1200);
    } catch (err) {
      console.warn('[PromptSaver] save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!showSave) return null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
      <button
        type="button"
        onClick={save}
        disabled={saving || !value.trim()}
        title={`Save prompt as new version (kind: ${kind})`}
        aria-label="Save prompt version"
        style={{
          background: savedPulse ? '#2d7a3d' : 'transparent',
          border: '1px solid #444',
          color: '#ccc',
          borderRadius: 4,
          padding: '2px 6px',
          fontSize: '0.75rem',
          cursor: saving || !value.trim() ? 'default' : 'pointer',
          lineHeight: 1,
          transition: 'background 0.2s',
        }}
      >
        {saving ? '…' : savedPulse ? '✓' : '💾'}
      </button>
      {version > 0 && (
        <span
          title={`Current default: v${version}`}
          style={{ color: '#888', fontSize: '0.7rem', fontFamily: 'monospace' }}
        >
          v{version}
        </span>
      )}
    </span>
  );
}
