import { useState } from 'react';
import type { DifficultyDraft, DifficultyMappings, MappingAnchor } from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';

interface DrawerProps { readonly draft: DifficultyDraft; readonly onEdit: (draft: DifficultyDraft) => void; readonly onClose: () => void }
type MappingName = keyof DifficultyMappings;
const MAPPINGS: readonly { key: MappingName; label: string; effect: string; min: number; max: number; step: number }[] = [
  { key: 'marbleCount', label: 'Marble count', effect: 'More pieces extend the solve.', min: 1, max: 160, step: 1 },
  { key: 'boardArea', label: 'Board area', effect: 'More space changes route density.', min: 9, max: 220, step: 1 },
  { key: 'colorCount', label: 'Color count', effect: 'More exits increase planning.', min: 2, max: 6, step: 1 },
  { key: 'openingGenerosity', label: 'Opening generosity', effect: 'Higher values reveal more first moves.', min: 0, max: 1, step: .01 },
  { key: 'solverWaveDepth', label: 'Solver-wave depth', effect: 'More waves delay available moves.', min: 1, max: 20, step: 1 },
];

export function DifficultyModelDrawer({ draft, onEdit, onClose }: DrawerProps): React.JSX.Element {
  const [mappingName, setMappingName] = useState<MappingName>('marbleCount');
  const [announcement, setAnnouncement] = useState('');
  const spec = MAPPINGS.find(({ key }) => key === mappingName)!;
  const anchors = draft.authored.mappings[mappingName];
  const update = (index: number, value: number) => {
    const bounded = Math.min(spec.max, Math.max(spec.min, value));
    const next: MappingAnchor[] = anchors.map((anchor, i) => i === index ? { ...anchor, value: bounded } : anchor);
    onEdit({ ...draft, authored: { ...draft.authored, mappings: { ...draft.authored.mappings, [mappingName]: next } } });
    setAnnouncement(`${spec.label}, difficulty ${anchors[index]!.difficulty}: ${bounded}`);
  };
  return (
    <aside className="model-drawer" aria-labelledby="model-title">
      <div className="drawer-heading"><div><span className="eyebrow">Player effect</span><h2 id="model-title">Difficulty model</h2></div><button className="text-action" onClick={onClose}>Close</button></div>
      <div className="mapping-tabs" role="tablist" aria-label="Difficulty mappings">
        {MAPPINGS.map(({ key, label }) => <button role="tab" aria-selected={mappingName === key} key={key} onClick={() => setMappingName(key)}>{label}</button>)}
      </div>
      <p className="drawer-explanation">{spec.effect}</p>
      <div className="anchor-editor">
        {anchors.map((anchor, index) => (
          <div className="anchor-row" key={anchor.difficulty}>
            <span className="anchor-row__difficulty">Difficulty {anchor.difficulty}</span>
            <input data-anchor-range={`${mappingName}-${index}`} aria-label={`${spec.label} at difficulty ${anchor.difficulty}`} type="range" min={spec.min} max={spec.max} step={spec.step} value={anchor.value} onInput={(event) => update(index, Number(event.currentTarget.value))} />
            <input data-anchor-number={`${mappingName}-${index}`} aria-label={`${spec.label} exact value at difficulty ${anchor.difficulty}`} type="number" min={spec.min} max={spec.max} step={spec.step} value={anchor.value} onChange={(event) => update(index, Number(event.target.value))} />
          </div>
        ))}
      </div>
      <div className="role-rule-editor">
        <h3>Role rules</h3>
        {draft.authored.roleRules.map((rule, index) => (
          <div className="role-rule" key={rule.role}>
            <strong>{rule.role}</strong>
            <label><input type="checkbox" checked={rule.spreadOpeningRoutes} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, roleRules: draft.authored.roleRules.map((item, i) => i === index ? { ...item, spreadOpeningRoutes: event.target.checked } : item) } })} />Spread opening routes</label>
            <select aria-label={`${rule.role} finish character`} value={rule.finish} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, roleRules: draft.authored.roleRules.map((item, i) => i === index ? { ...item, finish: event.target.value as typeof item.finish } : item) } })}><option value="cascade">Cascade finish</option><option value="thin">Thin finish</option></select>
          </div>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </aside>
  );
}
