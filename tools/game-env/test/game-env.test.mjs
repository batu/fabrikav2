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
import { createFindTheDogPolicy, FIND_THE_DOG_ENV_KEYS } from '../src/policies/find-the-dog.mjs';
import { resolveFindTheDogViteConfig } from '../../../games/find_the_dog/vite.config.ts';

const temporaryDirectories = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cliPath = path.join(repoRoot, 'tools/game-env/validate.mjs');
const productionPolicy = getGamePolicy('find_the_dog');
const policy = createFindTheDogPolicy({
  approvedGameAnalyticsGameKeys: ['a'.repeat(32)],
  approvedOwnedMirrorEndpointUrls: ['https://example.invalid/analytics'],
});

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

function runCliWithoutLocalOverrides(args, environment = {}) {
  const root = makeGameRoot();
  const fixtureTools = path.join(root, 'tools/game-env');
  const fixtureGame = path.join(root, 'games/find_the_dog');
  fs.mkdirSync(path.dirname(fixtureTools), { recursive: true });
  fs.mkdirSync(fixtureGame, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'tools/game-env'), fixtureTools, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'games/find_the_dog/.env.example'), path.join(fixtureGame, '.env.example'));
  return spawnSync(process.execPath, [path.join(fixtureTools, 'validate.mjs'), ...args], {
    cwd: fixtureGame,
    encoding: 'utf8',
    env: environment,
  });
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
    expect(result.invalidKeys).toContain('VITE_ADMOB_IOS_ENABLED');
    expect(result.invalidKeys).toContain('VITE_ADMOB_IOS_TEST_MODE');
    expect(result.invalidKeys).toContain('VITE_CDN_ENABLED');
  });

  it('requires enabled provider credentials and names only the missing keys', () => {
    const root = makeGameRoot();
    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=true',
      'VITE_GAMEANALYTICS_IOS_GAME_KEY=synthetic-game-key',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_TEST_MODE=false',
      'VITE_REVENUECAT_IOS_API_KEY=appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      'VITE_CDN_ENABLED=false',
      '',
    ].join('\n'));

    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} });

    expect(result.ok).toBe(false);
    expect(result.missingKeys).toEqual(['VITE_GAMEANALYTICS_IOS_SECRET_KEY']);
    expect(JSON.stringify(result)).not.toContain('synthetic-game-key');
  });

  it('allows optional iOS providers to remain disabled when the required analytics stack is valid', () => {
    const root = makeGameRoot();
    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=true',
      'VITE_GAMEANALYTICS_IOS_GAME_ID=find_the_dog',
      `VITE_GAMEANALYTICS_IOS_GAME_KEY=${'a'.repeat(32)}`,
      `VITE_GAMEANALYTICS_IOS_SECRET_KEY=${'b'.repeat(40)}`,
      'VITE_ATTRIBUTION_PROVIDER=appsflyer',
      'VITE_APPSFLYER_ENABLED=true',
      'VITE_APPSFLYER_DEV_KEY=A1b2C3d4E5f6G7h8I9j0',
      'VITE_APPSFLYER_APPLE_APP_ID=6772100729',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_TEST_MODE=false',
      'VITE_REVENUECAT_IOS_API_KEY=appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      'VITE_CDN_ENABLED=false',
      '',
    ].join('\n'));

    expect(validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} }).ok).toBe(true);
  });

  it('rejects production iOS when product analytics resolves to local-only sinks', () => {
    const root = makeGameRoot();
    const result = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
        VITE_APPSFLYER_ENABLED: 'true',
        VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0',
        VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
        VITE_CDN_ENABLED: 'false',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toContain('VITE_GAMEANALYTICS_IOS_ENABLED');
  });

  it('rejects a malformed owned mirror as a durable production sink', () => {
    const root = makeGameRoot();
    const result = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
        VITE_FTD_OWNED_ANALYTICS_MIRROR_URL: 'http://localhost/ingest?token=secret',
        VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY: 'short',
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
        VITE_APPSFLYER_ENABLED: 'true',
        VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0',
        VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
        VITE_CDN_ENABLED: 'false',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toEqual(expect.arrayContaining([
      'VITE_FTD_OWNED_ANALYTICS_MIRROR_URL',
      'VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY',
    ]));
  });

  it('rejects well-shaped but unapproved FTD analytics identities and permits injected synthetic fixtures', () => {
    const root = makeGameRoot();
    const environment = {
      VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
      VITE_FTD_OWNED_ANALYTICS_MIRROR_URL: 'https://example.invalid/analytics',
      VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY: 'synthetic-public-client-key',
      VITE_ADJUST_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_TEST_MODE: 'false',
      VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
      VITE_APPSFLYER_ENABLED: 'true',
      VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0',
      VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
      VITE_CDN_ENABLED: 'false',
    };

    const rejected = validateEnvironment({ gameRoot: root, mode: 'ios', policy: productionPolicy, environment });
    const injected = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy: createFindTheDogPolicy({
        approvedGameAnalyticsGameKeys: ['a'.repeat(32)],
        approvedOwnedMirrorEndpointUrls: ['https://example.invalid/analytics'],
      }),
      environment,
    });

    expect(rejected.invalidKeys).toEqual(expect.arrayContaining([
      'VITE_GAMEANALYTICS_IOS_GAME_KEY',
      'VITE_FTD_OWNED_ANALYTICS_MIRROR_URL',
    ]));
    expect(injected.ok).toBe(true);
  });

  it('requires AppsFlyer as the production iOS attribution provider', () => {
    const root = makeGameRoot();
    const result = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
        VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_ATTRIBUTION_PROVIDER: 'disabled',
        VITE_APPSFLYER_ENABLED: 'false',
        VITE_CDN_ENABLED: 'false',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toEqual(expect.arrayContaining([
      'VITE_APPSFLYER_ENABLED',
      'VITE_ATTRIBUTION_PROVIDER',
    ]));
  });

  it.each([undefined, 'find_the_bird'])('rejects non-FTD GameAnalytics identity: %s', (gameIdentity) => {
    const root = makeGameRoot();
    const environment = {
      VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
      VITE_ADJUST_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_TEST_MODE: 'false',
      VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
      VITE_APPSFLYER_ENABLED: 'true',
      VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0',
      VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
      VITE_CDN_ENABLED: 'false',
      ...(gameIdentity === undefined ? {} : { VITE_GAMEANALYTICS_IOS_GAME_ID: gameIdentity }),
    };

    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment });

    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toContain('VITE_GAMEANALYTICS_IOS_GAME_ID');
    expect(JSON.stringify(result)).not.toContain('find_the_bird');
  });

  it('rejects malformed GameAnalytics credentials without printing them', () => {
    const root = makeGameRoot();
    const malformedGameKey = 'not-a-real-gameanalytics-key!!!!';
    const malformedSecretKey = 'not-a-real-gameanalytics-secret-key!!!!!!!!';
    const result = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: malformedGameKey,
        VITE_GAMEANALYTICS_IOS_SECRET_KEY: malformedSecretKey,
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
        VITE_APPSFLYER_ENABLED: 'true',
        VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0',
        VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
        VITE_CDN_ENABLED: 'false',
      },
    });

    expect(result.invalidKeys).toEqual(expect.arrayContaining([
      'VITE_GAMEANALYTICS_IOS_GAME_KEY',
      'VITE_GAMEANALYTICS_IOS_SECRET_KEY',
    ]));
    expect(JSON.stringify(result)).not.toContain(malformedGameKey);
    expect(JSON.stringify(result)).not.toContain(malformedSecretKey);
  });

  it('requires an owner-controlled RevenueCat key for every iOS release environment', () => {
    const root = makeGameRoot();
    const result = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_CDN_ENABLED: 'false',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.missingKeys).toContain('VITE_REVENUECAT_IOS_API_KEY');
  });

  it.each([
    '__SET_IN_LOCAL_ENV__',
    'test_placeholder_key',
    'goog_abcdefghijklmnopqrstuvwxyz0',
    ' appl_abcdefghijklmnopqrstuvwxyz0',
    'appl_bad-key',
  ])('rejects non-production RevenueCat iOS public key shape: %s', (apiKey) => {
    const root = makeGameRoot();
    const result = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_REVENUECAT_IOS_API_KEY: apiKey,
        VITE_CDN_ENABLED: 'false',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toContain('VITE_REVENUECAT_IOS_API_KEY');
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it('rejects invalid provider choices and incomplete AppsFlyer configuration', () => {
    const root = makeGameRoot();
    const base = {
      VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
      VITE_ADJUST_IOS_ENABLED: 'false',
      VITE_APPLOVIN_IOS_ENABLED: 'false',
      VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      VITE_CDN_ENABLED: 'false',
      VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(28)}`,
    };

    const invalidChoice = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: { ...base, VITE_AD_PROVIDER: 'ad-mob' },
    });
    expect(invalidChoice.invalidKeys).toContain('VITE_AD_PROVIDER');

    const incompleteAppsFlyer = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: { ...base, VITE_APPSFLYER_ENABLED: 'true' },
    });
    expect(incompleteAppsFlyer.missingKeys).toEqual([
      'VITE_APPSFLYER_APPLE_APP_ID',
      'VITE_APPSFLYER_DEV_KEY',
    ]);
  });

  it('rejects malformed or wrong-app AppsFlyer configuration without printing values', () => {
    const root = makeGameRoot();
    const malformedDevKey = 'not-a-valid-appsflyer-key';
    const wrongAppleAppId = '1234567890';
    const result = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
        VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
        VITE_APPSFLYER_ENABLED: 'true',
        VITE_APPSFLYER_DEV_KEY: malformedDevKey,
        VITE_APPSFLYER_APPLE_APP_ID: wrongAppleAppId,
        VITE_CDN_ENABLED: 'false',
      },
    });

    expect(result.invalidKeys).toEqual(expect.arrayContaining([
      'VITE_APPSFLYER_DEV_KEY',
      'VITE_APPSFLYER_APPLE_APP_ID',
    ]));
    expect(JSON.stringify(result)).not.toContain(malformedDevKey);
    expect(JSON.stringify(result)).not.toContain(wrongAppleAppId);
  });

  it.each([
    ['play' + 'will', 'VITE_FTD_SUPPORT_URL'],
    ['https://sdk.' + 'playwill.io/config', 'VITE_FTD_SUPPORT_URL'],
    ['https://cdn.' + 'basegames.net/find', 'VITE_CDN_ORIGIN_PROD'],
    ['hidden-object-' + 'base', 'VITE_FIREBASE_PROJECT_ID'],
  ])('rejects external-stack residue in resolved Find release inputs: %s', (value, key) => {
    const root = makeGameRoot();
    const environment = {
      VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
      VITE_ADJUST_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_TEST_MODE: 'false',
      VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      VITE_CDN_ENABLED: 'false',
      [key]: value,
    };

    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment });

    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toContain(key);
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it('rejects any noncanonical Firebase project even when it is not the known legacy ID', () => {
    const root = makeGameRoot();
    const result = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy,
      environment: {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_FIREBASE_PROJECT_ID: 'other-owned-project',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_CDN_ENABLED: 'false',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toContain('VITE_FIREBASE_PROJECT_ID');
  });

  it('rejects external-stack residue in active runtime and store metadata files', () => {
    const root = makeGameRoot();
    const sourceDir = path.join(root, 'src/platform');
    fs.mkdirSync(sourceDir, { recursive: true });
    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=false',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_TEST_MODE=false',
      'VITE_REVENUECAT_IOS_API_KEY=appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      'VITE_CDN_ENABLED=false',
      '',
    ].join('\n'));
    fs.writeFileSync(
      path.join(sourceDir, 'StoreMetadata.ts'),
      `export const supportUrl = 'https://support.${'play' + 'will.io'}';\n`,
    );

    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} });

    expect(result.ok).toBe(false);
    expect(result.residueFiles).toEqual(['src/platform/StoreMetadata.ts']);
  });

  it('scans every shipped textual surface, reports paths only, and bounds binary inputs', () => {
    const root = makeGameRoot();
    for (const directory of ['design', 'public/assets', 'src/ui', 'config', 'docs', 'tests', 'ios/App']) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    const residue = `https://sdk.${'play' + 'will.io'}`;
    const shippedFiles = [
      ['index.html', `<script src="${residue}"></script>`],
      ['public/runtime-config.json', JSON.stringify({ sdk: residue })],
      ['public/assets/page.html', residue],
      ['public/assets/style.css', `/* ${residue} */`],
      ['public/assets/runtime.js', `const sdk = '${residue}'`],
      ['public/assets/legacy.test.js', `const sdk = '${residue}'`],
      ['public/assets/icon.svg', `<svg><title>${residue}</title></svg>`],
      ['public/assets/readme.md', residue],
      ['src/ui/view.html', residue],
      ['design/tokens.css', `:root { --legacy-origin: '${residue}'; }`],
      ['config/Info.plist', residue],
      ['config/App.swift', residue],
      ['config/network.xml', residue],
    ];
    for (const [name, contents] of shippedFiles) write(root, name, contents);
    write(root, 'docs/history.md', residue);
    write(root, 'tests/fixture.js', residue);
    write(root, 'ios/App/generated.swift', residue);
    fs.writeFileSync(path.join(root, 'public/assets/image.png'), Buffer.alloc(2 * 1024 * 1024, 0));

    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} });

    expect(result.residueFiles).toEqual(shippedFiles.map(([name]) => name).sort());
    expect(JSON.stringify(result)).not.toContain(residue);
  });

  it('keeps both active Find runtime/config/metadata trees free of external-stack residue', () => {
    const environment = {
      VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
      VITE_ADJUST_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_TEST_MODE: 'false',
      VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      VITE_CDN_ENABLED: 'false',
    };

    for (const game of ['find_the_dog', 'find_the_bird']) {
      const result = validateEnvironment({
        gameRoot: path.join(repoRoot, 'games', game),
        mode: 'ios',
        policy,
        environment,
      });
      expect(result.residueFiles, game).toEqual([]);
    }
  });

  it('rejects a persisted VITE_INSITU_TOUR value (capture flags are shell-env only)', () => {
    const root = makeGameRoot();
    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=false',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_TEST_MODE=false',
      'VITE_REVENUECAT_IOS_API_KEY=appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      'VITE_CDN_ENABLED=false',
      'VITE_INSITU_TOUR=allstates',
      '',
    ].join('\n'));

    const result = validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} });
    expect(result.ok).toBe(false);
    expect(result.invalidKeys).toContain('VITE_INSITU_TOUR');
  });

  it.each([
    {
      mode: 'ios',
      enabled: 'VITE_ADJUST_IOS_ENABLED',
      required: ['VITE_ADJUST_IOS_APP_TOKEN', 'VITE_ADJUST_IOS_ENVIRONMENT'],
    },
    {
      mode: 'ios',
      enabled: 'VITE_ADMOB_IOS_ENABLED',
      required: [
        'VITE_ADMOB_IOS_APP_ID',
        'VITE_ADMOB_IOS_BANNER_ID',
        'VITE_ADMOB_IOS_INTERSTITIAL_ID',
        'VITE_ADMOB_IOS_REWARDED_ID',
      ],
    },
    {
      mode: 'android',
      enabled: 'VITE_ADMOB_ANDROID_ENABLED',
      required: [
        'VITE_ADMOB_ANDROID_APP_ID',
        'VITE_ADMOB_ANDROID_BANNER_ID',
        'VITE_ADMOB_ANDROID_INTERSTITIAL_ID',
        'VITE_ADMOB_ANDROID_REWARDED_ID',
      ],
    },
  ])('requires enabled-provider configuration for $mode $enabled', ({ mode, enabled, required, invalid = [] }) => {
    const root = makeGameRoot();
    const environment = {
      VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      VITE_CDN_ENABLED: 'false',
      VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
      VITE_ADJUST_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_TEST_MODE: 'false',
      VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(28)}`,
      VITE_APPLOVIN_ANDROID_ENABLED: 'false',
      ...(mode === 'ios' ? {
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
        VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
        VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
        VITE_APPSFLYER_ENABLED: 'true',
        VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0',
        VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
      } : {}),
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
      'VITE_ADMOB_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_TEST_MODE=false',
      'VITE_REVENUECAT_IOS_API_KEY=appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
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
      'VITE_GAMEANALYTICS_IOS_ENABLED=true',
      'VITE_GAMEANALYTICS_IOS_GAME_ID=find_the_dog',
      `VITE_GAMEANALYTICS_IOS_GAME_KEY=${'a'.repeat(32)}`,
      `VITE_GAMEANALYTICS_IOS_SECRET_KEY=${'b'.repeat(40)}`,
      'VITE_ATTRIBUTION_PROVIDER=appsflyer',
      'VITE_APPSFLYER_ENABLED=true',
      'VITE_APPSFLYER_DEV_KEY=A1b2C3d4E5f6G7h8I9j0',
      'VITE_APPSFLYER_APPLE_APP_ID=6772100729',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_TEST_MODE=false',
      'VITE_REVENUECAT_IOS_API_KEY=appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      'VITE_CDN_ENABLED=false',
      'VITE_FTD_SUPPORT_URL=',
      '',
    ].join('\n'));

    expect(validateEnvironment({ gameRoot: root, mode: 'ios', policy, environment: {} }).emptyOverrideKeys)
      .toEqual(['VITE_FTD_SUPPORT_URL']);

    write(root, '.env.ios.local', [
      'VITE_FTD_DISABLE_REMOTE_CONFIG=false',
      'VITE_GAMEANALYTICS_IOS_ENABLED=true',
      'VITE_GAMEANALYTICS_IOS_GAME_ID=find_the_dog',
      `VITE_GAMEANALYTICS_IOS_GAME_KEY=${'a'.repeat(32)}`,
      `VITE_GAMEANALYTICS_IOS_SECRET_KEY=${'b'.repeat(40)}`,
      'VITE_ATTRIBUTION_PROVIDER=appsflyer',
      'VITE_APPSFLYER_ENABLED=true',
      'VITE_APPSFLYER_DEV_KEY=A1b2C3d4E5f6G7h8I9j0',
      'VITE_APPSFLYER_APPLE_APP_ID=6772100729',
      'VITE_ADJUST_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_ENABLED=false',
      'VITE_ADMOB_IOS_TEST_MODE=false',
      'VITE_REVENUECAT_IOS_API_KEY=appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
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
      'VITE_ADMOB_ANDROID_ENABLED=false',
      'VITE_CDN_ENABLED=',
      '',
    ].join('\n'));

    const result = validateEnvironment({
      gameRoot: root,
      mode: 'android',
      policy,
      environment: { VITE_CDN_ENABLED: 'false', VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(28)}` },
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
  it('contains the exact 72-key placeholder-only contract with one comment per assignment', () => {
    const templatePath = path.join(repoRoot, 'games/find_the_dog/.env.example');
    const result = validateTemplate(templatePath, policy);

    expect(result.ok).toBe(true);
    expect(result.keys).toEqual([...FIND_THE_DOG_ENV_KEYS].sort());
    expect(result.keys).toHaveLength(72);
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
  it('preserves launcher overrides, fills missing iOS defaults, restores later modes, and exposes only canonical prefixes', () => {
    const root = makeGameRoot();
    const key = 'VITE_REVENUECAT_IOS_API_KEY';
    const missingKey = 'VITE_GAMEANALYTICS_IOS_GAME_KEY';
    const unknownKey = 'VITE_UNKNOWN_BUILD_OVERRIDE';
    const previous = process.env[key];
    const previousMissing = process.env[missingKey];
    const previousUnknown = process.env[unknownKey];
    process.env[key] = 'ambient-value';
    delete process.env[missingKey];
    process.env[unknownKey] = 'ambient-unknown';
    write(root, '.env.ios.local', [
      `export ${key}="ios-local-value"`,
      `${missingKey}=ios-local-default`,
      `${unknownKey}=ios-local-unknown`,
      '',
    ].join('\n'));

    try {
      const ios = resolveFindTheDogViteConfig('ios', root);
      expect(process.env[key]).toBe('ambient-value');
      expect(process.env[missingKey]).toBe('ios-local-default');
      expect(process.env[unknownKey]).toBe('ambient-unknown');
      expect(ios.publicDir).toBe(false);
      expect(ios.plugins?.some((plugin) => plugin && plugin.name === 'ftd-native-public-bundle')).toBe(true);
      expect(ios.envPrefix).toContain('VITE_REVENUECAT_IOS_API_KEY');
      expect(ios.envPrefix).not.toContain('VITE_REVENUECAT_ANDROID_API_KEY');
      expect(ios.envPrefix).toContain('VITE_GAMEANALYTICS_IOS_GAME_KEY');
      expect(ios.envPrefix).not.toContain('VITE_FTD_OWNED_ANALYTICS_MIRROR_ENABLED');

      const android = resolveFindTheDogViteConfig('android', root);
      expect(process.env[key]).toBe('ambient-value');
      expect(process.env[missingKey]).toBeUndefined();
      expect(android.publicDir).toBe(false);
      expect(android.plugins?.some((plugin) => plugin && plugin.name === 'ftd-native-public-bundle')).toBe(true);
      expect(android.envPrefix).toContain('VITE_REVENUECAT_ANDROID_API_KEY');
      expect(android.envPrefix).not.toContain('VITE_REVENUECAT_IOS_API_KEY');
      expect(android.envPrefix).not.toContain('VITE_GAMEANALYTICS_IOS_GAME_KEY');

      const development = resolveFindTheDogViteConfig('development', root);
      expect(development.publicDir).not.toBe(false);
      expect(development.plugins?.some((plugin) => plugin && plugin.name === 'ftd-native-public-bundle')).toBe(false);
      expect(development.envPrefix).not.toContain('VITE_REVENUECAT_IOS_API_KEY');
      expect(development.envPrefix).not.toContain('VITE_REVENUECAT_ANDROID_API_KEY');
      expect(development.envPrefix).not.toContain('VITE_APPLOVIN_IOS_SDK_KEY');
      expect(development.envPrefix).not.toContain('VITE_APPLOVIN_ANDROID_SDK_KEY');
    } finally {
      resolveFindTheDogViteConfig('android', root);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
      if (previousMissing === undefined) delete process.env[missingKey];
      else process.env[missingKey] = previousMissing;
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
    const result = runCliWithoutLocalOverrides(
      ['--game', 'find_the_dog', '--mode', 'ios'],
      {
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: canary,
        VITE_ADJUST_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_ENABLED: 'false',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_CDN_ENABLED: 'false',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_GAMEANALYTICS_IOS_SECRET_KEY');
    expect(`${result.stdout}${result.stderr}`).not.toContain(canary);
  });
});
