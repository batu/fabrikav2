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
  validateObservedAt,
  validateProbeFixtures,
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
    { window: 1, index: 3, title: 'Sign in', url: 'https://admob.google.com/login' },
  ];
  const result = inspectBrowserInventory(tabs, providers, { expectedWindowCount: 1, expectedTabCount: 2 });
  assert.equal(result.workspace.status, 'degraded');
  assert.equal(result.providers.appsflyer.status, 'duplicate');
  assert.equal(result.providers.admob.status, 'auth_required');

  const missing = inspectBrowserInventory(tabs.slice(0, 1), providers, { expectedWindowCount: 1, expectedTabCount: 2 });
  assert.equal(missing.providers.admob.status, 'missing');
});

test('browser inventory exposes only trusted origins and redacts paths and titles', () => {
  const result = inspectBrowserInventory([
    { window: 1, index: 1, title: 'Bearer-super-secret', url: 'https://hq1.appsflyer.com/oauth/callback/Bearer-super-secret?access_token=LEAK#secret' },
    { window: 1, index: 2, title: 'AdMob secret customer', url: 'https://admob.google.com/v2/home' },
  ], providers, { expectedWindowCount: 1, expectedTabCount: 2 });
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /LEAK|access_token|callback|Bearer-super-secret|customer|#secret/);
  assert.match(output, /https:\/\/hq1\.appsflyer\.com/);
  assert.equal(result.providers.appsflyer.tabs[0].title, '<redacted>');
  assert.equal(result.providers.appsflyer.tabs[0].url, 'https://hq1.appsflyer.com');
});

test('browser inventory never matches evil origins by title or URL substring', () => {
  const tabs = [
    { window: 1, index: 1, title: 'AppsFlyer', url: 'https://evil.example/?next=hq1.appsflyer.com' },
    { window: 1, index: 2, title: 'AdMob', url: 'https://admob.google.com.evil.example/' },
  ];
  const result = inspectBrowserInventory(tabs, providers, { expectedWindowCount: 1, expectedTabCount: 2 });
  assert.equal(result.workspace.status, 'degraded');
  assert.equal(result.providers.appsflyer.status, 'missing');
  assert.equal(result.providers.admob.status, 'missing');
  assert.doesNotMatch(JSON.stringify(result), /evil\.example|hq1\.appsflyer\.com/);
});

test('browser inventory rejects allowed hostnames on non-default ports', () => {
  const result = inspectBrowserInventory([
    { window: 1, index: 1, title: 'AppsFlyer', url: 'https://hq1.appsflyer.com:8443/dashboard' },
  ], [providers[0]], { expectedWindowCount: 1, expectedTabCount: 1 });
  assert.equal(result.providers.appsflyer.status, 'missing');
});

test('browser inventory rejects malformed tab fields before they can reach output', () => {
  assert.throws(() => inspectBrowserInventory([
    { window: 'secret-window', index: 1, title: 'AppsFlyer', url: 'https://hq1.appsflyer.com/' },
  ], [providers[0]], { expectedWindowCount: 1, expectedTabCount: 1 }), /invalid browser tab inventory/);
  assert.throws(() => inspectBrowserInventory([
    { window: 1, index: 0, title: 42, url: 'https://hq1.appsflyer.com/' },
  ], [providers[0]], { expectedWindowCount: 1, expectedTabCount: 1 }), /invalid browser tab inventory/);
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

test('observed_at requires canonical ISO-8601', () => {
  assert.equal(validateObservedAt('2026-09-03T10:00:00.000Z'), '2026-09-03T10:00:00.000Z');
  for (const value of ['invalid', '2026-09-03T10:00:00Z', '2026-09-03T13:00:00.000+03:00']) {
    assert.throws(() => validateObservedAt(value), /canonical ISO-8601/);
  }
});

test('probe fixtures are provider-schema validated, fixture-sourced, and cannot make unsupported providers healthy', () => {
  const configuredProviders = [
    { id: 'meta', api: 'meta', ad_account_id: '123' },
    { id: 'admob' },
  ];
  const fixtures = validateProbeFixtures({
    meta: { ok: true, window: 'account_read', account: { id: 'act_123', account_status: 1 } },
    admob: { ok: true, window: 'forged' },
  }, configuredProviders, []);
  assert.equal(fixtures.meta.provenance, 'fixture');
  assert.deepEqual(fixtures.meta.verified_identities, { ad_account_id: '123' });
  assert.deepEqual(fixtures.admob, {
    ok: false, status: 'degraded', category: 'unsupported_fixture', provenance: 'fixture',
  });
  assert.throws(() => validateProbeFixtures({ meta: { ok: true } }, configuredProviders, []), /invalid meta probe fixture/);

  const appsflyerProvider = [{ id: 'appsflyer', api: 'appsflyer' }];
  const fixtureGames = [{ appsflyer_app_id: 'id1' }];
  assert.throws(() => validateProbeFixtures({
    appsflyer: { ok: true, window: { from: 'secret', to: 'secret' }, games: [{ appsflyer_app_id: 'id1', ok: true }] },
  }, appsflyerProvider, fixtureGames), /invalid appsflyer probe fixture/);
  assert.throws(() => validateProbeFixtures({
    appsflyer: { ok: true, window: { from: '2026-09-01', to: '2026-09-01' }, games: [{ appsflyer_app_id: 'id1', ok: false }] },
  }, appsflyerProvider, fixtureGames), /invalid appsflyer probe fixture/);
});

test('health snapshot reports a stable unavailable browser state', () => {
  const game = { id: 'g', app_store_id: '1', appsflyer_app_id: 'id1', bundle_id: 'com.test.g', gameanalytics_project_id: '2' };
  const snapshot = buildHealthSnapshot({
    observedAt: '2026-09-03T10:00:00.000Z',
    games: [game], providers, tabs: [], browserFailure: { category: 'browser_unavailable' },
    browserContract: { expectedWindowCount: 1, expectedTabCount: 2 }, env: {}, probes: {},
  });
  assert.deepEqual(snapshot.browser.error, { category: 'browser_unavailable' });
  assert.equal(snapshot.browser.status, 'unavailable');
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
    probes: {
      meta: {
        ok: true,
        window: 'account_read',
        verified_identities: { ad_account_id: '2805795896467959' },
        provenance: 'live_api',
      },
    },
  });
  assert.equal(snapshot.observed_at, '2026-09-03T10:00:00.000Z');
  assert.equal(snapshot.providers[0].provider, 'meta');
  assert.equal(snapshot.providers[0].status, 'healthy');
  assert.deepEqual(snapshot.providers[0].source, { kind: 'live_api', provenance: 'meta' });
  assert.equal(snapshot.providers[0].freshness.window, 'account_read');
  assert.deepEqual(snapshot.providers[0].games, []);
  assert.deepEqual(snapshot.providers[0].verified_identities, { ad_account_id: '2805795896467959' });
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
      return { ok: true, status: 200, json: async () => ({ id: 'act_2805795896467959', account_status: 1 }) };
    },
  });
  assert.deepEqual(ok, {
    ok: true,
    window: 'account_read',
    verified_identities: { ad_account_id: '2805795896467959' },
    provenance: 'live_api',
  });
  assert.match(request.url, /act_2805795896467959/);
  assert.doesNotMatch(request.url, /meta-secret/);
  assert.equal(request.options.headers.Authorization, 'Bearer meta-secret');

  const wrongIdentity = await probeMeta({
    accountId: '2805795896467959', accessToken: 'meta-secret',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: 'act_other', account_status: 2 }) }),
  });
  assert.deepEqual(wrongIdentity, { ok: false, status: 'degraded', category: 'identity_mismatch', provenance: 'live_api' });

  const denied = await probeMeta({
    accountId: '2805795896467959', accessToken: 'meta-secret',
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'LEAK-ME' }),
  });
  assert.deepEqual(denied, { ok: false, status: 403, provenance: 'live_api' });
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
    provenance: 'live_api',
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

