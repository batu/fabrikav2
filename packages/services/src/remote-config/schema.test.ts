import { describe, expect, it } from 'vitest';
import {
  booleanField,
  coerceConfigValue,
  defaultValues,
  numberField,
  remoteKeyFor,
  stringField,
  type ConfigSchema,
} from './schema.ts';

describe('remote-config schema coercion + validation', (): void => {
  it('accepts native primitives of the declared type', (): void => {
    expect(coerceConfigValue(booleanField(false), true)).toEqual({ ok: true, value: true });
    expect(coerceConfigValue(numberField(0), 42)).toEqual({ ok: true, value: 42 });
    expect(coerceConfigValue(stringField(''), 'hello')).toEqual({ ok: true, value: 'hello' });
  });

  it('coerces string wire forms (Firebase delivers everything as strings)', (): void => {
    expect(coerceConfigValue(booleanField(false), 'true')).toEqual({ ok: true, value: true });
    expect(coerceConfigValue(booleanField(true), 'FALSE')).toEqual({ ok: true, value: false });
    expect(coerceConfigValue(numberField(0), '3')).toEqual({ ok: true, value: 3 });
  });

  it('reports wrong_type when a value cannot be coerced to the declared type', (): void => {
    expect(coerceConfigValue(booleanField(false), 'yes')).toEqual({ ok: false, reason: 'wrong_type' });
    expect(coerceConfigValue(numberField(0), 'not-a-number')).toEqual({ ok: false, reason: 'wrong_type' });
    expect(coerceConfigValue(numberField(0), Number.POSITIVE_INFINITY)).toEqual({ ok: false, reason: 'wrong_type' });
  });

  it('reports absent for undefined/null so callers fall back to the default', (): void => {
    expect(coerceConfigValue(numberField(5), undefined)).toEqual({ ok: false, reason: 'absent' });
    expect(coerceConfigValue(numberField(5), null)).toEqual({ ok: false, reason: 'absent' });
  });

  it('applies the field domain validate after coercion', (): void => {
    const nonNegative = numberField(0, { validate: (v) => v >= 0 });
    expect(coerceConfigValue(nonNegative, 4)).toEqual({ ok: true, value: 4 });
    expect(coerceConfigValue(nonNegative, -1)).toEqual({ ok: false, reason: 'failed_validate' });

    const nonEmpty = stringField('x', { validate: (v) => v.trim().length > 0 });
    expect(coerceConfigValue(nonEmpty, '   ')).toEqual({ ok: false, reason: 'failed_validate' });
  });

  it('resolves remoteKey, falling back to the schema key', (): void => {
    expect(remoteKeyFor('hintRwEnabled', booleanField(true, { remoteKey: 'hint_rw_enabled' }))).toBe('hint_rw_enabled');
    expect(remoteKeyFor('hintRwEnabled', booleanField(true))).toBe('hintRwEnabled');
  });

  it('builds the all-defaults values object from a schema', (): void => {
    const schema = {
      enabled: booleanField(true),
      count: numberField(3),
      productId: stringField('com.example.pack'),
    } satisfies ConfigSchema;

    expect(defaultValues(schema)).toEqual({ enabled: true, count: 3, productId: 'com.example.pack' });
  });
});
