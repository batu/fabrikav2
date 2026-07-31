import type {
  CatalogOptions,
  PresetIndexResponse,
  PresetRecord,
  PresetRunRecord,
  PresetSelection,
  ResolvedPreset,
} from '../../api/generated.ts';

export type { CatalogOptions, PresetRecord, PresetRunRecord, PresetSelection, ResolvedPreset };

/** The axis a dropdown edits, paired with the vocabulary it draws from. */
export type SelectionAxis = 'scene' | 'view' | 'style' | 'entity' | 'model';

export interface AxisField {
  axis: SelectionAxis;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}

function humanise(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build the dropdown fields for a selection.
 *
 * Every vocabulary comes from the server's frozen catalog. The UI never holds a
 * second copy of the model or style lists, so a catalog change cannot leave the
 * dropdowns describing options the backend would reject.
 */
export function axisFields(selection: PresetSelection, options: CatalogOptions): AxisField[] {
  const plain = (values: string[]) =>
    values.map((value) => ({ value, label: humanise(value) }));
  return [
    { axis: 'scene', label: 'Scene', value: selection.scene, options: plain(options.scenes) },
    { axis: 'view', label: 'View', value: selection.view, options: plain(options.views) },
    { axis: 'style', label: 'Style', value: selection.style, options: plain(options.styles) },
    { axis: 'entity', label: 'Hidden object', value: selection.entity, options: plain(options.entities) },
    {
      axis: 'model',
      label: 'Model',
      value: selection.model,
      options: options.models.map((option) => ({ value: option.id, label: option.label })),
    },
  ];
}

export function withAxis(
  selection: PresetSelection,
  axis: SelectionAxis,
  value: string,
): PresetSelection {
  return { ...selection, [axis]: value };
}

export function selectionsDiffer(a: PresetSelection, b: PresetSelection): boolean {
  return (['scene', 'view', 'style', 'entity', 'model'] as const).some((k) => a[k] !== b[k]);
}

export function findPreset(index: PresetIndexResponse, id: string): PresetRecord | null {
  return index.presets.find((preset) => preset.id === id) ?? null;
}

/** Short digest form for display; the full value stays in the run record. */
export function shortDigest(digest: string): string {
  return digest.slice(0, 12);
}

/**
 * A run is reproducible only if it still matches the preset it names. Presets
 * are versioned, so a run recorded against v1 is expected to drift once the
 * preset is edited — that is not an error, it is the provenance working.
 */
export function runIsCurrent(run: PresetRunRecord, preset: PresetRecord | null): boolean {
  return preset !== null && run.presetVersion === preset.version;
}

export function describeRun(run: PresetRunRecord, preset: PresetRecord | null): string {
  const currency = runIsCurrent(run, preset)
    ? 'matches the current preset'
    : `recorded against v${run.presetVersion}, preset has moved on`;
  return `${run.runId} — ${run.outcome}, ${currency}`;
}
