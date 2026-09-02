import fs from 'node:fs';
import path from 'node:path';

import { readEnvFile } from './env.mjs';

export const SUPPORTED_MODES = Object.freeze(['ios', 'android']);
const MODES = new Set(SUPPORTED_MODES);
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);
const FORBIDDEN_FIND_RELEASE_RESIDUE = /playwill(?:\.io)?|basegames\.net|hidden-object-base/i;
const ACTIVE_ROOT_FILES = new Set([
  '.env.example',
  'capacitor.config.ts',
  'game.config.ts',
  'index.html',
  'package.json',
  'vite.config.ts',
]);
// These are the textual roots consumed by the Vite/native build or copied into
// the shipped bundle. Historical/test/native generated trees stay excluded.
const ACTIVE_DIRECTORIES = new Set(['config', 'design', 'native-resources', 'public', 'src']);
const HISTORICAL_DIRECTORY_NAMES = new Set(['__snapshots__', 'docs', 'test', 'tests']);
const TEXT_FILE_EXTENSIONS = new Set([
  '.cjs', '.css', '.cts', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.mts',
  '.plist', '.svg', '.swift', '.toml', '.ts', '.tsx', '.txt', '.webmanifest',
  '.xcprivacy', '.xml', '.yaml', '.yml',
]);

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

  for (const [key, value] of values) {
    if (FORBIDDEN_FIND_RELEASE_RESIDUE.test(value)) invalidKeys.push(key);
  }

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

function findActiveResidueFiles(gameRoot) {
  const candidates = [];
  for (const fileName of ACTIVE_ROOT_FILES) candidates.push(path.join(gameRoot, fileName));
  for (const directory of ACTIVE_DIRECTORIES) {
    const root = path.join(gameRoot, directory);
    if (!fs.existsSync(root)) continue;
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          const isHistoricalDirectory = directory !== 'public' && HISTORICAL_DIRECTORY_NAMES.has(entry.name);
          if (!isHistoricalDirectory) pending.push(entryPath);
        } else if (
          TEXT_FILE_EXTENSIONS.has(path.extname(entry.name)) &&
          (directory === 'public' || !/\.(?:spec|test)\.[cm]?[jt]s$/.test(entry.name))
        ) {
          candidates.push(entryPath);
        }
      }
    }
  }

  return sorted(candidates.flatMap((filePath) => {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return [];
    return FORBIDDEN_FIND_RELEASE_RESIDUE.test(fs.readFileSync(filePath, 'utf8'))
      ? [path.relative(gameRoot, filePath)]
      : [];
  }));
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
  const residueFiles = findActiveResidueFiles(gameRoot);
  return {
    ok:
      emptyOverrideKeys.length === 0 &&
      resolved.missingKeys.length === 0 &&
      resolved.invalidKeys.length === 0 &&
      residueFiles.length === 0,
    mode,
    ...resolved,
    emptyOverrideKeys,
    residueFiles,
  };
}

function syntheticFixture(policy) {
  const values = new Map(policy.canonicalKeys.map((key) => [key, `synthetic-${key.toLowerCase()}`]));
  for (const key of policy.canonicalKeys.filter((key) =>
    key.endsWith('_ENABLED') ||
    key.endsWith('_LOGGING') ||
    key.endsWith('_ONLY') ||
    key.endsWith('_TEST_MODE') ||
    key === 'VITE_FTD_DISABLE_REMOTE_CONFIG' ||
    key === 'VITE_APPLOVIN_HAS_USER_CONSENT' ||
    key === 'VITE_APPLOVIN_DO_NOT_SELL' ||
    key === 'VITE_APPLOVIN_GDPR_TERMS_ALERT_ENABLED')) {
    values.set(key, 'false');
  }
  // Closed provider choices need valid synthetic values rather than the
  // generic placeholder used for opaque credentials.
  values.set('VITE_AD_PROVIDER', 'auto');
  values.set('VITE_ATTRIBUTION_PROVIDER', 'auto');
  values.set('VITE_REVENUECAT_IOS_API_KEY', 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n');
  // Capture-tour script is shell-env-only; a persisted value is invalid by
  // policy, so the all-keys synthetic fixture must leave it unset.
  values.set('VITE_INSITU_TOUR', '');
  return values;
}

export function runDryRun({ mode, policy }) {
  if (!MODES.has(mode)) throw new Error(`unsupported mode: ${mode}`);
  const fixture = syntheticFixture(policy);
  policy.configureSyntheticFixture?.(fixture, mode);
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
  const assignmentsAreSafe = parsed.assignments.every(({ key, value }) =>
    (key === 'VITE_APPSFLYER_SHARING_PARTNERS' && value === '')
      || /^(?:auto|true|false|__[-A-Z0-9_]+__|https:\/\/example\.invalid(?:\/.*)?)$/.test(value),
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
