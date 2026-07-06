import { describe, it, expect } from 'vitest';
import { checkBudget, fetchRemainingCredits, remainingFromCreditsPayload } from '../src/budget.mjs';

const mockFetch = (status, payload) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

describe('remainingFromCreditsPayload', () => {
  it('computes remaining = total_credits - total_usage', () => {
    expect(remainingFromCreditsPayload({ data: { total_credits: 50, total_usage: 46.5 } })).toBe(3.5);
  });

  it('returns null on an unexpected shape', () => {
    expect(remainingFromCreditsPayload({})).toBe(null);
    expect(remainingFromCreditsPayload({ data: { total_credits: 'x' } })).toBe(null);
  });
});

describe('fetchRemainingCredits', () => {
  it('returns the remaining balance on a 200', async () => {
    const r = await fetchRemainingCredits({
      apiKey: 'k', fetchImpl: mockFetch(200, { data: { total_credits: 60, total_usage: 55 } }),
    });
    expect(r).toBe(5);
  });

  it('throws on a non-2xx response', async () => {
    await expect(fetchRemainingCredits({ apiKey: 'k', fetchImpl: mockFetch(401, {}) }))
      .rejects.toThrow(/HTTP 401/);
  });

  it('throws on an unparseable/unexpected payload', async () => {
    await expect(fetchRemainingCredits({ apiKey: 'k', fetchImpl: mockFetch(200, { nope: true }) }))
      .rejects.toThrow(/unexpected payload/);
  });
});

describe('checkBudget (the halt path)', () => {
  it('is a no-op when there is no API key (panel already skips for that reason)', async () => {
    const r = await checkBudget({ apiKey: undefined });
    expect(r).toMatchObject({ halted: false, checked: false });
  });

  it('HALTS when remaining credit is below the floor', async () => {
    const r = await checkBudget({
      apiKey: 'k', floor: 5,
      fetchImpl: mockFetch(200, { data: { total_credits: 10, total_usage: 8 } }),
    });
    expect(r.halted).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.reason).toMatch(/PANEL HALTED: OpenRouter credit floor/);
    expect(r.reason).toMatch(/\$2\.00 < floor \$5\.00/);
  });

  it('does NOT halt when remaining credit is at or above the floor', async () => {
    const atFloor = await checkBudget({
      apiKey: 'k', floor: 5,
      fetchImpl: mockFetch(200, { data: { total_credits: 10, total_usage: 5 } }),
    });
    expect(atFloor.halted).toBe(false);
    expect(atFloor.remaining).toBe(5);

    const aboveFloor = await checkBudget({
      apiKey: 'k', floor: 5,
      fetchImpl: mockFetch(200, { data: { total_credits: 100, total_usage: 10 } }),
    });
    expect(aboveFloor.halted).toBe(false);
  });

  it('a failed credit check does not halt — it proceeds (panel is the backstop)', async () => {
    const r = await checkBudget({ apiKey: 'k', floor: 5, fetchImpl: mockFetch(500, {}) });
    expect(r.halted).toBe(false);
    expect(r.checked).toBe(false);
    expect(r.reason).toMatch(/budget check failed, proceeding/);
  });

  it('uses the default $5 floor when none is passed', async () => {
    const r = await checkBudget({
      apiKey: 'k', fetchImpl: mockFetch(200, { data: { total_credits: 4, total_usage: 0 } }),
    });
    expect(r.halted).toBe(true);
    expect(r.floor).toBe(5);
  });
});
