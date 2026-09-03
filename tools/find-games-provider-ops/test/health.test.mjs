import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  inspectBrowserInventory,
  inspectCredential,
  buildHealthSnapshot,
  classifyProbeFailure,
  probeAppsFlyer,
  probeAppStoreConnect,
  probeMeta,
  validateIdentityConfig,
} from '../src/health.mjs';

const providers = [
  { id: 'appsflyer', tab: { hosts: ['hq1.appsflyer.com'], label: 'AppsFlyer' } },
  { id: 'admob', tab: { hosts: ['admob.google.com'], label: 'AdMob' } },
];

test('browser inventory requires exactly one authenticated tab per provider', () => {
  const tabs = [
    { window: 1, index: 1, title: 'Overview | AppsFlyer', url: 'https://hq1.appsflyer.com/dashboard' },
    { window: 1, index: 2, title: 'AdMob', url: 'https://admob.google.com/v2/home' },
  ];
  const result = inspectBrowserInventory(tabs, providers, { expectedWindowCount: 1, expectedTabCount: 2 });
  assert.equal(result.workspace.status, 'healthy');
  assert.equal(result.providers.appsflyer.status, 'authenticated');
  assert.equal(result.providers.admob.status, 'authenticated');
});

test('browser inventory detects duplicates, missing tabs, and login routes', () => {
  const tabs = [
    { window: 1, index: 1, title: 'AppsFlyer', url: 'https://hq1.appsflyer.com/dashboard' },
    { window: 1, index: 2, title: 'AppsFlyer duplicate', url: 'https://hq1.appsflyer.com/apps' },
    { window: 1, index: 3, title: 'Sign in', url: 'https://accounts.google.com/signin?continue=https://admob.google.com/' },
  ];
  const result = inspectBrowserInventory(tabs, providers, { expectedWindowCount: 1, expectedTabCount: 2 });
  assert.equal(result.workspace.status, 'degraded');
  assert.equal(result.providers.appsflyer.status, 'duplicate');
  assert.equal(result.providers.admob.status, 'auth_required');

  const missing = inspectBrowserInventory(tabs.slice(0, 1), providers, { expectedWindowCount: 1, expectedTabCount: 2 });
  assert.equal(missing.providers.admob.status, 'missing');
});

test('browser inventory strips query strings and fragments from reported tab provenance', () => {
  const result = inspectBrowserInventory([
    { window: 1, index: 1, title: 'AppsFlyer', url: 'https://hq1.appsflyer.com/dashboard?access_token=LEAK#secret' },
    { window: 1, index: 2, title: 'AdMob', url: 'https://admob.google.com/v2/home' },
  ], providers, { expectedWindowCount: 1, expectedTabCount: 2 });
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /LEAK|access_token|#secret/);
  assert.match(output, /https:\/\/hq1\.appsflyer\.com\/dashboard/);
});

test('credential inspection separates SDK ingestion keys from reporting access', () => {
  const env = {
    APPSFLYER_DEV_KEY: 'sdk-secret-value',
    APPSFLYER_REPORTING_TOKEN: '',
  };
  const sdk = inspectCredential({ kind: 'sdk_ingestion', env: 'APPSFLYER_DEV_KEY' }, env);
  const reporting = inspectCredential({ kind: 'reporting_api', env: 'APPSFLYER_REPORTING_TOKEN' }, env);
  assert.deepEqual(sdk, { kind: 'sdk_ingestion', status: 'available', locator: 'env:APPSFLYER_DEV_KEY' });
  assert.deepEqual(reporting, { kind: 'reporting_api', status: 'missing_credential', locator: 'env:APPSFLYER_REPORTING_TOKEN' });
  assert.doesNotMatch(JSON.stringify([sdk, reporting]), /sdk-secret-value/);
});

