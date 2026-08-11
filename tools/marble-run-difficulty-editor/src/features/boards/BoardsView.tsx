import type { ExpandedDifficultyLevel } from '../../../../../games/marble_run/src/levels/difficulty-expand.ts';
import type { LevelDef } from '../../../../../games/marble_run/src/marble-board/types.ts';
import type { EditorWorkspaceState } from '../../domain/draftStore.ts';
import { BoardThumbnail } from './BoardThumbnail.tsx';

interface BoardsViewProps {
  readonly state: EditorWorkspaceState;
  readonly expanded: readonly ExpandedDifficultyLevel[];
  readonly measurements: Readonly<Record<number, number>>;
  readonly onSelect: (levelId: number) => void;
  readonly playRequest: number | null;
}

function exceptionalStatus(state: EditorWorkspaceState, levelId: number, overrideState: ExpandedDifficultyLevel['overrideState']): string | null {
  const generation = state.levelStates[levelId];
  if (generation === 'Generating' || generation === 'Needs attention') return generation;
  if (overrideState === 'locked') return 'Locked';
  if (overrideState === 'overridden') return 'Overridden';
  return null;
}

export function BoardsView({ state, expanded, measurements, onSelect, playRequest }: BoardsViewProps): React.JSX.Element {
  return (
    <section className="boards-view" aria-labelledby="boards-title">
      <div className="section-heading">
        <div><p className="eyebrow">Reading 02</p><h2 id="boards-title">Boards</h2></div>
        <p>Scan the generated campaign. Select any board to play it.</p>
      </div>
      {playRequest !== null && <div className="play-seam" role="status">Play level {playRequest} · Preview opens here in the next delivery unit.</div>}
      <div className="boards-overflow" data-board-scroll>
        <div className="boards-grid">
          {expanded.map((level) => {
            const board = state.boards[level.id] as LevelDef;
            const status = exceptionalStatus(state, level.id, level.overrideState);
            const measured = state.accepted[level.id]?.evidence.measuredDifficulty ?? measurements[level.id];
            return (
              <button
                className="board-item"
                data-board-level={level.id}
                key={level.id}
                onClick={() => onSelect(level.id)}
                aria-label={`Level ${level.id}, difficulty ${measured?.toFixed(1) ?? 'not measured'}${status === null ? '' : `, ${status}`}`}
              >
                <BoardThumbnail board={board} />
                <span className="board-item__meta"><strong>{level.id}</strong><span>{measured?.toFixed(1) ?? `${level.targetRange.min.toFixed(1)}–${level.targetRange.max.toFixed(1)}`}</span></span>
                {status !== null && <span className={`status-mark status-mark--${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
