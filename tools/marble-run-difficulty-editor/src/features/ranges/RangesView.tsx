import { inheritedLevelIdsForBaseSlot, type DifficultyDraft } from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';
import type { ExpandedDifficultyLevel } from '../../../../../games/marble_run/src/levels/difficulty-expand.ts';
import type { EditorWorkspaceState } from '../../domain/draftStore.ts';

interface RangesViewProps {
  readonly state: EditorWorkspaceState;
  readonly draft: DifficultyDraft;
  readonly expanded: readonly ExpandedDifficultyLevel[];
  readonly measurements: Readonly<Record<number, number>>;
  readonly onSelect: (levelId: number) => void;
}

export function RangesView({ state, draft, expanded, measurements, onSelect }: RangesViewProps): React.JSX.Element {
  const selected = expanded[state.selectedLevelId - 1]!;
  const linked = selected.baseCycleSlot === null ? [selected.id] : inheritedLevelIdsForBaseSlot(draft, selected.baseCycleSlot);
  return (
    <section aria-labelledby="ranges-title">
      <div className="section-heading">
        <div><p className="eyebrow">Reading 01</p><h2 id="ranges-title">Ranges</h2></div>
        <p>Every authored interval against its generated result, from difficulty 1 to 20.</p>
      </div>
      <div className="range-chart" aria-label="All 110 level difficulty ranges">
        <div className="range-chart__scale" aria-hidden="true"><span>20</span><span>10</span><span>1</span></div>
        <div className="range-chart__levels">
          {expanded.map((level) => {
            const evidence = state.accepted[level.id]?.evidence;
            const measured = evidence?.measuredDifficulty ?? measurements[level.id];
            const passes = measured !== undefined && measured >= level.targetRange.min && measured <= level.targetRange.max;
            return (
              <button
                type="button"
                key={level.id}
                data-range-level={level.id}
                className={`range-mark${state.selectedLevelId === level.id ? ' is-selected' : ''}`}
                style={{ '--range-min': String(level.targetRange.min), '--range-max': String(level.targetRange.max), '--measured': String(measured ?? (level.targetRange.min + level.targetRange.max) / 2) } as React.CSSProperties}
                aria-label={`Level ${level.id}, range ${level.targetRange.min.toFixed(1)} to ${level.targetRange.max.toFixed(1)}, measured ${measured?.toFixed(1) ?? 'pending'}`}
                title={`Level ${level.id} · ${level.targetRange.min.toFixed(1)}–${level.targetRange.max.toFixed(1)} · measured ${measured?.toFixed(1) ?? 'pending'}`}
                onClick={() => onSelect(level.id)}
              >
                <span className="range-mark__interval" />
                <span className={`range-mark__notch${measured !== undefined && !passes ? ' is-failure' : ''}`} />
                <span className="range-mark__number">{level.id}</span>
              </button>
            );
          })}
        </div>
      </div>
      <aside className="range-selection" aria-live="polite">
        <div><span className="eyebrow">Selected</span><strong>Level {selected.id}</strong><span>{selected.targetRange.min.toFixed(1)}–{selected.targetRange.max.toFixed(1)}</span></div>
        <div><span>Role</span><strong>{selected.role}</strong></div>
        <div><span>Applied progression</span><strong>{selected.cycleOffset === 0 ? 'None' : `+${selected.cycleOffset}`}</strong></div>
        <div><span>Base Cycle slot</span><strong>{selected.baseCycleSlot === null ? 'Individual' : selected.baseCycleSlot + 1}</strong></div>
        <div className="range-selection__wide"><span>Linked occurrences · {linked.length} affected</span><strong>{linked.join(', ')}</strong></div>
      </aside>
    </section>
  );
}
