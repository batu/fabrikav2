import { useEffect, useSyncExternalStore } from 'react';

import { defaultWorkspaceOwner, type WorkspaceOwner } from './domain/workspaceOwner.ts';

export interface AppProps { readonly workspaceOwner?: WorkspaceOwner }

export function App({ workspaceOwner = defaultWorkspaceOwner }: AppProps): React.JSX.Element {
  const workspace = workspaceOwner.current();
  const store = workspace.store;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => workspace.attach(), [workspace]);

  return (
    <main className="editor-shell">
      <header className="editor-shell__header">
        <div>
          <p>Marble Run</p>
          <h1>Difficulty editor</h1>
        </div>
        <p className="editor-shell__state">{state.phase}</p>
      </header>
      <section aria-label="Editor workspace">
        <h2>Journey</h2>
        <p>Level {state.selectedLevelId} is selected.</p>
      </section>
    </main>
  );
}
