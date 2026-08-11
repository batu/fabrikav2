import { useState } from 'react';
import type { DifficultyDraft, DifficultyRange } from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';
import type { Feature, Slot } from '../../../../../games/marble_run/src/levels/funnel-schedule.ts';

interface PatternEditorProps { readonly draft: DifficultyDraft; readonly onEdit: (draft: DifficultyDraft) => void }

const FEATURES: readonly Feature[] = ['green', 'yellow', 'plugs', 'voids', 'purple', 'orange'];
const PACING: readonly Exclude<Slot, 'onboarding'>[] = ['ramp', 'band', 'spike', 'recover', 'relax', 'climax'];
const ALL_ROLES: readonly Slot[] = ['onboarding', ...PACING];
const FEATURE_LABELS: Record<Feature, string> = {
  green: 'Green marbles', yellow: 'Yellow marbles', plugs: 'Blocked spaces', voids: 'Holes', purple: 'Purple marbles', orange: 'Orange marbles',
};
const PACING_COPY: Record<Exclude<Slot, 'onboarding'>, { label: string; description: string }> = {
  ramp: { label: 'Build', description: 'Raise the difficulty and prepare the player for what comes next.' },
  band: { label: 'Steady', description: 'Hold the current difficulty so the player can settle into it.' },
  spike: { label: 'Challenge', description: 'Create a noticeable test above the surrounding levels.' },
  recover: { label: 'Breather', description: 'Ease off after a challenge without becoming trivial.' },
  relax: { label: 'Easy win', description: 'Give the player a clear moment of relief.' },
  climax: { label: 'Final challenge', description: 'Finish this stretch with its strongest test.' },
};
const ROLE_LABELS: Record<Slot, string> = { onboarding: 'Teaching levels', ...Object.fromEntries(PACING.map((role) => [role, PACING_COPY[role].label])) } as Record<Slot, string>;

function RangeFields({ range, label, onChange }: { readonly range: DifficultyRange; readonly label: string; readonly onChange: (range: DifficultyRange) => void }): React.JSX.Element {
  return (
    <span className="range-fields range-fields--explained">
      <label><span>Easier edge</span><input aria-label={`${label} easier edge`} type="number" min="1" max={range.max} step="0.5" value={range.min} onChange={(event) => onChange({ ...range, min: Number(event.target.value) })} /></label>
      <span aria-hidden="true">to</span>
      <label><span>Harder edge</span><input aria-label={`${label} harder edge`} type="number" min={range.min} max="20" step="0.5" value={range.max} onChange={(event) => onChange({ ...range, max: Number(event.target.value) })} /></label>
    </span>
  );
}

