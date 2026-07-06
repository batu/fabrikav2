import { describe, it, expect } from 'vitest';
import {
  median, parseModelResponse, aggregateState, aggregatePanel, callModel, runPanel,
  classifySkip, CREDIT_STATUSES, DEFAULT_MODELS, DIFF_PROMPT,
} from '../src/panel.mjs';

// A scoring model result as produced by callModel (the shape aggregateState reads).
const ok = (model, fidelity, findings = []) => ({ model, ok: true, fidelity, findings });
const skip = (model, why) => ({ model, ok: false, skipped: why });
const f = (key, severity) => ({ key, severity, description: `${key} differs` });

describe('median', () => {
  it('odd/even/empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(null);
  });
});

describe('parseModelResponse', () => {
  it('parses a clean JSON object', () => {
    const r = parseModelResponse('{"fidelity": 72, "findings": [{"key":"color","severity":"major","description":"bg"}]}');
    expect(r.fidelity).toBe(72);
    expect(r.findings).toEqual([{ key: 'color', severity: 'major', description: 'bg', reference: undefined, ours: undefined }]);
  });

  it('tolerates ```json fences and surrounding prose', () => {
    const r = parseModelResponse('Sure!\n```json\n{"fidelity": 55, "findings": []}\n```\nHope that helps.');
    expect(r.fidelity).toBe(55);
    expect(r.findings).toEqual([]);
  });

  it('normalises unknown key -> other and unknown severity -> minor', () => {
    const r = parseModelResponse('{"fidelity":90,"findings":[{"key":"vibes","severity":"catastrophic","description":"x"}]}');
    expect(r.findings[0]).toMatchObject({ key: 'other', severity: 'minor' });
  });

  it('clamps fidelity into 0..100', () => {
    expect(parseModelResponse('{"fidelity":150,"findings":[]}').fidelity).toBe(100);
    expect(parseModelResponse('{"fidelity":-9,"findings":[]}').fidelity).toBe(0);
  });

  it('throws on non-JSON or missing fidelity', () => {
    expect(() => parseModelResponse('no json here')).toThrow(/no JSON object/);
    expect(() => parseModelResponse('{"findings":[]}')).toThrow(/fidelity/);
    expect(() => parseModelResponse('{bad json')).toThrow();
  });
});

describe('aggregateState', () => {
  it('panel score is the MEDIAN of scoring models; passes above floor with no blocker consensus', () => {
    const s = aggregateState('menu', [ok('a', 80), ok('b', 90), ok('c', 100)], 85);
    expect(s.score).toBe(90);
    expect(s.status).toBe('pass');
  });

  it('fails when the median is below the fidelity floor', () => {
    const s = aggregateState('win', [ok('a', 55), ok('b', 60), ok('c', 58)], 85);
    expect(s.status).toBe('fail');
    expect(s.reason).toMatch(/58% < 85%/);
  });

  it('a finding flagged by a MAJORITY becomes consensus; a lone flag does not', () => {
    const s = aggregateState('menu', [
      ok('a', 95, [f('layout', 'major'), f('color', 'minor')]),
      ok('b', 95, [f('layout', 'major')]),
      ok('c', 95, [f('spacing', 'minor')]),
    ], 85);
    const keys = s.consensus.map((c) => c.key);
    expect(keys).toContain('layout'); // 2/3 flagged -> consensus
    expect(keys).not.toContain('color'); // 1/3 (only 'a') -> not consensus
    expect(keys).not.toContain('spacing'); // 1/3 (only 'c') -> not consensus
  });

  it('fails on a blocker-severity finding at consensus even when the score is high', () => {
    const s = aggregateState('menu', [
      ok('a', 98, [f('missing-element', 'blocker')]),
      ok('b', 97, [f('missing-element', 'blocker')]),
      ok('c', 99, []),
    ], 85);
    expect(s.status).toBe('fail');
    expect(s.reason).toMatch(/consensus blocker: missing-element \(2\/3\)/);
  });

  it('marks a state unscored (never a silent pass) when no model scored it', () => {
    const s = aggregateState('pause', [skip('a', '404'), skip('b', 'HTTP 500')], 85);
    expect(s.status).toBe('unscored');
    expect(s.score).toBe(null);
    expect(s.models.every((m) => !m.ok)).toBe(true);
  });

  it('computes majority off the SCORING models only (skips excluded)', () => {
    // 2 scored, majority = 2; a finding needs both to reach consensus.
    const s = aggregateState('menu', [
      ok('a', 95, [f('layout', 'blocker')]),
      ok('b', 95, [f('layout', 'blocker')]),
      skip('c', '404'),
    ], 85);
    expect(s.consensus.find((c) => c.key === 'layout')).toMatchObject({ count: 2, of: 2, severity: 'blocker' });
    expect(s.status).toBe('fail');
  });
});

