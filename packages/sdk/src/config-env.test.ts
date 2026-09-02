import { describe, expect, it } from 'vitest';
import {
  isRevenueCatAndroidPublicKey,
  isRevenueCatIosPublicKey,
  parseChoiceEnv,
  sha256Hex,
} from './config-env.ts';

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['Türkçe', '0f8b5cb2e84b210d34a4af531296431bc595bb2321d77179deb42718de75bfae'],
  ])('matches the SHA-256 vector for %j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });
});

describe('isRevenueCatIosPublicKey', () => {
  it('accepts only the observed production iOS public key shape', () => {
    expect(isRevenueCatIosPublicKey(`appl_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n'}`)).toBe(true);
  });

  it.each([
    '__SET_IN_LOCAL_ENV__',
    'test_abcdefghijklmnopqrstuvwxyz0',
    'goog_abcdefghijklmnopqrstuvwxyz0',
    ` appl_${'a'.repeat(27)}`,
    `appl_${'a'.repeat(26)}`,
    `appl_${'a'.repeat(26)}-`,
  ])('rejects placeholder, test, wrong-prefix, whitespace, or malformed key: %s', (value) => {
    expect(isRevenueCatIosPublicKey(value)).toBe(false);
  });
});

describe('isRevenueCatAndroidPublicKey', () => {
  it('accepts only owner public goog_ keys', () => {
    expect(isRevenueCatAndroidPublicKey(`goog_${'a'.repeat(28)}`)).toBe(true);
    expect(isRevenueCatAndroidPublicKey('test_placeholder_key')).toBe(false);
    expect(isRevenueCatAndroidPublicKey('goog_bad-key')).toBe(false);
  });
});

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