test('credential file checks report existence and unsafe mode without reading contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-health-'));
  const secret = path.join(dir, 'secret.pem');
  fs.writeFileSync(secret, 'TOP-SECRET-PRIVATE-KEY');
  fs.chmodSync(secret, 0o644);
  try {
    const result = inspectCredential({ kind: 'reporting_api', path_env: 'SECRET_FILE' }, { SECRET_FILE: secret });
    assert.equal(result.status, 'degraded');
    assert.equal(result.exists, true);
    assert.equal(result.mode, '0644');
    assert.equal(result.locator, 'path_env:SECRET_FILE');
    assert.doesNotMatch(JSON.stringify(result), /TOP-SECRET/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('identity validation preserves per-game isolation', () => {
  const games = [
    { id: 'find_the_dog', app_store_id: '6772100729', appsflyer_app_id: 'id6772100729', bundle_id: 'com.baseardahan.hiddenobj', gameanalytics_project_id: '350269' },
    { id: 'find_the_bird', app_store_id: '6796698146', appsflyer_app_id: 'id6796698146', bundle_id: 'com.basegamelab.findthebird', gameanalytics_project_id: '351396' },
  ];
  assert.deepEqual(validateIdentityConfig(games), games);
  assert.throws(() => validateIdentityConfig([
    games[0],
    { ...games[1], bundle_id: games[0].bundle_id },
  ]), /duplicate bundle_id/);
  assert.throws(() => validateIdentityConfig([
    games[0],
    { ...games[1], appsflyer_app_id: games[0].appsflyer_app_id },
  ]), /duplicate appsflyer_app_id/);
});

test('API failures map to stable non-secret categories', () => {
  assert.deepEqual(classifyProbeFailure({ status: 401 }), { status: 'auth_required', category: 'invalid_credential' });
  assert.deepEqual(classifyProbeFailure({ status: 429 }), { status: 'degraded', category: 'rate_limited' });
  assert.deepEqual(classifyProbeFailure({ status: 503 }), { status: 'unavailable', category: 'provider_unavailable' });
  assert.deepEqual(classifyProbeFailure({ code: 'ENOTFOUND' }), { status: 'unavailable', category: 'network_error' });
});

test('health snapshot is stable, provenance-bearing, and identity-isolated', () => {
  const games = [
    { id: 'find_the_dog', app_store_id: '6772100729', appsflyer_app_id: 'id6772100729', bundle_id: 'com.baseardahan.hiddenobj', gameanalytics_project_id: '350269' },
    { id: 'find_the_bird', app_store_id: '6796698146', appsflyer_app_id: 'id6796698146', bundle_id: 'com.basegamelab.findthebird', gameanalytics_project_id: '351396' },
  ];
  const providerConfig = [
    { id: 'meta', tab: { hosts: ['business.facebook.com'], label: 'Meta Ads Manager' }, api: 'meta', credentials: [{ kind: 'reporting_api', env: 'META_REPORTING_TOKEN' }] },
    { id: 'appsflyer', tab: { hosts: ['hq1.appsflyer.com'], label: 'AppsFlyer' }, credentials: [{ kind: 'sdk_ingestion', env: 'APPSFLYER_DEV_KEY' }, { kind: 'reporting_api', env: 'APPSFLYER_REPORTING_TOKEN' }] },
  ];
  const tabs = [
    { window: 1, index: 1, title: 'Meta Ads Manager', url: 'https://business.facebook.com/adsmanager' },
    { window: 1, index: 2, title: 'AppsFlyer', url: 'https://hq1.appsflyer.com/dashboard' },
  ];
  const snapshot = buildHealthSnapshot({
    observedAt: '2026-09-03T10:00:00.000Z',
    games,
    providers: providerConfig,
    tabs,
    browserContract: { expectedWindowCount: 1, expectedTabCount: 2 },
    env: { META_REPORTING_TOKEN: 'never-print-this', APPSFLYER_DEV_KEY: 'sdk-only-secret' },
    probes: { meta: { ok: true, window: 'account_read' } },
  });
  assert.equal(snapshot.observed_at, '2026-09-03T10:00:00.000Z');
  assert.equal(snapshot.providers[0].provider, 'meta');
  assert.equal(snapshot.providers[0].status, 'healthy');
  assert.deepEqual(snapshot.providers[0].source, { kind: 'live_api', provenance: 'meta' });
  assert.equal(snapshot.providers[0].freshness.window, 'account_read');
  assert.deepEqual(snapshot.providers[0].games, games);
  assert.equal(snapshot.providers[1].status, 'degraded');
  assert.equal(snapshot.providers[1].error.category, 'missing_credential');
  assert.equal(snapshot.providers[1].source.kind, 'authenticated_browser');
  assert.doesNotMatch(JSON.stringify(snapshot), /never-print-this|sdk-only-secret/);

  const missingSource = buildHealthSnapshot({
    observedAt: '2026-09-03T10:00:00.000Z', games,
    providers: [providerConfig[1]], tabs: [],
    browserContract: { expectedWindowCount: 1, expectedTabCount: 1 },
    env: { APPSFLYER_DEV_KEY: 'sdk-only-secret' }, probes: {},
  });
  assert.equal(missingSource.providers[0].status, 'missing_credential');
});

test('Meta probe uses an authorization header and classifies HTTP failure without response bodies', async () => {
  let request;
  const ok = await probeMeta({
    accountId: '2805795896467959',
    accessToken: 'meta-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(ok, { ok: true, window: 'account_read' });
  assert.match(request.url, /act_2805795896467959/);
  assert.doesNotMatch(request.url, /meta-secret/);
  assert.equal(request.options.headers.Authorization, 'Bearer meta-secret');

  const denied = await probeMeta({
    accountId: '2805795896467959', accessToken: 'meta-secret',
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'LEAK-ME' }),
  });
  assert.deepEqual(denied, { ok: false, status: 403 });
  assert.doesNotMatch(JSON.stringify(denied), /LEAK-ME|meta-secret/);
});

test('AppsFlyer probe checks both exact app IDs with bearer auth and redacted failures', async () => {
  const requests = [];
  const success = await probeAppsFlyer({
    appIds: ['id6772100729', 'id6796698146'],
    accessToken: 'appsflyer-secret',
    date: '2026-09-03',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, text: async () => 'never-needed' };
    },
  });
  assert.deepEqual(success, {
    ok: true,
    window: { from: '2026-09-03', to: '2026-09-03' },
    games: [
      { appsflyer_app_id: 'id6772100729', ok: true },
      { appsflyer_app_id: 'id6796698146', ok: true },
    ],
  });
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
    '/api/agg-data/export/app/id6772100729/partners_by_date_report/v5',
    '/api/agg-data/export/app/id6796698146/partners_by_date_report/v5',
  ]);
  assert.ok(requests.every(({ url }) => !url.includes('appsflyer-secret')));
  assert.ok(requests.every(({ options }) => options.headers.Authorization === 'Bearer appsflyer-secret'));

  for (const [status, body, expected] of [
    [401, 'RESPONSE-BODY-LEAK', 'auth_required'],
    [403, 'RESPONSE-BODY-LEAK', 'auth_required'],
    [403, 'Limit reached for partners-daily-report', 'degraded'],
    [429, 'RESPONSE-BODY-LEAK', 'degraded'],
    [503, 'RESPONSE-BODY-LEAK', 'unavailable'],
  ]) {
    const failed = await probeAppsFlyer({
      appIds: ['id6772100729', 'id6796698146'], accessToken: 'appsflyer-secret', date: '2026-09-03',
      fetchImpl: async () => ({ ok: false, status, text: async () => body }),
    });
    assert.equal(classifyProbeFailure(failed).status, expected);
    assert.doesNotMatch(JSON.stringify(failed), /RESPONSE-BODY-LEAK|appsflyer-secret/);
  }

  const network = await probeAppsFlyer({
    appIds: ['id6772100729', 'id6796698146'], accessToken: 'appsflyer-secret', date: '2026-09-03',
    fetchImpl: async () => { throw Object.assign(new Error('sensitive URL'), { code: 'ENOTFOUND' }); },
  });
  assert.deepEqual(classifyProbeFailure(network), { status: 'unavailable', category: 'network_error' });
  assert.doesNotMatch(JSON.stringify(network), /sensitive URL|appsflyer-secret/);
});

test('App Store Connect probe signs a short-lived JWT with built-in crypto', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let request;
  const result = await probeAppStoreConnect({
    issuerId: 'issuer-id',
    keyId: 'KEY123',
    privateKey,
    nowSeconds: 1_788_430_000,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(result, { ok: true, window: 'catalog_read' });
  assert.equal(request.url, 'https://api.appstoreconnect.apple.com/v1/apps?limit=1');
  const token = request.options.headers.Authorization.replace('Bearer ', '');
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    iss: 'issuer-id', iat: 1_788_430_000, exp: 1_788_431_190, aud: 'appstoreconnect-v1',
  });
  assert.ok(signature.length > 20);

  const invalid = await probeAppStoreConnect({
    issuerId: 'issuer-id', keyId: 'KEY123', privateKey: 'not-a-private-key',
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  assert.deepEqual(invalid, { ok: false, code: 'INVALID_CREDENTIAL' });
  assert.deepEqual(classifyProbeFailure(invalid), { status: 'auth_required', category: 'invalid_credential' });
});
