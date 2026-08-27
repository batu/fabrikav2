import type { DifficultyDraft } from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';
import type { ExpandedDifficultyLevel } from '../../../../../games/marble_run/src/levels/difficulty-expand.ts';
import type { EditorWorkspaceState } from '../../domain/draftStore.ts';
import { BoardsView } from '../boards/BoardsView.tsx';
import { RangesView } from '../ranges/RangesView.tsx';
import { PatternEditor } from './PatternEditor.tsx';

export type JourneyReading = 'author' | 'ranges' | 'boards';
interface JourneyProps {
  readonly state: EditorWorkspaceState; readonly draft: DifficultyDraft; readonly expanded: readonly ExpandedDifficultyLevel[];
  readonly measurements: Readonly<Record<number, number>>;
  readonly reading: JourneyReading; readonly onReading: (view: JourneyReading) => void; readonly onEdit: (draft: DifficultyDraft) => void;
  readonly onSelect: (id: number) => void;
}

export function JourneyView(props: JourneyProps): React.JSX.Element {
  return (
    <div className="journey-view">
      <nav className="reading-nav" aria-label="Journey views">
        <button data-view="author" aria-current={props.reading === 'author' ? 'page' : undefined} onClick={() => props.onReading('author')}>Pattern</button>
        <button data-view="ranges" aria-current={props.reading === 'ranges' ? 'page' : undefined} onClick={() => props.onReading('ranges')}>Ranges</button>
        <button data-view="boards" aria-current={props.reading === 'boards' ? 'page' : undefined} onClick={() => props.onReading('boards')}>Boards</button>
      </nav>
      {props.reading === 'author' && <PatternEditor draft={props.draft} onEdit={props.onEdit} />}
      {props.reading === 'ranges' && <RangesView state={props.state} draft={props.draft} expanded={props.expanded} measurements={props.measurements} onSelect={props.onSelect} />}
      {props.reading === 'boards' && <BoardsView state={props.state} expanded={props.expanded} measurements={props.measurements} onSelect={props.onSelect} />}
    </div>
  );
}
