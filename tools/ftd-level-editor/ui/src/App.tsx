import { useEffect, useMemo, useState } from 'react';

import { loadEditorBootstrap, type EditorBootstrap } from './api.ts';
import { createPublishingApi, type PreparePublishingInput } from './features/publishing/api.ts';
import { PublishingPanel } from './features/publishing/PublishingPanel.tsx';
import type { PublishingCandidate } from './features/publishing/model.ts';
import './styles.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; editor: EditorBootstrap }
  | { kind: 'failed'; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadEditorBootstrap()
      .then((editor) => {
        if (active) setState({ kind: 'ready', editor });
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

  const api = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return createPublishingApi({
      fetchImpl: state.editor.fetchImpl,
      launchCredential: state.editor.launchCredential,
    });
  }, [state]);

  async function run(action: () => Promise<unknown>) {
    if (api === null || state.kind !== 'ready') return;
    setBusy(true);
    setActionError(null);
    let actionFailure: string | null = null;
    try {
      await action();
    } catch (error: unknown) {
      actionFailure = error instanceof Error ? error.message : 'Publishing action failed';
    }
    try {
      const publishing = await api.snapshot();
      setState({ kind: 'ready', editor: { ...state.editor, publishing } });
      setActionError(actionFailure);
      setBusy(false);
    } catch (error: unknown) {
      const snapshotFailure = error instanceof Error ? error.message : 'snapshot refresh failed';
      setActionError(
        `${actionFailure === null ? '' : `${actionFailure}. `}Outcome unknown: ${snapshotFailure}. Reload before another publication action.`,
      );
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Find the Dog</p>
          <h1>Level Editor</h1>
          <p className="lede">Validate immutable level packages and move one approved sequence at a time.</p>
        </div>
        <section className="status-card" aria-live="polite" aria-label="Editor connection">
          {state.kind === 'loading' && <p>Checking the local editor boundary…</p>}
          {state.kind === 'failed' && <p className="error">Fail-closed bootstrap: {state.message}</p>}
          {state.kind === 'ready' && (
            <>
              <span className="status-dot" aria-hidden="true" />
              <div>
                <strong>Local editor connected</strong>
                <p>{state.editor.status.workerMode} worker · {state.editor.status.providerMode} providers</p>
              </div>
            </>
          )}
        </section>
      </header>

      {state.kind === 'ready' && api !== null && (
        <PublishingPanel
          snapshot={state.editor.publishing}
          busy={busy}
          error={actionError}
          onPrepare={(input: PreparePublishingInput) => run(() => api.prepare(input))}
          onActivate={(candidate: PublishingCandidate, credential: string) => (
            run(() => api.activate(candidate, state.editor.publishing.remoteEnabled, credential))
          )}
          onRollback={(candidate: PublishingCandidate, credential: string) => (
            run(() => api.rollback(candidate, state.editor.publishing.remoteEnabled, credential))
          )}
          onReconcile={(sagaId: string) => run(() => api.reconcile(sagaId))}
        />
      )}
    </main>
  );
}
