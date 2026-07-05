import { describe, expect, test } from 'vitest';

import { assignWindowBindings } from './windowBindings.ts';

describe('assignWindowBindings', (): void => {
  test('restores existing values on cleanup', (): void => {
    const target: Record<string, unknown> = {
      existing: 1,
    };

    const cleanup = assignWindowBindings(target, {
      existing: 2,
      added: true,
    });

    expect(target).toEqual({
      existing: 2,
      added: true,
    });

    cleanup();

    expect(target).toEqual({
      existing: 1,
    });
  });
});
