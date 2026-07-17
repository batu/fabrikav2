import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { loadGameEnv, parseEnvText } from '../src/env.mjs';
import {
  runDryRun,
  validateEnvironment,
  validateTemplate,
} from '../src/validate.mjs';
import { getGamePolicy } from '../src/policies.mjs';
import { FIND_THE_DOG_ENV_KEYS } from '../src/policies/find-the-dog.mjs';
import { resolveFindTheDogViteConfig } from '../../../games/find_the_dog/vite.config.ts';

const temporaryDirectories = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cliPath = path.join(repoRoot, 'tools/game-env/validate.mjs');
const policy = getGamePolicy('find_the_dog');

function runCli(args, environment = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.join(repoRoot, 'games/find_the_dog'),
    encoding: 'utf8',
    env: environment,
  });
}

function makeGameRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-env-'));
  temporaryDirectories.push(root);
  return root;
}

function write(root, name, contents) {
  fs.writeFileSync(path.join(root, name), contents);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('dotenv parsing and loading', () => {
  it('supports export, quotes, inline comments, CRLF, and last assignment wins', () => {
    const parsed = parseEnvText(
      "export ALPHA='one'\r\nBETA=two # comment\r\nALPHA=three\r\n",
      { fileName: '.env' },
    );

    expect(Object.fromEntries(parsed.values)).toEqual({ ALPHA: 'three', BETA: 'two' });
  });

  it('fails closed on interpolation and multiline values', () => {
    expect(() => parseEnvText('KEY=${OTHER}\n', { fileName: '.env' })).toThrow(/KEY/);
    expect(() => parseEnvText('KEY="first\nsecond"\n', { fileName: '.env' })).toThrow(/KEY/);
  });

  it('loads .env.local over .env without replacing launching-shell keys', () => {
    const root = makeGameRoot();
    write(root, '.env', 'FROM_FILE=base\nSHELL_WINS=base\n');
    write(root, '.env.local', 'FROM_FILE=local\nSHELL_WINS=local\n');
    const environment = { SHELL_WINS: 'shell' };

    loadGameEnv({ gameRoot: root, environment });

    expect(environment).toEqual({ FROM_FILE: 'local', SHELL_WINS: 'shell' });
  });
});

describe('environment validation', () => {
  it('requires explicit mode-relevant provider intent flags', () => {
    const root = makeGameRoot();
    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} });

    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toContain('VITE_GAMEANALYTICS_IOS_ENABLED');
    expect(result.invalidKeys).toContain('VITE_ADJUST_IOS_ENABLED');
    expect(result.invalidKeys).toContain('VITE_APPLOVIN_IOS_ENABLED');
    expect(result.invalidKeys).toContain('VITE_CDN_ENABLED');
  });

  it('requires enabled provider credentials and names only the missing keys', () => {
    const root = makeGameRoot();
    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=true',
      'VITE_GAMEANALYTICS_IOS_GAME_KEY=synthetic-game-key',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_APPLOVIN_IOS_ENABLED=false',
      'VITE_CDN_ENABLED=false',
      '',
    ].join('\n'));

    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} });

    expect(result.ok).toBe(false);
    expect(result.missingKeys).toEqual(['VITE_GAMEANALYTICS_IOS_SECRET_KEY']);
    expect(JSON.stringify(result)).not.toContain('synthetic-game-key');
  });

  it('allows disabled providers without credentials', () => {
    const root = makeGameRoot();
    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=false',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_APPLOVIN_IOS_ENABLED=false',
      'VITE_CDN_ENABLED=false',
      '',
    ].join('\n'));

    expect(validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} }).ok).toBe(true);
  });

  it.each([
    {
      mode: 'ios',
      enabled: 'VITE_ADJUST_IOS_ENABLED',
      required: ['VITE_ADJUST_IOS_APP_TOKEN', 'VITE_ADJUST_IOS_ENVIRONMENT'],
    },
    {
      mode: 'ios',
      enabled: 'VITE_APPLOVIN_IOS_ENABLED',
      required: ['VITE_APPLOVIN_IOS_SDK_KEY'],
      invalid: ['VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY'],
    },
    {
      mode: 'android',
      enabled: 'VITE_APPLOVIN_ANDROID_ENABLED',
      required: ['VITE_APPLOVIN_ANDROID_SDK_KEY'],
      invalid: ['VITE_APPLOVIN_ANDROID_GENERAL_AUDIENCE_ONLY'],
    },
  ])('requires enabled-provider configuration for $mode $enabled', ({ mode, enabled, required, invalid = [] }) => {
    const root = makeGameRoot();
    const environment = {
      VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      VITE_CDN_ENABLED: 'false',
      VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
      VITE_ADJUST_IOS_ENABLED: 'false',
      VITE_APPLOVIN_IOS_ENABLED: 'false',
      VITE_APPLOVIN_ANDROID_ENABLED: 'false',
      [enabled]: 'true',
    };

    const result = validateEnvironment({ gameRoot: root, mode, policy, environment });

    expect(result.missingKeys).toEqual(required);
    expect(result.invalidKeys).toEqual(invalid);
  });

  it('rejects an exact template placeholder for an enabled required key', () => {
    const root = makeGameRoot();
    fs.copyFileSync(path.join(repoRoot, 'games/find_the_dog/.env.example'), path.join(root, '.env.example'));
    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=true',
      'VITE_GAMEANALYTICS_IOS_GAME_KEY=__SET_IN_LOCAL_ENV__',
      'VITE_GAMEANALYTICS_IOS_SECRET_KEY=synthetic-secret',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_APPLOVIN_IOS_ENABLED=false',
      'VITE_CDN_ENABLED=false',
      '',
    ].join('\n'));

    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} });

    expect(result.missingKeys).toEqual(['VITE_GAMEANALYTICS_IOS_GAME_KEY']);
  });

  it('rejects accidental empty overrides but honors intentional-blank for optional values', () => {
    const root = makeGameRoot();
    write(root, '.env', 'VITE_FTD_SUPPORT_URL=https://example.invalid/support\n');
    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=false',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_APPLOVIN_IOS_ENABLED=false',
      'VITE_CDN_ENABLED=false',
      'VITE_FTD_SUPPORT_URL=',
      '',
    ].join('\n'));

    expect(validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} }).emptyOverrideKeys)
      .toEqual(['VITE_FTD_SUPPORT_URL']);

    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=false',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_APPLOVIN_IOS_ENABLED=false',
      'VITE_CDN_ENABLED=false',
      '# intentional-blank: use the runtime fallback',
      'VITE_FTD_SUPPORT_URL=',
      '',
    ].join('\n'));

    expect(validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} }).ok).toBe(true);
  });

  it('keeps launching-shell precedence over Android mode-local values', () => {
    const root = makeGameRoot();
    write(root, '.env.android.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_APPLOVIN_ANDROID_ENABLED=false',
      'VITE_CDN_ENABLED=',
      '',
    ].join('\n'));

    const result = validateEnvironment({
      gameRoot: root,
      mode: 'android',
      policy,
      environment: { VITE_CDN_ENABLED: 'false' },
    });

    expect(result.ok).toBe(true);
    expect(result.emptyOverrideKeys).toEqual([]);
  });

  it('runs a hermetic dry-run with positive and deliberate negative assertions', () => {
    const result = runDryRun({ mode: 'ios', policy });

    expect(result.ok).toBe(true);
    expect(result.assertions).toEqual([
      'complete synthetic placeholder fixture passed',
      'missing required iOS value was rejected',
      'empty mode-local override was rejected',
    ]);
    expect(result.releaseConfigurationValidated).toBe(false);
  });

  it('runs the Android dry-run contract', () => {
    const result = runDryRun({ mode: 'android', policy });

    expect(result.ok).toBe(true);
    expect(result.assertions).toContain('missing required Android value was rejected');
    expect(result.releaseConfigurationValidated).toBe(false);
  });
});

