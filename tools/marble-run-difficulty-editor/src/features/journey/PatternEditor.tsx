import type { DifficultyDraft, DifficultyRange } from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';
import type { Feature, Slot } from '../../../../../games/marble_run/src/levels/funnel-schedule.ts';

interface PatternEditorProps { readonly draft: DifficultyDraft; readonly onEdit: (draft: DifficultyDraft) => void }

function RangeFields({ range, label, onChange }: { readonly range: DifficultyRange; readonly label: string; readonly onChange: (range: DifficultyRange) => void }): React.JSX.Element {
  return (
    <span className="range-fields">
      <label><span className="sr-only">{label} minimum</span><input type="number" min="1" max={range.max} step="0.5" value={range.min} onChange={(event) => onChange({ ...range, min: Number(event.target.value) })} /></label>
      <span aria-hidden="true">–</span>
      <label><span className="sr-only">{label} maximum</span><input type="number" min={range.min} max="20" step="0.5" value={range.max} onChange={(event) => onChange({ ...range, max: Number(event.target.value) })} /></label>
    </span>
  );
}

export function PatternEditor({ draft, onEdit }: PatternEditorProps): React.JSX.Element {
  const features: readonly Feature[] = ['green', 'yellow', 'plugs', 'voids', 'purple', 'orange'];
  const cycleRoles: readonly Exclude<Slot, 'onboarding'>[] = ['ramp', 'band', 'spike', 'recover', 'relax', 'climax'];
  const allRoles: readonly Slot[] = ['onboarding', ...cycleRoles];
  const setOnboardingRange = (index: number, targetRange: DifficultyRange) => onEdit({
    ...draft,
    authored: { ...draft.authored, onboarding: draft.authored.onboarding.map((entry, i) => i === index ? { ...entry, targetRange } : entry) },
  });
  const moveMechanicDebut = (index: number, mechanicDebut: Feature | null) => onEdit({
    ...draft,
    authored: {
      ...draft.authored,
      onboarding: draft.authored.onboarding.map((item, i) => ({
        ...item,
        mechanicDebut: i === index ? mechanicDebut : item.mechanicDebut === mechanicDebut ? null : item.mechanicDebut,
        spotlight: i === index && mechanicDebut !== null ? true : item.spotlight,
      })),
    },
  });
  const setSlotRange = (index: number, targetRange: DifficultyRange) => onEdit({
    ...draft,
    authored: { ...draft.authored, baseCycle: draft.authored.baseCycle.map((slot, i) => i === index ? { ...slot, targetRange } : slot) },
  });
  const setOffset = (index: number, value: number) => onEdit({
    ...draft,
    authored: { ...draft.authored, progression: { ...draft.authored.progression, difficultyOffsets: draft.authored.progression.difficultyOffsets.map((offset, i) => i === index ? value : offset) } },
  });

  return (
    <div className="pattern-editor">
      <section className="pattern-block" aria-labelledby="onboarding-title">
        <div className="pattern-block__heading"><div><span className="eyebrow">Levels 1–11</span><h3 id="onboarding-title">Onboarding</h3></div><p>Teach one decision at a time.</p></div>
        <div className="pattern-rows">
          {draft.authored.onboarding.map((entry, index) => (
            <div className="pattern-row" key={entry.levelId}>
              <strong>{entry.levelId}</strong><select aria-label={`Mechanic debut at level ${entry.levelId}`} value={entry.mechanicDebut ?? ''} onChange={(event) => moveMechanicDebut(index, (event.target.value || null) as Feature | null)}><option value="">Foundation</option>{features.map((feature) => <option key={feature} value={feature}>{feature}</option>)}</select>
              <RangeFields range={entry.targetRange} label={`Level ${entry.levelId}`} onChange={(range) => setOnboardingRange(index, range)} />
              <label className="compact-check"><input type="checkbox" checked={entry.spotlight} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, onboarding: draft.authored.onboarding.map((item, i) => i === index ? { ...item, spotlight: event.target.checked } : item) } })} /><span>Spotlight</span></label>
            </div>
          ))}
        </div>
      </section>
      <section className="pattern-block" aria-labelledby="cycle-title">
        <div className="pattern-block__heading"><div><span className="eyebrow">19 repeating slots</span><h3 id="cycle-title">Base Cycle</h3></div><p>The pattern behind levels 12–110.</p></div>
        <div className="pattern-rows pattern-rows--cycle">
          {draft.authored.baseCycle.map((slot, index) => (
            <div className="pattern-row" key={slot.index}>
              <strong>{slot.index + 1}</strong><select aria-label={`Role for slot ${slot.index + 1}`} value={slot.role} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, baseCycle: draft.authored.baseCycle.map((item, i) => i === index ? { ...item, role: event.target.value as typeof item.role } : item) } })}>{cycleRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select>
              <RangeFields range={slot.targetRange} label={`Base Cycle slot ${slot.index + 1}`} onChange={(range) => setSlotRange(index, range)} />
              <select aria-label={`Progression for slot ${slot.index + 1}`} value={slot.progression} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, baseCycle: draft.authored.baseCycle.map((item, i) => i === index ? { ...item, progression: event.target.value as typeof item.progression } : item) } })}>
                <option value="fixed">Fixed</option><option value="creeping">Creeping</option><option value="alternating">Alternating</option>
              </select>
            </div>
          ))}
        </div>
      </section>
      <section className="progression-block" aria-labelledby="progression-title">
        <div className="pattern-block__heading"><div><span className="eyebrow">Across repetitions</span><h3 id="progression-title">Cycle Progression</h3></div><p>Increase resistance without erasing recovery.</p></div>
        <div className="offset-editor">
          {draft.authored.progression.difficultyOffsets.map((offset, index) => <label key={index}><span>Cycle {index + 1}</span><input type="number" min="0" max={draft.authored.progression.maximumOffset} step="0.5" value={offset} onChange={(event) => setOffset(index, Number(event.target.value))} /></label>)}
        </div>
        <div className="progression-rules">
          <label className="progression-limit"><span>Maximum offset</span><input type="number" min="0" max="20" step="0.5" value={draft.authored.progression.maximumOffset} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, progression: { ...draft.authored.progression, maximumOffset: Number(event.target.value) } } })} /></label>
          <fieldset><legend>Roles that become harder</legend>{allRoles.map((role) => <label key={role}><input type="checkbox" checked={draft.authored.progression.affectedRoles.includes(role)} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, progression: { ...draft.authored.progression, affectedRoles: event.target.checked ? [...draft.authored.progression.affectedRoles, role] : draft.authored.progression.affectedRoles.filter((item) => item !== role) } } })} />{role}</label>)}</fieldset>
          <fieldset><legend>Role ceilings</legend>{allRoles.map((role) => <label key={role}><span>{role}</span><input aria-label={`${role} difficulty ceiling`} type="number" min="1" max="20" step="0.5" value={draft.authored.progression.roleCeilings[role]} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, progression: { ...draft.authored.progression, roleCeilings: { ...draft.authored.progression.roleCeilings, [role]: Number(event.target.value) } } } })} /></label>)}</fieldset>
        </div>
      </section>
    </div>
  );
}
