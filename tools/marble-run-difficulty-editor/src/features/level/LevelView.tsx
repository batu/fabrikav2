import type { DifficultyDraft, DifficultyRange, LevelOverride, OverrideField } from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';
import type { ExpandedDifficultyLevel } from '../../../../../games/marble_run/src/levels/difficulty-expand.ts';
import type { EditorWorkspaceState } from '../../domain/draftStore.ts';
import { BoardThumbnail } from '../boards/BoardThumbnail.tsx';

interface LevelViewProps {
  readonly state: EditorWorkspaceState; readonly draft: DifficultyDraft; readonly level: ExpandedDifficultyLevel;
  readonly onEdit: (draft: DifficultyDraft) => void; readonly onPlay: (id: number) => void;
}

export function LevelView({ state, draft, level, onEdit, onPlay }: LevelViewProps): React.JSX.Element {
  const override = draft.overrides.find(({ levelId }) => levelId === level.id);
  const lock = draft.locks.find(({ levelId }) => levelId === level.id);
  const evidence = state.accepted[level.id]?.evidence;
  const source = level.id <= 11 ? 'onboarding' : level.baseCycleSlot === null ? 'first-cycle opening' : `Base Cycle slot ${level.baseCycleSlot + 1}`;
  const setOverride = (targetRange: DifficultyRange) => {
    const next: LevelOverride = { levelId: level.id, replaces: [...new Set([...(override?.replaces ?? []), 'targetRange' as const])], values: { ...(override?.values ?? {}), targetRange } };
    onEdit({ ...draft, overrides: [...draft.overrides.filter(({ levelId }) => levelId !== level.id), next].sort((a, b) => a.levelId - b.levelId) });
  };
  const setAdvanced = (field: OverrideField, key: string, value: unknown) => {
    const next: LevelOverride = { levelId: level.id, replaces: [...new Set([...(override?.replaces ?? []), field])], values: { ...(override?.values ?? {}), [key]: value } };
    onEdit({ ...draft, overrides: [...draft.overrides.filter(({ levelId }) => levelId !== level.id), next].sort((a, b) => a.levelId - b.levelId) });
  };
  const reset = () => onEdit({ ...draft, overrides: draft.overrides.filter(({ levelId }) => levelId !== level.id) });
  const lockLevel = () => onEdit({ ...draft, locks: [...draft.locks.filter(({ levelId }) => levelId !== level.id), { levelId: level.id, reason: 'Accepted by designer' }].sort((a, b) => a.levelId - b.levelId) });
  const unlock = () => onEdit({ ...draft, locks: draft.locks.filter(({ levelId }) => levelId !== level.id) });
  const range = override?.values.targetRange as DifficultyRange | undefined ?? level.targetRange;
  return (
    <section className="level-view" aria-labelledby="level-title">
      <div className="level-heading"><div><p className="eyebrow">Focused exception</p><h2 id="level-title">Level {level.id}</h2><p>{level.id === 1 && state.revision === 0 ? 'Default selection · ' : ''}{override === undefined ? `Inherited from ${source}` : `Detached from Journey · replaces ${override.replaces.join(', ')}`}</p></div><button className="primary-action" onClick={() => onPlay(level.id)}>Play level</button></div>
      <div className="level-workspace">
        <div className="level-board"><BoardThumbnail board={state.boards[level.id]!} /></div>
        <div className="level-controls">
          {lock !== undefined && <p className="exception-note"><strong>Locked board</strong><span>{lock.reason}. Reset and inherited regeneration leave this board unchanged.</span></p>}
          <div className="evidence-line"><span>Target {level.targetRange.min.toFixed(1)}–{level.targetRange.max.toFixed(1)}</span><span>Measured {evidence?.measuredDifficulty.toFixed(1) ?? 'pending'}</span><span>{evidence?.marbleCount ?? state.boards[level.id]!.cells.join('').match(/[RBGYPO]/g)?.length ?? 0} marbles</span><span>{evidence?.solverWaves ?? '—'} waves</span></div>
          {override === undefined ? <button className="secondary-action" data-action="override" onClick={() => setOverride(level.targetRange)}>Override this level</button> : (
            <fieldset className="override-fields"><legend>Target override</legend><label>Minimum<input type="number" min="1" max={range.max} step="0.5" value={range.min} onChange={(event) => setOverride({ ...range, min: Number(event.target.value) })} /></label><label>Maximum<input type="number" min={range.min} max="20" step="0.5" value={range.max} onChange={(event) => setOverride({ ...range, max: Number(event.target.value) })} /></label><button className="text-action" data-action="reset" onClick={reset}>Return to Journey inheritance</button></fieldset>
          )}
          <div className="lock-action">{lock === undefined ? <button className="text-action" data-action="lock" onClick={lockLevel}>Lock accepted board</button> : <button className="text-action" data-action="unlock" onClick={unlock}>Unlock board</button>}</div>
          <details className="advanced"><summary>Advanced level controls</summary><div className="advanced__grid">
            <label>Columns<input aria-label="Override columns" type="number" min="4" max="20" value={(override?.values.dimensions as { cols: number; rows: number } | undefined)?.cols ?? state.boards[level.id]!.cols} onChange={(event) => setAdvanced('dimensions', 'dimensions', { cols: Number(event.target.value), rows: (override?.values.dimensions as { rows?: number } | undefined)?.rows ?? state.boards[level.id]!.rows })} /></label>
            <label>Rows<input aria-label="Override rows" type="number" min="4" max="20" value={(override?.values.dimensions as { cols: number; rows: number } | undefined)?.rows ?? state.boards[level.id]!.rows} onChange={(event) => setAdvanced('dimensions', 'dimensions', { cols: (override?.values.dimensions as { cols?: number } | undefined)?.cols ?? state.boards[level.id]!.cols, rows: Number(event.target.value) })} /></label>
            <label>Gate side<select aria-label="Override gate side" value={(override?.values.gatePlacement as readonly { side: string; index: number }[] | undefined)?.[0]?.side ?? state.boards[level.id]!.gates[0]?.side ?? 'top'} onChange={(event) => setAdvanced('gatePlacement', 'gatePlacement', [{ side: event.target.value, index: (override?.values.gatePlacement as readonly { index: number }[] | undefined)?.[0]?.index ?? state.boards[level.id]!.gates[0]?.index ?? 0 }])}><option value="top">Top</option><option value="right">Right</option><option value="bottom">Bottom</option><option value="left">Left</option></select></label>
            <label>Gate index<input aria-label="Override gate index" type="number" min="0" max="19" value={(override?.values.gatePlacement as readonly { side: string; index: number }[] | undefined)?.[0]?.index ?? state.boards[level.id]!.gates[0]?.index ?? 0} onChange={(event) => setAdvanced('gatePlacement', 'gatePlacement', [{ side: (override?.values.gatePlacement as readonly { side: string }[] | undefined)?.[0]?.side ?? state.boards[level.id]!.gates[0]?.side ?? 'top', index: Number(event.target.value) }])} /></label>
            <label>Marble cap<input aria-label="Override marble cap" type="number" min="1" max="160" value={(override?.values.caps as { marbles?: number } | undefined)?.marbles ?? Math.round(level.resolvedMappings.marbleCount)} onChange={(event) => setAdvanced('caps', 'caps', { ...(override?.values.caps as object | undefined), marbles: Number(event.target.value) })} /></label>
            <label>Color cap<input aria-label="Override color cap" type="number" min="2" max="6" value={(override?.values.caps as { colors?: number } | undefined)?.colors ?? Math.round(level.resolvedMappings.colorCount)} onChange={(event) => setAdvanced('caps', 'caps', { ...(override?.values.caps as object | undefined), colors: Number(event.target.value) })} /></label>
            <label>Symmetry<select aria-label="Override symmetry" value={override?.values.symmetryMode as string | undefined ?? 'asymmetric'} onChange={(event) => setAdvanced('symmetryMode', 'symmetryMode', event.target.value)}><option value="asymmetric">Asymmetric</option><option value="mirror">Mirror</option></select></label>
            <label>Seed<input aria-label="Override seed" type="number" min="0" value={override?.values.seed as number | undefined ?? (level.seed.provenance === 'unknown' ? 0 : level.seed.seed)} onChange={(event) => setAdvanced('seed', 'seed', Number(event.target.value))} /></label>
          </div></details>
        </div>
      </div>
    </section>
  );
}
