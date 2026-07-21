import { useEffect, useState } from 'react';

import { type EditorStatus, loadEditorStatus } from './api.ts';
import './styles.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: EditorStatus }
  | { kind: 'failed'; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void loadEditorStatus()
      .then((status) => {
        if (active) setState({ kind: 'ready', status });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            kind: 'failed',
            message: error instanceof Error ? error.message : 'Editor bootstrap failed',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Find the Dog</p>
        <h1>Level Editor</h1>
        <p className="lede">The hermetic workspace is ready for feature migration.</p>
      </header>

      <section className="status-card" aria-live="polite">
        {state.kind === 'loading' && <p>Checking the local editor boundary…</p>}
        {state.kind === 'failed' && (
          <p className="error">Fail-closed bootstrap: {state.message}</p>
        )}
        {state.kind === 'ready' && (
          <>
            <span className="status-dot" aria-hidden="true" />
            <div>
              <strong>Provider-free fixture connected</strong>
              <p>
                {state.status.workerMode} worker · {state.status.providerMode} providers
              </p>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