export function PatternEditor({ draft, onEdit }: PatternEditorProps): React.JSX.Element {
  const [selectedTeaching, setSelectedTeaching] = useState(0);
  const [selectedRepeat, setSelectedRepeat] = useState(0);
  const teaching = draft.authored.onboarding[selectedTeaching]!;
  const repeat = draft.authored.baseCycle[selectedRepeat]!;

  const setOnboardingRange = (targetRange: DifficultyRange) => onEdit({
    ...draft,
    authored: { ...draft.authored, onboarding: draft.authored.onboarding.map((entry, index) => index === selectedTeaching ? { ...entry, targetRange } : entry) },
  });
  const moveMechanicDebut = (mechanicDebut: Feature | null) => onEdit({
    ...draft,
    authored: {
      ...draft.authored,
      onboarding: draft.authored.onboarding.map((item, index) => ({
        ...item,
        mechanicDebut: index === selectedTeaching ? mechanicDebut : item.mechanicDebut === mechanicDebut ? null : item.mechanicDebut,
        spotlight: index === selectedTeaching && mechanicDebut !== null ? true : item.spotlight,
      })),
    },
  });
  const setSlotRange = (targetRange: DifficultyRange) => onEdit({
    ...draft,
    authored: { ...draft.authored, baseCycle: draft.authored.baseCycle.map((slot, index) => index === selectedRepeat ? { ...slot, targetRange } : slot) },
  });
  const setOffset = (index: number, value: number) => onEdit({
    ...draft,
    authored: { ...draft.authored, progression: { ...draft.authored.progression, difficultyOffsets: draft.authored.progression.difficultyOffsets.map((offset, i) => i === index ? value : offset) } },
  });

  return (
    <div className="pattern-editor">
      <section className="pattern-block" aria-labelledby="teaching-title">
        <div className="pattern-block__heading"><div><span className="eyebrow">Levels 1–11</span><h3 id="teaching-title">Teach the basics</h3></div><p>Choose when each new idea appears.</p></div>
        <div className="step-strip" aria-label="Teaching levels">
          {draft.authored.onboarding.map((entry, index) => (
            <button key={entry.levelId} className="step-chip" aria-pressed={selectedTeaching === index} onClick={() => setSelectedTeaching(index)}>
              <strong>{entry.levelId}</strong><span>{entry.mechanicDebut === null ? 'Practice' : FEATURE_LABELS[entry.mechanicDebut]}</span>
            </button>
          ))}
        </div>
        <div className="step-editor">
          <div className="step-editor__heading"><div><span className="eyebrow">Selected</span><h4>Level {teaching.levelId}</h4></div><span className="difficulty-summary">Difficulty {teaching.targetRange.min}–{teaching.targetRange.max}</span></div>
          <label className="field-stack"><span>What does the player learn?</span><select aria-label={`What players learn at level ${teaching.levelId}`} value={teaching.mechanicDebut ?? ''} onChange={(event) => moveMechanicDebut((event.target.value || null) as Feature | null)}><option value="">Nothing new — let them practise</option>{FEATURES.map((feature) => <option key={feature} value={feature}>{FEATURE_LABELS[feature]}</option>)}</select></label>
          <div className="field-stack"><span>How difficult can it feel?</span><RangeFields range={teaching.targetRange} label={`Level ${teaching.levelId}`} onChange={setOnboardingRange} /></div>
          <label className="focus-check"><input type="checkbox" checked={teaching.spotlight} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, onboarding: draft.authored.onboarding.map((item, index) => index === selectedTeaching ? { ...item, spotlight: event.target.checked } : item) } })} /><span><strong>Make the new idea the focus</strong><small>This level will avoid other mechanics that could distract from it.</small></span></label>
        </div>
      </section>

      <section className="pattern-block" aria-labelledby="repeat-title">
        <div className="pattern-block__heading"><div><span className="eyebrow">Levels 12–110</span><h3 id="repeat-title">Shape the journey</h3></div><p>This pattern repeats. Edit a step once; every matching level follows it.</p></div>
        <div className="step-strip step-strip--repeat" aria-label="Repeating journey steps">
          {draft.authored.baseCycle.map((slot, index) => (
            <button key={slot.index} className="step-chip" aria-pressed={selectedRepeat === index} onClick={() => setSelectedRepeat(index)}>
              <strong>{slot.index + 1}</strong><span>{PACING_COPY[slot.role].label}</span>
            </button>
          ))}
        </div>
        <div className="step-editor">
          <div className="step-editor__heading"><div><span className="eyebrow">Selected</span><h4>Step {repeat.index + 1}</h4></div><span className="difficulty-summary">Difficulty {repeat.targetRange.min}–{repeat.targetRange.max}</span></div>
          <label className="field-stack"><span>What should this moment feel like?</span><select aria-label={`Pacing for repeating step ${repeat.index + 1}`} value={repeat.role} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, baseCycle: draft.authored.baseCycle.map((item, index) => index === selectedRepeat ? { ...item, role: event.target.value as typeof item.role } : item) } })}>{PACING.map((role) => <option key={role} value={role}>{PACING_COPY[role].label}</option>)}</select><small>{PACING_COPY[repeat.role].description}</small></label>
          <div className="field-stack"><span>How difficult can it feel?</span><RangeFields range={repeat.targetRange} label={`Repeating step ${repeat.index + 1}`} onChange={setSlotRange} /></div>
          <label className="field-stack"><span>When this step returns later</span><select aria-label={`Later behavior for repeating step ${repeat.index + 1}`} value={repeat.progression} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, baseCycle: draft.authored.baseCycle.map((item, index) => index === selectedRepeat ? { ...item, progression: event.target.value as typeof item.progression } : item) } })}><option value="fixed">Keep the same difficulty</option><option value="creeping">Make it gradually harder</option><option value="alternating">Alternate easier and harder</option></select></label>
        </div>
      </section>

      <details className="progression-block">
        <summary><span><span className="eyebrow">Optional</span><strong>Fine-tune later repeats</strong></span><small>Control how much extra difficulty is added as the journey continues.</small></summary>
        <div className="progression-content">
          <div className="offset-editor">
            {draft.authored.progression.difficultyOffsets.map((offset, index) => <label key={index}><span>{index === 0 ? 'First time' : `Repeat ${index + 1}`}</span><small>Added difficulty</small><input aria-label={`Added difficulty for repeat ${index + 1}`} type="number" min="0" max={draft.authored.progression.maximumOffset} step="0.5" value={offset} onChange={(event) => setOffset(index, Number(event.target.value))} /></label>)}
          </div>
          <div className="progression-rules">
            <label className="progression-limit"><span>Most extra difficulty allowed</span><input type="number" min="0" max="20" step="0.5" value={draft.authored.progression.maximumOffset} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, progression: { ...draft.authored.progression, maximumOffset: Number(event.target.value) } } })} /></label>
            <fieldset><legend>Which moments become harder?</legend>{ALL_ROLES.map((role) => <label key={role}><input type="checkbox" checked={draft.authored.progression.affectedRoles.includes(role)} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, progression: { ...draft.authored.progression, affectedRoles: event.target.checked ? [...draft.authored.progression.affectedRoles, role] : draft.authored.progression.affectedRoles.filter((item) => item !== role) } } })} />{ROLE_LABELS[role]}</label>)}</fieldset>
            <fieldset><legend>Never make these moments harder than</legend>{ALL_ROLES.map((role) => <label key={role}><span>{ROLE_LABELS[role]}</span><input aria-label={`${ROLE_LABELS[role]} difficulty limit`} type="number" min="1" max="20" step="0.5" value={draft.authored.progression.roleCeilings[role]} onChange={(event) => onEdit({ ...draft, authored: { ...draft.authored, progression: { ...draft.authored.progression, roleCeilings: { ...draft.authored.progression.roleCeilings, [role]: Number(event.target.value) } } } })} /></label>)}</fieldset>
          </div>
        </div>
      </details>
    </div>
  );
}
