import { describe, expect, test } from 'vitest';

import { createTuningStore } from './tuningStore.ts';

describe('createTuningStore', (): void => {
  test('tracks changed values against immutable defaults', (): void => {
    const store = createTuningStore<{
      alpha: number;
      enabled: boolean;
      speed: number;
    }>({
      alpha: 0.5,
      enabled: true,
      speed: 2,
    });

    store.current.alpha = 0.7;
    store.current.enabled = false;

    expect(store.getChangedValues()).toEqual({
      alpha: 0.7,
      enabled: false,
    });
  });

  test('resets current values back to defaults', (): void => {
    const store = createTuningStore<{
      amount: number;
      enabled: boolean;
    }>({
      amount: 10,
      enabled: true,
    });

    store.current.amount = 15;
    store.current.enabled = false;
    store.reset();

    expect(store.get()).toEqual({
      amount: 10,
      enabled: true,
    });
    expect(store.getChangedValues()).toEqual({});
  });
});
