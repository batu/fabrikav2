import { describe, expect, it } from 'vitest';
import { AppsFlyerEventMapper } from './AppsFlyerEventMapper.ts';

describe('AppsFlyerEventMapper', () => {
  it('maps only bounded approved events', () => {
    const mapper = new AppsFlyerEventMapper();
    expect(mapper.map({ type: 'tutorial_completed', tutorialId: 'intro' })).toEqual({ eventName: 'af_tutorial_completion', eventValues: { af_tutorial_id: 'intro' } });
    expect(mapper.map({ type: 'progression_milestone', level: 10 })?.eventValues).toEqual({ af_level: '10' });
    expect(mapper.map({ type: 'progression_milestone', level: 0 })).toBeNull();
  });

  it('validates and deduplicates revenue by class and stable id', () => {
    const mapper = new AppsFlyerEventMapper();
    const purchase = { type: 'purchase_verified', revenue: 2.99, currency: 'USD', productId: 'coins', transactionId: 'same' } as const;
    expect(mapper.map(purchase)?.eventName).toBe('af_purchase');
    expect(mapper.map(purchase)).toBeNull();
    expect(mapper.map({ type: 'ad_revenue', revenue: 0.01, currency: 'USD', format: 'rewarded', placement: 'level_end', impressionId: 'same' })?.eventName).toBe('af_ad_revenue');
    expect(mapper.map({ ...purchase, transactionId: 'bad', currency: 'usd' })).toBeNull();
    expect(mapper.map({ ...purchase, transactionId: 'nan', revenue: Number.NaN })).toBeNull();
  });

  it('honors durable callback dedupe', () => {
    const keys = new Set(['ad:seen']);
    const mapper = new AppsFlyerEventMapper({ has: (key) => keys.has(key), add: (key) => { keys.add(key); } });
    expect(mapper.map({ type: 'ad_revenue', revenue: 1, currency: 'EUR', format: 'banner', placement: 'home', impressionId: 'seen' })).toBeNull();
  });
});
