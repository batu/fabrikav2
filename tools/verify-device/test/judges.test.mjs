import { describe, it, expect } from 'vitest';
import {
  parseRegistry, resolveJudges, loadRegistry, REGISTRY_PATH, DEFAULT_ENSEMBLE,
} from '../src/judges.mjs';
import { DEFAULT_MODELS } from '../src/panel.mjs';

const REG = JSON.stringify({
  judges: [
    { id: 'opus', model: 'anthropic/claude-opus-4.1', enabled: true },
    { id: 'sonnet', model: 'anthropic/claude-sonnet-5' }, // enabled defaults on
    { id: 'gemini', model: 'google/gemini-3.5-flash', enabled: true },
    { id: 'codex', model: 'openai/gpt-5', enabled: true },
    { id: 'retired', model: 'vendor/old', enabled: false },
  ],
  ensembles: {
    default: ['opus', 'sonnet', 'gemini'],
    'kitchen-sink': ['opus', 'sonnet', 'gemini', 'codex', 'retired'],
  },
});

describe('parseRegistry', () => {
  it('parses judges + ensembles and defaults provider/enabled', () => {
    const r = parseRegistry(REG);
    expect(r.judges.get('sonnet')).toMatchObject({ id: 'sonnet', provider: 'openrouter', enabled: true });
    expect(r.judges.get('retired').enabled).toBe(false);
    expect(Object.keys(r.ensembles)).toEqual(['default', 'kitchen-sink']);
  });

  it('rejects invalid JSON, missing judges, bad judge shape, dup ids, dangling refs', () => {
    expect(() => parseRegistry('{bad')).toThrow(/not valid JSON/);
    expect(() => parseRegistry('{"judges":[]}')).toThrow(/non-empty "judges"/);
    expect(() => parseRegistry('{"judges":[{"id":"x"}]}')).toThrow(/needs string \{id, model\}/);
    expect(() => parseRegistry('{"judges":[{"id":"a","model":"m"},{"id":"a","model":"n"}],"ensembles":{"d":["a"]}}'))
      .toThrow(/duplicate judge id "a"/);
    expect(() => parseRegistry('{"judges":[{"id":"a","model":"m"}],"ensembles":{"d":["nope"]}}'))
      .toThrow(/unknown judge id "nope"/);
    expect(() => parseRegistry('{"judges":[{"id":"a","model":"m"}]}')).toThrow(/at least one ensemble/);
    expect(() => parseRegistry('{"judges":[{"id":"a","model":"m"}],"ensembles":{"d":[]}}'))
      .toThrow(/non-empty array of judge ids/);
  });
});

describe('resolveJudges', () => {
  const registry = parseRegistry(REG);

  it('default ensemble selects the proven-working three', () => {
    const j = resolveJudges({ registry, ensemble: 'default' });
    expect(j.map((x) => x.model)).toEqual([
      'anthropic/claude-opus-4.1', 'anthropic/claude-sonnet-5', 'google/gemini-3.5-flash',
    ]);
  });

  it('kitchen-sink adds Codex (openai/gpt-5) and drops disabled judges', () => {
    const j = resolveJudges({ registry, ensemble: 'kitchen-sink' });
    expect(j.map((x) => x.id)).toEqual(['opus', 'sonnet', 'gemini', 'codex']); // 'retired' filtered
    expect(j.find((x) => x.id === 'codex').model).toBe('openai/gpt-5');
  });

  it('--models overrides the ensemble with synthetic judges (id === model)', () => {
    const j = resolveJudges({ registry, ensemble: 'kitchen-sink', models: ['a/b', 'c/d'] });
    expect(j).toEqual([
      { id: 'a/b', model: 'a/b', provider: 'openrouter', enabled: true },
      { id: 'c/d', model: 'c/d', provider: 'openrouter', enabled: true },
    ]);
  });

  it('defaults to the default ensemble and throws on an unknown one', () => {
    expect(resolveJudges({ registry }).map((x) => x.id)).toEqual(['opus', 'sonnet', 'gemini']);
    expect(DEFAULT_ENSEMBLE).toBe('default');
    expect(() => resolveJudges({ registry, ensemble: 'nope' })).toThrow(/unknown ensemble "nope"/);
  });
});

describe('the committed judges.json', () => {
  const registry = loadRegistry(REGISTRY_PATH);

  it('loads and its `default` ensemble matches panel DEFAULT_MODELS exactly', () => {
    const models = resolveJudges({ registry, ensemble: 'default' }).map((j) => j.model);
    expect(models).toEqual(DEFAULT_MODELS);
  });

  it('has a kitchen-sink ensemble that includes the openai/gpt-5 Codex judge', () => {
    const j = resolveJudges({ registry, ensemble: 'kitchen-sink' });
    expect(j.length).toBeGreaterThan(resolveJudges({ registry, ensemble: 'default' }).length);
    expect(j.map((x) => x.model)).toContain('openai/gpt-5');
  });
});
