import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { expandDifficultyDraft } from '../../../games/marble_run/src/levels/difficulty-expand.ts';

import { defaultWorkspaceOwner, type WorkspaceOwner } from './domain/workspaceOwner.ts';
import { DifficultyGuide } from './features/help/DifficultyGuide.tsx';
import { DifficultyModelDrawer } from './features/journey/DifficultyModelDrawer.tsx';
import { JourneyView, type JourneyReading } from './features/journey/JourneyView.tsx';
import { LevelView } from './features/level/LevelView.tsx';
import { SHIPPED_MEASURED_DIFFICULTY } from './features/measurements.ts';

export interface AppProps { readonly workspaceOwner?: WorkspaceOwner }

export function App({ workspaceOwner = defaultWorkspaceOwner }: AppProps): React.JSX.Element {
  const workspace = workspaceOwner.current();
  const store = workspace.store;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [primaryView, setPrimaryView] = useState<'journey' | 'level'>('journey');
  const [reading, setReading] = useState<JourneyReading>('author');
  const [drawer, setDrawer] = useState<'model' | 'guide' | null>(null);
  const [playRequest, setPlayRequest] = useState<number | null>(null);
  const expanded = useMemo(() => expandDifficultyDraft(state.draft), [state.draft]);
  const measurements = useMemo(() => Object.fromEntries(expanded.map(({ id }) => [id, state.accepted[id]?.evidence.measuredDifficulty ?? SHIPPED_MEASURED_DIFFICULTY[id - 1]!])), [expanded, state.accepted]);

  useEffect(() => workspace.attach(), [workspace]);

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <div className="editor-title"><span>Marble Run</span><h1>Difficulty editor</h1></div>
        <nav className="primary-nav" aria-label="Primary">
          <button data-primary-view="journey" aria-current={primaryView === 'journey' ? 'page' : undefined} onClick={() => setPrimaryView('journey')}>Journey</button>
          <button data-primary-view="level" aria-current={primaryView === 'level' ? 'page' : undefined} onClick={() => setPrimaryView('level')}>Level</button>
        </nav>
        <div className="header-actions"><span className="editor-shell__state"><i />{state.phase}</span><button className="text-action" data-action="model" onClick={() => setDrawer('model')}>Difficulty model</button><button className="guide-action" data-action="guide" aria-label="Open difficulty guide" onClick={() => setDrawer('guide')}>?</button></div>
      </header>
      {primaryView === 'journey' ? <JourneyView state={state} draft={state.draft} expanded={expanded} measurements={measurements} reading={reading} onReading={setReading} onEdit={(draft) => workspace.edit(draft)} onSelect={(id) => { store.selectLevel(id); if (reading === 'boards') setPlayRequest(id); }} playRequest={playRequest} /> : <LevelView state={state} draft={state.draft} level={expanded[state.selectedLevelId - 1]!} onEdit={(draft) => workspace.edit(draft)} onPlay={setPlayRequest} />}
      {drawer === 'model' && <DifficultyModelDrawer draft={state.draft} onEdit={(draft) => workspace.edit(draft)} onClose={() => setDrawer(null)} />}
      {drawer === 'guide' && <DifficultyGuide onClose={() => setDrawer(null)} />}
    </main>
  );
}