describe('color-consensus edge: exactly majority', () => {
  it('a finding flagged by exactly the majority (2/3) is consensus', () => {
    const s = aggregateState('menu', [
      ok('a', 95, [f('color', 'major')]),
      ok('b', 95, [f('color', 'major')]),
      ok('c', 95, []),
    ], 85);
    expect(s.consensus.map((c) => c.key)).toContain('color');
  });
});

describe('aggregatePanel', () => {
  const pass = (state, score) => ({ state, score, status: 'pass', reason: '', models: [], consensus: [] });
  const fail = (state, score) => ({ state, score, status: 'fail', reason: '', models: [], consensus: [] });
  const uns = (state) => ({ state, score: null, status: 'unscored', reason: '', models: [], consensus: [] });

  it('passes only when zero fails AND zero unscored', () => {
    const v = aggregatePanel([pass('menu', 90), pass('win', 88)], 85);
    expect(v.pass).toBe(true);
    expect(v.summary).toMatch(/^PASS/);
    expect(v.score).toBe(89);
  });

  it('any fail fails the panel', () => {
    const v = aggregatePanel([pass('menu', 90), fail('win', 40)], 85);
    expect(v.pass).toBe(false);
    expect(v.summary).toMatch(/^FAIL/);
  });

  it('an unscored state holds the gate open (never a silent pass)', () => {
    const v = aggregatePanel([pass('menu', 90), uns('pause')], 85);
    expect(v.pass).toBe(false);
    expect(v.summary).toMatch(/1 unscored/);
  });
});

describe('callModel (mocked fetch)', () => {
  const mockFetch = (status, payload) => async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  });

  it('returns a scored result on 200 with a valid model body', async () => {
    const fetchImpl = mockFetch(200, {
      choices: [{ message: { content: '{"fidelity": 66, "findings": [{"key":"color","severity":"major","description":"x"}]}' } }],
    });
    const r = await callModel('anthropic/claude-opus-4.1', { referenceB64: 'AA', deviceB64: 'BB', apiKey: 'k', fetchImpl });
    expect(r).toMatchObject({ ok: true, fidelity: 66 });
    expect(r.findings[0].key).toBe('color');
  });

  it('skips-with-note a 404 model (never throws)', async () => {
    const r = await callModel('vendor/absent', { referenceB64: 'AA', deviceB64: 'BB', apiKey: 'k', fetchImpl: mockFetch(404, {}) });
    expect(r).toMatchObject({ ok: false, skipped: expect.stringMatching(/404/) });
  });

  it('CREDIT-SKIP: 401/402/403/429 are recorded as credit/quota skips, never fatal', async () => {
    for (const status of [401, 402, 403, 429]) {
      const r = await callModel('google/gemini-3.5-flash', {
        referenceB64: 'A', deviceB64: 'B', apiKey: 'k', judge: 'gemini', fetchImpl: mockFetch(status, {}),
      });
      // {judge, skipped, reason}: judge recorded, ok:false, reason names credit/quota + status
      expect(r).toMatchObject({ judge: 'gemini', ok: false });
      expect(r.skipped).toMatch(new RegExp(`credit/quota.*${status}`));
    }
  });

  it('CREDIT-SKIP: a request timeout (AbortError) is a skip, not a throw', async () => {
    const fetchImpl = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    const r = await callModel('m', { referenceB64: 'A', deviceB64: 'B', apiKey: 'k', judge: 'j', timeoutMs: 5, fetchImpl });
    expect(r).toMatchObject({ judge: 'j', ok: false, skipped: expect.stringMatching(/timeout after 5ms/) });
  });

  it('threads the judge id onto both scored and skipped results', async () => {
    const good = mockFetch(200, { choices: [{ message: { content: '{"fidelity":80,"findings":[]}' } }] });
    expect(await callModel('anthropic/claude-opus-4.1', { referenceB64: 'A', deviceB64: 'B', apiKey: 'k', judge: 'opus', fetchImpl: good }))
      .toMatchObject({ judge: 'opus', ok: true, fidelity: 80 });
    expect(await callModel('anthropic/claude-opus-4.1', { referenceB64: 'A', deviceB64: 'B', apiKey: 'k', judge: 'opus', fetchImpl: mockFetch(402, {}) }))
      .toMatchObject({ judge: 'opus', ok: false });
  });

  it('skips on a non-2xx status and on unparseable model output', async () => {
    expect(await callModel('m', { referenceB64: 'A', deviceB64: 'B', apiKey: 'k', fetchImpl: mockFetch(500, {}) }))
      .toMatchObject({ ok: false, skipped: expect.stringMatching(/HTTP 500/) });
    const bad = mockFetch(200, { choices: [{ message: { content: 'not json at all' } }] });
    expect(await callModel('m', { referenceB64: 'A', deviceB64: 'B', apiKey: 'k', fetchImpl: bad }))
      .toMatchObject({ ok: false, skipped: expect.stringMatching(/bad model output/) });
  });

  it('classifySkip maps statuses; CREDIT_STATUSES covers Gemini\'s 402/429 failure mode', () => {
    expect(classifySkip(404)).toMatch(/not found/);
    expect(classifySkip(402)).toMatch(/credit\/quota.*402/);
    expect(classifySkip(500)).toBe('HTTP 500');
    expect([...CREDIT_STATUSES].sort()).toEqual([401, 402, 403, 429]);
  });

  it('sends the reference as image 1 and device as image 2 with the fixed prompt', async () => {
    let captured;
    const fetchImpl = async (_url, opts) => { captured = JSON.parse(opts.body); return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content: '{"fidelity":100,"findings":[]}' } }] }) }; };
    await callModel('m', { referenceB64: 'REF', deviceB64: 'DEV', apiKey: 'k', fetchImpl });
    const content = captured.messages[0].content;
    expect(content[0].text).toBe(DIFF_PROMPT);
    expect(content[1].image_url.url).toContain('REF');
    expect(content[2].image_url.url).toContain('DEV');
  });
});

