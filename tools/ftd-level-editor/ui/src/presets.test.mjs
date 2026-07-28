import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  axisFields,
  describeRun,
  findPreset,
  runIsCurrent,
  selectionsDiffer,
  shortDigest,
  withAxis,
} from './features/presets/model.ts';

const options = {
  scenes: ['japan_morning_market', 'france_montmartre_cafe_terrace'],
  views: ['isometric', 'side_2d'],
  styles: ['lineart', 'watercolor'],
  entities: ['bird', 'dog'],
  models: [{ id: 'google/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash' }],
};

const selection = {
  scene: 'japan_morning_market',
  view: 'isometric',
  style: 'lineart',
  entity: 'bird',
  model: 'google/gemini-3.1-flash-image-preview',
};

const preset = { id: 'stb', version: 2, label: 'Spot The Bird', selection, notes: '' };

describe('axis fields', () => {
  it('offers one dropdown per selection axis, in a stable order', () => {
    const fields = axisFields(selection, options);
    assert.deepEqual(
      fields.map((field) => field.axis),
      ['scene', 'view', 'style', 'entity', 'model'],
    );
  });

  it('draws every vocabulary from the server catalog, never a local copy', () => {
    const fields = axisFields(selection, options);
    const styles = fields.find((field) => field.axis === 'style');
    assert.deepEqual(styles.options.map((option) => option.value), options.styles);
    const models = fields.find((field) => field.axis === 'model');
    assert.equal(models.options[0].label, 'Gemini 3.1 Flash');
  });

  it('humanises catalog keys for display but keeps the raw key as the value', () => {
    const fields = axisFields(selection, options);
    const scenes = fields.find((field) => field.axis === 'scene');
    assert.equal(scenes.options[0].value, 'japan_morning_market');
    assert.equal(scenes.options[0].label, 'Japan Morning Market');
  });

  it('shows the current value of each axis', () => {
    const fields = axisFields(selection, options);
    assert.equal(fields.find((field) => field.axis === 'entity').value, 'bird');
  });
});

describe('selection editing', () => {
  it('changes one axis without disturbing the others', () => {
    const next = withAxis(selection, 'style', 'watercolor');
    assert.equal(next.style, 'watercolor');
    assert.equal(next.scene, selection.scene);
    assert.equal(selection.style, 'lineart', 'original selection stays untouched');
  });

  it('detects a dirty selection against the saved preset', () => {
    assert.equal(selectionsDiffer(selection, selection), false);
    assert.equal(selectionsDiffer(selection, withAxis(selection, 'view', 'side_2d')), true);
  });
});

describe('run provenance', () => {
  it('treats a run recorded against an older preset version as stale, not broken', () => {
    const run = { runId: 'r1', presetId: 'stb', presetVersion: 1, digest: 'a'.repeat(64), outcome: 'succeeded' };
    assert.equal(runIsCurrent(run, preset), false);
    assert.match(describeRun(run, preset), /recorded against v1/);
  });

  it('marks a run that still matches the current preset version', () => {
    const run = { runId: 'r2', presetId: 'stb', presetVersion: 2, digest: 'b'.repeat(64), outcome: 'recorded' };
    assert.equal(runIsCurrent(run, preset), true);
    assert.match(describeRun(run, preset), /matches the current preset/);
  });

  it('never claims currency when the preset is gone', () => {
    const run = { runId: 'r3', presetId: 'stb', presetVersion: 2, digest: 'c'.repeat(64), outcome: 'recorded' };
    assert.equal(runIsCurrent(run, null), false);
  });
});

describe('display helpers', () => {
  it('shortens a digest without mutating it', () => {
    const digest = 'abcdef0123456789'.repeat(4);
    assert.equal(shortDigest(digest), 'abcdef012345');
    assert.equal(digest.length, 64);
  });

  it('finds a preset by id and returns null rather than undefined when absent', () => {
    const index = { presets: [preset], options };
    assert.equal(findPreset(index, 'stb'), preset);
    assert.equal(findPreset(index, 'missing'), null);
  });
});