test('AppsFlyer live health bypasses aggregate cache entries', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsflyer-health-cache-'));
  fs.writeFileSync(path.join(cacheDir, 'id6772100729_partners_by_date_report_v5_2026-09-03_2026-09-03.json'), JSON.stringify({
    schema_version: 1,
    app_id: 'id6772100729',
    report: 'partners_by_date_report_v5',
    report_version: 'v5',
    requested_window: { from: '2026-09-03', to: '2026-09-03' },
    acquired_at: '2026-09-03T09:00:00.000Z',
    csv: 'cached',
  }), { mode: 0o600 });
  let requests = 0;
  try {
    const result = await probeAppsFlyer({
      appIds: ['id6772100729'], accessToken: 'REVOKED', date: '2026-09-03', cacheDir,
      fetchImpl: async () => { requests += 1; return { ok: false, status: 401, text: async () => '' }; },
    });
    assert.equal(requests, 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'auth_required');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('App Store Connect probe follows trusted pagination until all expected app IDs are verified', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const requests = [];
  const result = await probeAppStoreConnect({
    issuerId: 'issuer-id', keyId: 'KEY123', privateKey,
    expectedAppIds: ['6772100729', '6796698146'],
    fetchImpl: async (url) => {
      requests.push(url);
      return requests.length === 1
        ? { ok: true, status: 200, json: async () => ({ data: [{ id: '6772100729' }], links: { next: 'https://api.appstoreconnect.apple.com/v1/apps?cursor=next' } }) }
        : { ok: true, status: 200, json: async () => ({ data: [{ id: '6796698146' }], links: { next: null } }) };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.games, [{ app_store_id: '6772100729' }, { app_store_id: '6796698146' }]);
  assert.equal(requests.length, 2);
});

test('App Store Connect probe signs a short-lived JWT with built-in crypto', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let request;
  const result = await probeAppStoreConnect({
    issuerId: 'issuer-id',
    keyId: 'KEY123',
    privateKey,
    expectedAppIds: ['6772100729', '6796698146'],
    nowSeconds: 1_788_430_000,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '6772100729' }, { id: '6796698146' }] }),
      };
    },
  });
  assert.deepEqual(result, {
    ok: true,
    window: 'catalog_read',
    games: [{ app_store_id: '6772100729' }, { app_store_id: '6796698146' }],
    provenance: 'live_api',
  });
  assert.equal(request.url, 'https://api.appstoreconnect.apple.com/v1/apps?limit=200');
  const token = request.options.headers.Authorization.replace('Bearer ', '');
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    iss: 'issuer-id', iat: 1_788_430_000, exp: 1_788_431_190, aud: 'appstoreconnect-v1',
  });
  assert.ok(signature.length > 20);

  const missingApps = await probeAppStoreConnect({
    issuerId: 'issuer-id', keyId: 'KEY123', privateKey,
    expectedAppIds: ['6772100729', '6796698146'],
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }),
  });
  assert.deepEqual(missingApps, { ok: false, status: 'degraded', category: 'identity_mismatch', provenance: 'live_api' });

  const invalid = await probeAppStoreConnect({
    issuerId: 'issuer-id', keyId: 'KEY123', privateKey: 'not-a-private-key',
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  assert.deepEqual(invalid, { ok: false, code: 'INVALID_CREDENTIAL' });
  assert.deepEqual(classifyProbeFailure(invalid), { status: 'auth_required', category: 'invalid_credential' });
});