describe('canonical template', () => {
  it('contains the exact 57-key placeholder-only contract with one comment per assignment', () => {
    const templatePath = path.join(repoRoot, 'games/find_the_dog/.env.example');
    const result = validateTemplate(templatePath, policy);

    expect(result.ok).toBe(true);
    expect(result.keys).toEqual([...FIND_THE_DOG_ENV_KEYS].sort());
    expect(result.keys).toHaveLength(57);
  });

  it('rejects duplicate assignments even when the final key set is exact', () => {
    const root = makeGameRoot();
    const source = fs.readFileSync(path.join(repoRoot, 'games/find_the_dog/.env.example'), 'utf8');
    const templatePath = path.join(root, '.env.example');
    write(root, '.env.example', `${source}\n# Duplicate must fail the exact contract.\nVITE_CDN_ENABLED=false\n`);

    expect(validateTemplate(templatePath, policy).ok).toBe(false);
  });
});

describe('Vite mode configuration', () => {
  it('force-loads iOS values, restores them for later modes, and exposes only canonical prefixes', () => {
    const root = makeGameRoot();
    const key = 'VITE_REVENUECAT_IOS_API_KEY';
    const unknownKey = 'VITE_UNKNOWN_BUILD_OVERRIDE';
    const previous = process.env[key];
    const previousUnknown = process.env[unknownKey];
    process.env[key] = 'ambient-value';
    process.env[unknownKey] = 'ambient-unknown';
    write(root, '.env.ios.local', [
      `export ${key}="ios-local-value"`,
      `${unknownKey}=ios-local-unknown`,
      '',
    ].join('\n'));

    try {
      const ios = resolveFindTheDogViteConfig('ios', root);
      expect(process.env[key]).toBe('ios-local-value');
      expect(process.env[unknownKey]).toBe('ambient-unknown');
      expect(ios.envPrefix).toContain('VITE_REVENUECAT_IOS_API_KEY');
      expect(ios.envPrefix).not.toContain('VITE_REVENUECAT_ANDROID_API_KEY');
      expect(ios.envPrefix).toContain('VITE_GAMEANALYTICS_IOS_GAME_KEY');
      expect(ios.envPrefix).not.toContain('VITE_FTD_OWNED_ANALYTICS_MIRROR_ENABLED');

      const android = resolveFindTheDogViteConfig('android', root);
      expect(process.env[key]).toBe('ambient-value');
      expect(android.envPrefix).toContain('VITE_REVENUECAT_ANDROID_API_KEY');
      expect(android.envPrefix).not.toContain('VITE_REVENUECAT_IOS_API_KEY');
      expect(android.envPrefix).not.toContain('VITE_GAMEANALYTICS_IOS_GAME_KEY');

      const development = resolveFindTheDogViteConfig('development', root);
      expect(development.envPrefix).not.toContain('VITE_REVENUECAT_IOS_API_KEY');
      expect(development.envPrefix).not.toContain('VITE_REVENUECAT_ANDROID_API_KEY');
      expect(development.envPrefix).not.toContain('VITE_APPLOVIN_IOS_SDK_KEY');
      expect(development.envPrefix).not.toContain('VITE_APPLOVIN_ANDROID_SDK_KEY');
    } finally {
      resolveFindTheDogViteConfig('android', root);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
      if (previousUnknown === undefined) delete process.env[unknownKey];
      else process.env[unknownKey] = previousUnknown;
    }
  });
});

