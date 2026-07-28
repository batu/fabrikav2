import { useEffect, useMemo, useRef, useState } from 'react';

import {
  axisFields,
  describeRun,
  findPreset,
  selectionsDiffer,
  shortDigest,
  type PresetRunRecord,
  type PresetSelection,
  type ResolvedPreset,
  type SelectionAxis,
} from './model.ts';
import type { PresetIndexResponse } from '../../api/generated.ts';

export interface PresetPanelProps {
  index: PresetIndexResponse;
  selectedPresetId: string;
  selection: PresetSelection;
  resolved: ResolvedPreset | null;
  runs: PresetRunRecord[];
  busy: boolean;
  onSelectPreset: (presetId: string) => void;
  onChangeAxis: (axis: SelectionAxis, value: string) => void;
  onSaveSelection: () => Promise<void>;
  onRecordRun: (runId: string) => Promise<void>;
}

export function PresetPanel({
  index,
  selectedPresetId,
  selection,
  resolved,
  runs,
  busy,
  onSelectPreset,
  onChangeAxis,
  onSaveSelection,
  onRecordRun,
}: PresetPanelProps) {
  const [runId, setRunId] = useState('');
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const preset = useMemo(
    () => findPreset(index, selectedPresetId),
    [index, selectedPresetId],
  );
  const fields = useMemo(
    () => axisFields(selection, index.options),
    [selection, index.options],
  );
  const dirty = preset !== null && selectionsDiffer(selection, preset.selection);

  useEffect(() => {
    if (resolved !== null) resultHeading.current?.focus();
  }, [resolved?.digest]);

  return (
    <section className="presets" aria-labelledby="presets-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Generation</p>
          <h2 id="presets-title">Preset</h2>
        </div>
        <span className="authority">
          {preset === null ? 'No preset' : `v${preset.version}`}
        </span>
      </div>

      <div className="preset-grid">
        <form
          className="preset-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSaveSelection();
          }}
        >
          <fieldset disabled={busy}>
            <legend>Preset</legend>
            <label>
              Preset
              <select
                value={selectedPresetId}
                onChange={(event) => onSelectPreset(event.target.value)}
              >
                {index.presets.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {preset !== null && preset.notes !== '' ? <small>{preset.notes}</small> : null}
            </label>

            {fields.map((field) => (
              <label key={field.axis}>
                {field.label}
                <select
                  value={field.value}
                  onChange={(event) => onChangeAxis(field.axis, event.target.value)}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            <button className="primary" type="submit" disabled={!dirty}>
              {dirty ? 'Save selection (bumps version)' : 'Selection saved'}
            </button>
          </fieldset>
        </form>

        <div className="preset-context">
          <article className="selection" aria-label="Resolved preset">
            <h3 ref={resultHeading} tabIndex={-1}>
              Resolved
            </h3>
            {resolved === null ? (
              <p>Nothing resolved yet.</p>
            ) : (
              <dl>
                <dt>Digest</dt>
                <dd><code>{shortDigest(resolved.digest)}</code></dd>
                <dt>Catalog</dt>
                <dd><code>{shortDigest(resolved.catalogSha256)}</code></dd>
                <dt>Scene prompt</dt>
                <dd><pre>{resolved.scenePrompt}</pre></dd>
                <dt>Hidden-object prompt</dt>
                <dd><pre>{resolved.entityPrompt}</pre></dd>
              </dl>
            )}
          </article>

          <form
            className="run-form"
            onSubmit={(event) => {
              event.preventDefault();
              const id = runId.trim();
              if (id === '') return;
              setRunId('');
              void onRecordRun(id);
            }}
          >
            <fieldset disabled={busy || resolved === null}>
              <legend>Record a generation run</legend>
              <label>
                Run ID
                <input
                  value={runId}
                  onChange={(event) => setRunId(event.target.value)}
                  placeholder="run-2026-07-28-01"
                />
                <small>
                  Stores the resolved preset by value, so editing the preset later cannot
                  rewrite what this run reports.
                </small>
              </label>
              <button type="submit">Record run</button>
            </fieldset>
          </form>

          <article aria-label="Recorded runs">
            <h3>Runs</h3>
            <p role="status" aria-live="polite">
              {runs.length === 0 ? 'No runs recorded.' : `${runs.length} recorded.`}
            </p>
            <ul>
              {runs.map((run) => (
                <li key={run.runId}>{describeRun(run, preset)}</li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
