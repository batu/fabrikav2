import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { loadGameEnv, parseEnvText } from '../src/env.mjs';
import {
  runDryRun,
  validateEnvironment,
  validateTemplate,
} from '../src/validate.mjs';
import { getGamePolicy } from '../src/policies.mjs';
import { createFindTheBirdPolicy } from '../src/policies/find-the-bird.mjs';
import { createFindTheDogPolicy, FIND_THE_DOG_ENV_KEYS } from '../src/policies/find-the-dog.mjs';
import { resolveFindTheDogViteConfig } from '../../../games/find_the_dog/vite.config.ts';
import { resolveFindTheDogViteConfig as resolveFindTheBirdViteConfig } from '../../../games/find_the_bird/vite.config.ts';

const dogAdMobConfig = JSON.parse(fs.readFileSync(
  new URL('../../../games/find_the_dog/config/admob.public.json', import.meta.url),
  'utf8',
));
const birdAdMobConfig = JSON.parse(fs.readFileSync(
  new URL('../../../games/find_the_bird/config/admob.public.json', import.meta.url),
  'utf8',
));
const arbitraryAdMobConfig = {
  appId: 'ca-app-pub-1234567890123456~1234567890',
  adUnits: {
    banner: 'ca-app-pub-1234567890123456/1111111111',
    interstitial: 'ca-app-pub-1234567890123456/2222222222',
    rewarded: 'ca-app-pub-1234567890123456/3333333333',
  },
};
const dogLegalIdentity = {
  VITE_FTD_PRIVACY_POLICY_URL: 'https://basegamelab.com/find-the-dog/privacy',
  VITE_FTD_TERMS_URL: 'https://basegamelab.com/find-the-dog/terms',
  VITE_FTD_DATA_DELETION_URL: 'https://basegamelab.com/find-the-dog/data-deletion',
  VITE_FTD_SUPPORT_URL: 'https://basegamelab.com/find-the-dog/support',
  VITE_FTD_STORE_LINK: 'https://apps.apple.com/app/id6772100729',
  VITE_PRIVACY_POLICY_URL: 'https://basegamelab.com/find-the-dog/privacy',
  VITE_TERMS_URL: 'https://basegamelab.com/find-the-dog/terms',
};
const birdLegalIdentity = Object.fromEntries(Object.entries(dogLegalIdentity).map(([key, value]) => [
  key,
  value.replaceAll('find-the-dog', 'find-the-bird').replace('6772100729', '6796698146'),
]));
const arbitraryLegalIdentity = Object.fromEntries(Object.keys(dogLegalIdentity).map((key) => [
  key,
  key === 'VITE_FTD_STORE_LINK'
    ? 'https://apps.apple.com/app/id1234567890'
    : `https://example.com/${key.toLowerCase()}`,
]));