describe('validator CLI', () => {
  it.each([
    [['--wat'], 'unknown flag'],
    [['--mode', 'ios', '--mode', 'android'], 'repeated flag'],
    [['--mode', 'ios', '--dry-run', '--warn'], 'cannot be combined'],
    [['--mode'], 'requires a value'],
  ])('rejects invalid arguments with exit 2', (args, message) => {
    const result = runCli(args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it('keeps dry-run hermetic and secret-safe in JSON mode', () => {
    const result = runCli(
      ['--game', 'find_the_dog', '--mode', 'ios', '--dry-run', '--json'],
      { VITE_GAMEANALYTICS_IOS_GAME_KEY: 'ambient-canary-do-not-print' },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).releaseConfigurationValidated).toBe(false);
    expect(`${result.stdout}${result.stderr}`).not.toContain('ambient-canary-do-not-print');
  });

  it('fails normal iOS validation loudly without printing ambient values', () => {
    const canary = 'ambient-canary-do-not-print';
    const result = runCli(
      ['--game', 'find_the_dog', '--mode', 'ios'],
      {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: canary,
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_APPLOVIN_IOS_ENABLED: 'false',
        VITE_CDN_ENABLED: 'false',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_GAMEANALYTICS_IOS_SECRET_KEY');
    expect(`${result.stdout}${result.stderr}`).not.toContain(canary);
  });
});