describe('runPanel', () => {
  const row = (state, dev, ref) => ({
    state,
    device: dev ? { base64: dev } : { gap: 'no device capture' },
    reference: ref ? { base64: ref } : { gap: 'no reference' },
  });

  it('gracefully skips (no throw) when there is no API key', async () => {
    const r = await runPanel({ rows: [row('menu', 'A', 'B')] });
    expect(r.skipped).toMatch(/OPENROUTER_API_KEY/);
    expect(r.verdict).toBeUndefined();
  });

  it('scores end-to-end with a mocked panel and marks image-missing states unscored', async () => {
    const fetchImpl = async () => ({ status: 200, ok: true, json: async () => ({
      choices: [{ message: { content: '{"fidelity": 92, "findings": []}' } }],
    }) });
    const r = await runPanel({
      rows: [row('menu', 'A', 'B'), row('pause', null, 'B')],
      models: ['m1', 'm2'], apiKey: 'k', thresholdPct: 85, fetchImpl,
    });
    expect(r.states.find((s) => s.state === 'menu')).toMatchObject({ status: 'pass', score: 92 });
    expect(r.states.find((s) => s.state === 'pause')).toMatchObject({ status: 'unscored' });
    expect(r.verdict.pass).toBe(false); // the unscored pause holds the gate
  });

  it('defaults to the 3-model panel from the card', () => {
    expect(DEFAULT_MODELS).toHaveLength(3);
    expect(DEFAULT_MODELS).toContain('anthropic/claude-sonnet-5');
  });

  it('runs a judges roster and a credit-depleted judge is skipped-and-recorded, not fatal', async () => {
    // Kitchen-sink-style roster: opus/sonnet answer, codex is out of budget (402).
    const fetchImpl = async (_url, opts) => {
      const model = JSON.parse(opts.body).model;
      if (model === 'openai/gpt-5') return { status: 402, ok: false, json: async () => ({}) };
      return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content: '{"fidelity":90,"findings":[]}' } }] }) };
    };
    const r = await runPanel({
      rows: [row('menu', 'A', 'B')],
      judges: [
        { id: 'opus', model: 'anthropic/claude-opus-4.1' },
        { id: 'sonnet', model: 'anthropic/claude-sonnet-5' },
        { id: 'codex', model: 'openai/gpt-5' },
      ],
      apiKey: 'k', thresholdPct: 85, fetchImpl,
    });
    const menu = r.states.find((s) => s.state === 'menu');
    // Panel scored on whoever answered (2 judges), codex recorded as a skip.
    expect(menu).toMatchObject({ status: 'pass', score: 90 });
    const codex = menu.models.find((m) => m.judge === 'codex');
    expect(codex).toMatchObject({ ok: false, skipped: expect.stringMatching(/credit\/quota.*402/) });
    expect(menu.models.filter((m) => m.ok).map((m) => m.judge)).toEqual(['opus', 'sonnet']);
    expect(r.verdict.pass).toBe(true); // one broke judge does not sink the panel
    expect(r.judges).toHaveLength(3);
  });
});