const temporaryDirectories = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cliPath = path.join(repoRoot, 'tools/game-env/validate.mjs');
const productionPolicy = getGamePolicy('find_the_dog');
const policy = createFindTheDogPolicy({
  approvedGameAnalyticsGameKeyFingerprints: [createHash('sha256').update('a'.repeat(32)).digest('hex')],
  approvedGameAnalyticsSecretKeyFingerprints: [createHash('sha256').update('b'.repeat(40)).digest('hex')],
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
  for (const game of ['find_the_dog', 'find_the_bird']) {
    const fixtureConfig = path.join(root, 'games', game, 'config');
    fs.mkdirSync(fixtureConfig, { recursive: true });
    fs.copyFileSync(
      path.join(repoRoot, 'games', game, 'config/admob.public.json'),
      path.join(fixtureConfig, 'admob.public.json'),
    );
  }
  return spawnSync(process.execPath, [path.join(fixtureTools, 'validate.mjs'), ...args], {
    cwd: fixtureGame,
    encoding: 'utf8',
    env: environment,
  });
}

function write(root, name, contents) {
  fs.writeFileSync(path.join(root, name), contents);
}

async function buildCapturedViteEnvironment(resolveConfig, root) {
  write(root, 'index.html', '<script type="module" src="/main.js"></script>\n');
  write(root, 'main.js', 'globalThis.__capturedEnv = import.meta.env;\n');
  const canonicalRoot = fs.realpathSync(root);
  const config = resolveConfig('ios', canonicalRoot);
  const result = await build({
    ...config,
    root: canonicalRoot,
    configFile: false,
    logLevel: 'silent',
    mode: 'ios',
    build: { ...config.build, write: false },
  });
  const outputs = Array.isArray(result) ? result.flatMap((entry) => entry.output) : result.output;
  return outputs
    .filter((output) => output.type === 'chunk')
    .map((output) => output.code)
    .join('\n');
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
  it.each([
    ['find_the_dog', dogLegalIdentity, birdLegalIdentity],
    ['find_the_bird', birdLegalIdentity, dogLegalIdentity],
  ])('binds the actual %s policy to its exact legal/support/store tuple', (game, ownIdentity, otherIdentity) => {
    const root = makeGameRoot();
    const validateLegalIdentity = (identity) => validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy: getGamePolicy(game),
      environment: identity,
    });
    const keys = Object.keys(ownIdentity);

    expect(validateLegalIdentity(ownIdentity).invalidKeys).not.toEqual(expect.arrayContaining(keys));
    expect(validateLegalIdentity(otherIdentity).invalidKeys).toEqual(expect.arrayContaining(keys));
    expect(validateLegalIdentity(arbitraryLegalIdentity).invalidKeys).toEqual(expect.arrayContaining(keys));
    for (const key of keys) {
      expect(validateLegalIdentity({ ...ownIdentity, [key]: otherIdentity[key] }).invalidKeys).toContain(key);
    }
  });

  it.each([
    ['find_the_dog', dogAdMobConfig, birdAdMobConfig],
    ['find_the_bird', birdAdMobConfig, dogAdMobConfig],
  ])('binds the %s release validator to its committed AdMob tuple', (game, ownConfig, otherConfig) => {
    const root = makeGameRoot();
    const validateAdMob = (config) => validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy: getGamePolicy(game),
      environment: {
        VITE_ADMOB_IOS_ENABLED: 'true',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
        VITE_ADMOB_IOS_APP_ID: config.appId,
        VITE_ADMOB_IOS_BANNER_ID: config.adUnits.banner,
        VITE_ADMOB_IOS_INTERSTITIAL_ID: config.adUnits.interstitial,
        VITE_ADMOB_IOS_REWARDED_ID: config.adUnits.rewarded,
      },
    });

    expect(validateAdMob(ownConfig).invalidKeys).not.toEqual(expect.arrayContaining([
      'VITE_ADMOB_IOS_APP_ID',
      'VITE_ADMOB_IOS_BANNER_ID',
      'VITE_ADMOB_IOS_INTERSTITIAL_ID',
      'VITE_ADMOB_IOS_REWARDED_ID',
    ]));
    for (const rejectedConfig of [otherConfig, arbitraryAdMobConfig]) {
      expect(validateAdMob(rejectedConfig).invalidKeys).toEqual(expect.arrayContaining([
        'VITE_ADMOB_IOS_APP_ID',
        'VITE_ADMOB_IOS_BANNER_ID',
        'VITE_ADMOB_IOS_INTERSTITIAL_ID',
        'VITE_ADMOB_IOS_REWARDED_ID',
      ]));
    }
  });

  it('uses a separate Find the Bird release identity policy', () => {
    const birdPolicy = createFindTheBirdPolicy({
      approvedGameAnalyticsGameKeyFingerprints: ['synthetic-game-fingerprint'],
      approvedGameAnalyticsSecretKeyFingerprints: ['synthetic-secret-fingerprint'],
    });

    expect(getGamePolicy('find_the_bird')).not.toBe(getGamePolicy('find_the_dog'));
    expect(birdPolicy.releaseIdentity).toEqual({
      firebaseProjectId: 'find-the-bird-basegamelab',
      gameAnalyticsGameId: 'find_the_bird',
      appsFlyerAppleAppId: '6796698146',
      admobIos: {
        appId: birdAdMobConfig.appId,
        adUnits: birdAdMobConfig.adUnits,
      },
      legal: birdLegalIdentity,
    });
  });

  it('pins both GameAnalytics credentials by SHA-256 fingerprint without exposing values', () => {
    const root = makeGameRoot();
    const gameKey = 'a'.repeat(32);
    const secretKey = 'b'.repeat(40);
    const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
    const fingerprintPolicy = createFindTheDogPolicy({
      approvedGameAnalyticsGameKeyFingerprints: [fingerprint(gameKey)],
      approvedGameAnalyticsSecretKeyFingerprints: [fingerprint(secretKey)],
    });
    const environment = {
      VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      VITE_FIREBASE_PROJECT_ID: 'find-the-dog-basegamelab',
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: gameKey,
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: secretKey,
      VITE_ADJUST_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_ENABLED: 'false',
      VITE_ADMOB_IOS_TEST_MODE: 'false',
      VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
      VITE_APPSFLYER_ENABLED: 'true',
      VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0K1',
      VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
      VITE_CDN_ENABLED: 'false',
    };

    expect(validateEnvironment({ gameRoot: root, mode: 'ios', policy: fingerprintPolicy, environment }).ok).toBe(true);
    for (const [key, value] of [
      ['VITE_GAMEANALYTICS_IOS_GAME_KEY', 'c'.repeat(32)],
      ['VITE_GAMEANALYTICS_IOS_SECRET_KEY', 'd'.repeat(40)],
    ]) {
      const result = validateEnvironment({
        gameRoot: root,
        mode: 'ios',
        policy: fingerprintPolicy,
        environment: { ...environment, [key]: value },
      });
      expect(result.invalidKeys).toContain(key);
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

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
      'VITE_APPSFLYER_DEV_KEY=A1b2C3d4E5f6G7h8I9j0K1',
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
        VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0K1',
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
        VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0K1',
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
      VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0K1',
      VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
      VITE_CDN_ENABLED: 'false',
    };

    const rejected = validateEnvironment({ gameRoot: root, mode: 'ios', policy: productionPolicy, environment });
    const injected = validateEnvironment({
      gameRoot: root,
      mode: 'ios',
      policy: createFindTheDogPolicy({
        approvedGameAnalyticsGameKeyFingerprints: [createHash('sha256').update('a'.repeat(32)).digest('hex')],
        approvedGameAnalyticsSecretKeyFingerprints: [createHash('sha256').update('b'.repeat(40)).digest('hex')],
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
      VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0K1',
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
        VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0K1',
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
        VITE_APPSFLYER_DEV_KEY: 'A1b2C3d4E5f6G7h8I9j0K1',
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
      'VITE_APPSFLYER_DEV_KEY=A1b2C3d4E5f6G7h8I9j0K1',
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
      'VITE_APPSFLYER_DEV_KEY=A1b2C3d4E5f6G7h8I9j0K1',
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
      environment: { VITE_CDN_ENABLED: 'false', VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(27)}` },
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
  it('keeps each Find game template aligned with its separate policy', () => {
    for (const game of ['find_the_dog', 'find_the_bird']) {
      expect(validateTemplate(
        path.join(repoRoot, `games/${game}/.env.example`),
        getGamePolicy(game),
      ).ok, game).toBe(true);
    }
  });

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
  it.each([
    ['find_the_dog', resolveFindTheDogViteConfig, dogLegalIdentity, birdLegalIdentity],
    ['find_the_bird', resolveFindTheBirdViteConfig, birdLegalIdentity, dogLegalIdentity],
  ])('generates a %s iOS bundle with only its own legal/support/store identity', async (_game, resolveConfig, ownIdentity, otherIdentity) => {
    const root = makeGameRoot();
    write(root, '.env.ios.local', `${Object.entries(ownIdentity).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);

    const bundle = await buildCapturedViteEnvironment(resolveConfig, root);

    for (const value of new Set(Object.values(ownIdentity))) expect(bundle).toContain(value);
    for (const value of new Set(Object.values(otherIdentity))) expect(bundle).not.toContain(value);
  });

  it.each([
    ['find_the_dog', resolveFindTheDogViteConfig],
    ['find_the_bird', resolveFindTheBirdViteConfig],
  ])('injects only exact canonical keys into the %s iOS bundle', async (_game, resolveConfig) => {
    const root = makeGameRoot();
    const canonicalKey = 'VITE_GAMEANALYTICS_IOS_SECRET_KEY';
    const suffixedKey = `${canonicalKey}_BACKUP`;
    const unknownKey = 'VITE_UNKNOWN_BUILD_OVERRIDE';
    const previousCanonical = process.env[canonicalKey];
    const previousSuffixed = process.env[suffixedKey];
    const previousUnknown = process.env[unknownKey];
    process.env[canonicalKey] = 'shell-canonical-canary';
    process.env[suffixedKey] = 'suffixed-secret-canary';
    process.env[unknownKey] = 'unknown-secret-canary';
    write(root, '.env.ios.local', `${canonicalKey}=protected-ios-value\n`);

    try {
      const bundle = await buildCapturedViteEnvironment(resolveConfig, root);

      expect(bundle).toContain(canonicalKey);
      expect(bundle).toContain('protected-ios-value');
      expect(bundle).not.toContain('shell-canonical-canary');
      expect(bundle).not.toContain(suffixedKey);
      expect(bundle).not.toContain('suffixed-secret-canary');
      expect(bundle).not.toContain(unknownKey);
      expect(bundle).not.toContain('unknown-secret-canary');
      expect(bundle).toContain('MODE:"ios"');
      expect(bundle).toMatch(/PROD:![01]/);
      expect(bundle).toMatch(/DEV:![01]/);
    } finally {
      resolveConfig('android', root);
      if (previousCanonical === undefined) delete process.env[canonicalKey];
      else process.env[canonicalKey] = previousCanonical;
      if (previousSuffixed === undefined) delete process.env[suffixedKey];
      else process.env[suffixedKey] = previousSuffixed;
      if (previousUnknown === undefined) delete process.env[unknownKey];
      else process.env[unknownKey] = previousUnknown;
    }
  });

  it.each([
    ['find_the_dog', resolveFindTheDogViteConfig],
    ['find_the_bird', resolveFindTheBirdViteConfig],
  ])('preserves explicit verify-device controls for %s while protected production keys remain authoritative', (_game, resolveConfig) => {
    const root = makeGameRoot();
    const harnessKey = 'VITE_ENABLE_TEST_HARNESS';
    const tourKey = 'VITE_INSITU_TOUR';
    const ownerKey = 'VITE_GAMEANALYTICS_IOS_ENABLED';
    const unknownKey = 'VITE_UNKNOWN_BUILD_OVERRIDE';
    const previous = new Map([harnessKey, tourKey, ownerKey, unknownKey].map((key) => [key, process.env[key]]));
    process.env[harnessKey] = 'true';
    process.env[tourKey] = 'allstates';
    process.env[ownerKey] = 'true';
    process.env[unknownKey] = 'must-not-leak';
    write(root, '.env.ios.local', [
      `${harnessKey}=false`,
      `${tourKey}=none`,
      `${ownerKey}=false`,
      '',
    ].join('\n'));

    try {
      const ios = resolveConfig('ios', root);
      expect(ios.define).toHaveProperty(`import.meta.env.${harnessKey}`, JSON.stringify('true'));
      expect(ios.define).toHaveProperty(`import.meta.env.${tourKey}`, JSON.stringify('allstates'));
      expect(ios.define).toHaveProperty(`import.meta.env.${ownerKey}`, JSON.stringify('false'));
      expect(ios.define).not.toHaveProperty(`import.meta.env.${unknownKey}`);
    } finally {
      resolveConfig('android', root);
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it.each([
    ['find_the_dog', resolveFindTheDogViteConfig],
    ['find_the_bird', resolveFindTheBirdViteConfig],
  ])('makes protected iOS values authoritative for %s and restores repeated mixed-mode resolution', (_game, resolveConfig) => {
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
      const ios = resolveConfig('ios', root);
      expect(process.env[key]).toBe('ios-local-value');
      expect(process.env[missingKey]).toBe('ios-local-default');
      expect(process.env[unknownKey]).toBe('ambient-unknown');
      expect(ios.publicDir).toBe(false);
      expect(ios.plugins?.some((plugin) => plugin && plugin.name === 'ftd-native-public-bundle')).toBe(true);
      expect(ios.envPrefix).toBe('__FABRIKA_EXPLICIT_ENV_ONLY__');
      expect(ios.define).toHaveProperty('import.meta.env.VITE_REVENUECAT_IOS_API_KEY', JSON.stringify('ios-local-value'));
      expect(ios.define).not.toHaveProperty('import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY');
      expect(ios.define).toHaveProperty('import.meta.env.VITE_GAMEANALYTICS_IOS_GAME_KEY', JSON.stringify('ios-local-default'));
      expect(ios.define).not.toHaveProperty('import.meta.env.VITE_FTD_OWNED_ANALYTICS_MIRROR_ENABLED');

      const android = resolveConfig('android', root);
      expect(process.env[key]).toBe('ambient-value');
      expect(process.env[missingKey]).toBeUndefined();
      expect(android.publicDir).toBe(false);
      expect(android.plugins?.some((plugin) => plugin && plugin.name === 'ftd-native-public-bundle')).toBe(true);
      expect(android.envPrefix).toBe('__FABRIKA_EXPLICIT_ENV_ONLY__');
      expect(android.define).not.toHaveProperty('import.meta.env.VITE_REVENUECAT_IOS_API_KEY');
      expect(android.define).not.toHaveProperty('import.meta.env.VITE_GAMEANALYTICS_IOS_GAME_KEY');

      const development = resolveConfig('development', root);
      expect(development.publicDir).not.toBe(false);
      expect(development.plugins?.some((plugin) => plugin && plugin.name === 'ftd-native-public-bundle')).toBe(false);
      expect(development.envPrefix).toBe('__FABRIKA_EXPLICIT_ENV_ONLY__');
      expect(development.define).not.toHaveProperty('import.meta.env.VITE_REVENUECAT_IOS_API_KEY');
      expect(development.define).not.toHaveProperty('import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY');
      expect(development.define).not.toHaveProperty('import.meta.env.VITE_APPLOVIN_IOS_SDK_KEY');
      expect(development.define).not.toHaveProperty('import.meta.env.VITE_APPLOVIN_ANDROID_SDK_KEY');
    } finally {
      resolveConfig('android', root);
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
