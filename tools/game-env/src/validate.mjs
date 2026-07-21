import path from 'node:path';

import { readEnvFile } from './env.mjs';

export const SUPPORTED_MODES = Object.freeze(['ios', 'android']);
const MODES = new Set(SUPPORTED_MODES);
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

function sorted(values) {
  return [...new Set(values)].sort();
}

function booleanValue(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function isUnresolved(value, placeholderValue) {
  if (typeof value !== 'string' || value.trim() === '') return true;
  return placeholderValue !== undefined && value.trim() === placeholderValue.trim();
}

function validateResolvedValues({ values, mode, policy, placeholders = new Map() }) {
  const missingKeys = [];
  const invalidKeys = [];

  for (const key of policy.intentKeys(mode)) {
    if (booleanValue(values.get(key)) === null) invalidKeys.push(key);
  }

  const requireValue = (key) => {
    if (isUnresolved(values.get(key), placeholders.get(key))) missingKeys.push(key);
  };

  policy.validateConditional({ values, mode, booleanValue, requireValue, invalidKeys });

  return {
    missingKeys: sorted(missingKeys),
    invalidKeys: sorted(invalidKeys),
  };
}

function findEmptyOverrideKeys(baseValues, overrideAssignments, requiredKeys = []) {
  const required = new Set(requiredKeys);
  return sorted(overrideAssignments.flatMap((assignment) => {
    if (assignment.value !== '') return [];
    const baseValue = baseValues.get(assignment.key);
    if (baseValue === undefined || baseValue === '') return [];
    if (assignment.intentionalBlank && !required.has(assignment.key)) return [];
    return [assignment.key];
  }));
}

function readTemplateValues(gameRoot) {
  return readEnvFile(path.join(gameRoot, '.env.example')).values;
}

export function validateEnvironment({ gameRoot, mode, policy, environment = process.env }) {
  if (!MODES.has(mode)) throw new Error(`unsupported mode: ${mode}`);

  const fileValues = new Map();
  for (const fileName of ['.env', '.env.local', `.env.${mode}`]) {
    for (const [key, value] of readEnvFile(path.join(gameRoot, fileName)).values) {
      fileValues.set(key, value);
    }
  }

  const shellValues = new Map(Object.entries(environment).map(([key, value]) => [key, String(value)]));
  const override = readEnvFile(path.join(gameRoot, `.env.${mode}.local`));
  const beforeOverride = new Map(fileValues);
  if (mode === 'ios') {
    for (const entry of shellValues) beforeOverride.set(...entry);
  }

  const values = new Map(beforeOverride);
  for (const entry of override.values) values.set(...entry);
  if (mode !== 'ios') {
    for (const entry of shellValues) values.set(...entry);
  }

  const requiredKeys = policy.intentKeys(mode);
  const emptyOverrideBase = new Map(beforeOverride);
  if (mode !== 'ios') {
    // Standard Vite precedence keeps launching-shell keys above Android's
    // mode-local file, so that file cannot blank a key the shell supplies.
    for (const key of shellValues.keys()) emptyOverrideBase.delete(key);
  }
  const emptyOverrideKeys = findEmptyOverrideKeys(
    emptyOverrideBase,
    override.assignments,
    requiredKeys,
  );
  const resolved = validateResolvedValues({
    values,
    mode,
    policy,
    placeholders: readTemplateValues(gameRoot),
  });
  return {
    ok:
      emptyOverrideKeys.length === 0 &&
      resolved.missingKeys.length === 0 &&
      resolved.invalidKeys.length === 0,
    mode,
    ...resolved,
    emptyOverrideKeys,
  };
}

function syntheticFixture(policy) {
  const values = new Map(policy.canonicalKeys.map((key) => [key, `synthetic-${key.toLowerCase()}`]));
  for (const key of policy.canonicalKeys.filter((key) =>
    key.endsWith('_ENABLED') ||
    key.endsWith('_LOGGING') ||
    key.endsWith('_ONLY') ||
    key === 'VITE_FTD_DISABLE_REMOTE_CONFIG' ||
    key === 'VITE_APPLOVIN_HAS_USER_CONSENT' ||
    key === 'VITE_APPLOVIN_DO_NOT_SELL' ||
    key === 'VITE_APPLOVIN_GDPR_TERMS_ALERT_ENABLED')) {
    values.set(key, 'false');
  }
  // Capture-tour script is shell-env-only; a persisted value is invalid by
  // policy, so the all-keys synthetic fixture must leave it unset.
  values.set('VITE_INSITU_TOUR', '');
  return values;
}

export function runDryRun({ mode, policy }) {
  if (!MODES.has(mode)) throw new Error(`unsupported mode: ${mode}`);
  const fixture = syntheticFixture(policy);
  const positive = validateResolvedValues({ values: fixture, mode, policy });
  if (positive.missingKeys.length || positive.invalidKeys.length) {
    throw new Error('complete synthetic fixture did not pass');
  }

  const missingFixture = new Map(fixture);
  const expectedMissingKey = policy.configureMissingDryRunCase(missingFixture, mode);
  missingFixture.delete(expectedMissingKey);
  const negative = validateResolvedValues({ values: missingFixture, mode, policy });
  if (!negative.missingKeys.includes(expectedMissingKey)) {
    throw new Error('missing required value was not rejected');
  }

  const emptyOverrideKeys = findEmptyOverrideKeys(
    new Map([['VITE_FTD_SUPPORT_URL', 'synthetic-base-value']]),
    [{ key: 'VITE_FTD_SUPPORT_URL', value: '', intentionalBlank: false }],
  );
  if (!emptyOverrideKeys.includes('VITE_FTD_SUPPORT_URL')) {
    throw new Error('empty override was not rejected');
  }

  return {
    ok: true,
    mode,
    assertions: [
      'complete synthetic placeholder fixture passed',
      mode === 'ios'
        ? 'missing required iOS value was rejected'
        : 'missing required Android value was rejected',
      'empty mode-local override was rejected',
    ],
    releaseConfigurationValidated: false,
  };
}

export function validateTemplate(templatePath, policy) {
  const parsed = readEnvFile(templatePath);
  const keys = [...parsed.values.keys()].sort();
  const expected = [...policy.canonicalKeys].sort();
  const assignmentsAreSafe = parsed.assignments.every(({ value }) =>
    /^(?:true|false|__[-A-Z0-9_]+__|https:\/\/example\.invalid(?:\/.*)?)$/.test(value),
  );
  const oneCommentPerAssignment = parsed.assignments.every(({ hasPurposeComment }) => hasPurposeComment);
  return {
    ok:
      keys.length === expected.length &&
      parsed.assignments.length === expected.length &&
      keys.every((key, index) => key === expected[index]) &&
      assignmentsAreSafe &&
      oneCommentPerAssignment,
    keys,
  };
}
