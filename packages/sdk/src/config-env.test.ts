import { describe, expect, it } from 'vitest';
import { parseChoiceEnv } from './config-env.ts';

describe('parseChoiceEnv', (): void => {
  const choices = ['auto', 'enabled', 'disabled'] as const;

  it('uses the default only when the value is absent or blank', (): void => {
    expect(parseChoiceEnv(undefined, choices, 'auto')).toBe('auto');
    expect(parseChoiceEnv('  ', choices, 'auto')).toBe('auto');
  });

  it('normalizes a configured choice', (): void => {
    expect(parseChoiceEnv(' ENABLED ', choices, 'auto')).toBe('enabled');
  });

  it('rejects typos instead of silently selecting a provider', (): void => {
    expect(() => parseChoiceEnv('enable', choices, 'auto')).toThrow(
      'expected one of: auto, enabled, disabled',
    );
  });
});
