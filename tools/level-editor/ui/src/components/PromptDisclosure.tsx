import { useState } from 'react';

/** Optional full-prompt display: collapsed by default, one click to see every
 *  character that will be (or was) sent to the provider. */
export function PromptDisclosure({ label, prompt }: { label: string; prompt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        className="btn"
        style={{ fontSize: '0.72rem', padding: '2px 8px' }}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? `Hide ${label}` : `Show ${label} (${prompt.length} chars)`}
      </button>
      {open && (
        <pre style={{
          whiteSpace: 'pre-wrap',
          fontSize: '0.72rem',
          background: '#161616',
          border: '1px solid #333',
          borderRadius: 4,
          padding: 8,
          marginTop: 4,
          maxHeight: 260,
          overflowY: 'auto',
        }}>{prompt}</pre>
      )}
    </div>
  );
}
