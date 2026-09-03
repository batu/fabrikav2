import fs from 'node:fs';
import { sign } from 'node:crypto';
import {
  AppsFlyerReportingError,
  fetchAppsFlyerCsv,
  isCanonicalIsoTimestamp,
  validateDateWindow,
} from './appsflyer.mjs';

const LOGIN_ROUTE = /(?:\/login|\/signin|accounts\.google\.com|appleid\.apple\.com|business\.facebook\.com\/login)/i;

export function inspectBrowserInventory(tabs, providers, contract) {
  if (!Array.isArray(tabs) || tabs.some((tab) => (
    !Number.isInteger(tab?.window) || tab.window < 1
    || !Number.isInteger(tab?.index) || tab.index < 1
    || typeof tab?.title !== 'string'
    || typeof tab?.url !== 'string'
  ))) throw new Error('invalid browser tab inventory');
  const windows = new Set(tabs.map((tab) => tab.window));
  const providerResults = {};
  for (const provider of providers) {
    const matches = tabs.filter((tab) => tabMatchesProvider(tab, provider.tab));
    let status = 'authenticated';
    if (matches.length === 0) status = 'missing';
    else if (matches.length > 1) status = 'duplicate';
    else if (isLoginRoute(matches[0].url)) status = 'auth_required';
    providerResults[provider.id] = {
      status,
      tab_count: matches.length,
      tabs: matches.map(({ window, index, url }) => ({ window, index, title: '<redacted>', url: sanitizeUrl(url) })),
    };
  }
  const providerDegraded = Object.values(providerResults).some(({ status }) => status !== 'authenticated');
  const workspaceHealthy = windows.size === contract.expectedWindowCount
    && tabs.length === contract.expectedTabCount
    && !providerDegraded;
  return {
    workspace: {
      status: workspaceHealthy ? 'healthy' : 'degraded',
      window_count: windows.size,
      tab_count: tabs.length,
      expected_window_count: contract.expectedWindowCount,
      expected_tab_count: contract.expectedTabCount,
    },
    providers: providerResults,
  };
}

export function inspectCredential(spec, env = process.env) {
  if (!['sdk_ingestion', 'reporting_api'].includes(spec.kind)) throw new Error(`unsupported credential kind: ${spec.kind}`);
  if (spec.env) {
    const present = typeof env[spec.env] === 'string' && env[spec.env].trim() !== '';
    return {
      kind: spec.kind,
      status: present ? 'available' : 'missing_credential',
      locator: `env:${spec.env}`,
    };
  }
  if (spec.path_env) {
    const file = env[spec.path_env];
    const locator = `path_env:${spec.path_env}`;
    if (!file || !fs.existsSync(file)) {
      return { kind: spec.kind, status: 'missing_credential', locator, exists: false };
    }
    const mode = fs.statSync(file).mode & 0o777;
    return {
      kind: spec.kind,
      status: (mode & 0o077) === 0 ? 'available' : 'degraded',
      locator,
      exists: true,
      mode: mode.toString(8).padStart(4, '0'),
    };
  }
  throw new Error('credential requires env or path_env');
}

export function validateIdentityConfig(games) {
  if (!Array.isArray(games) || games.length === 0) throw new Error('games must be a non-empty array');
  const fields = ['id', 'app_store_id', 'appsflyer_app_id', 'bundle_id', 'gameanalytics_project_id'];
  for (const field of fields) {
    const seen = new Set();
    for (const game of games) {
      if (typeof game[field] !== 'string' || game[field] === '') throw new Error(`${field} is required for every game`);
      if (seen.has(game[field])) throw new Error(`duplicate ${field}: identities must remain isolated`);
      seen.add(game[field]);
    }
  }
  return games;
}

export function validateObservedAt(value) {
  if (!isCanonicalIsoTimestamp(value)) throw new Error('observed_at must be canonical ISO-8601');
  return value;
}

export function validateProbeFixtures(input, providers, games) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('probe fixture must be an object');
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const result = {};
  for (const [providerId, fixture] of Object.entries(input)) {
    const provider = byId.get(providerId);
    if (!provider) throw new Error(`unknown probe fixture provider: ${providerId}`);
    if (!provider.api) {
      result[providerId] = { ok: false, status: 'degraded', category: 'unsupported_fixture', provenance: 'fixture' };
      continue;
    }
    result[providerId] = validateSupportedFixture(provider, fixture, games);
  }
  return result;
}

function validateSupportedFixture(provider, fixture, games) {
  if (!fixture || typeof fixture.ok !== 'boolean') throw new Error(`invalid ${provider.api} probe fixture`);
  if (!fixture.ok) {
    const allowedStatus = ['auth_required', 'degraded', 'unavailable'].includes(fixture.status) ? fixture.status : 'degraded';
    return { ok: false, status: allowedStatus, category: 'fixture_failure', provenance: 'fixture' };
  }
  if (provider.api === 'meta') {
    const expected = `act_${provider.ad_account_id}`;
    if (fixture.window !== 'account_read' || fixture.account?.id !== expected || fixture.account?.account_status !== 1) {
      throw new Error('invalid meta probe fixture');
    }
    return { ok: true, window: 'account_read', verified_identities: { ad_account_id: provider.ad_account_id }, provenance: 'fixture' };
  }
  if (provider.api === 'appsflyer') {
    const expected = games.map(({ appsflyer_app_id: id }) => id).sort();
    const validGameRows = Array.isArray(fixture.games)
      && fixture.games.every(({ appsflyer_app_id: id, ok }) => typeof id === 'string' && ok === true);
    const actual = validGameRows ? fixture.games.map(({ appsflyer_app_id: id }) => id).sort() : [];
    let validWindow = true;
    try {
      validateDateWindow(fixture.window?.from, fixture.window?.to);
    } catch {
      validWindow = false;
    }
    if (!validWindow || !validGameRows || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('invalid appsflyer probe fixture');
    }
    return { ok: true, window: fixture.window, games: expected.map((appsflyer_app_id) => ({ appsflyer_app_id })), provenance: 'fixture' };
  }
  if (provider.api === 'app_store_connect') {
    const expected = games.map(({ app_store_id: id }) => id).sort();
    const actual = Array.isArray(fixture.games) ? fixture.games.map(({ app_store_id: id }) => id).sort() : [];
    if (fixture.window !== 'catalog_read' || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('invalid app_store_connect probe fixture');
    }
    return { ok: true, window: 'catalog_read', games: expected.map((app_store_id) => ({ app_store_id })), provenance: 'fixture' };
  }
  return { ok: false, status: 'degraded', category: 'unsupported_fixture', provenance: 'fixture' };
}

export function classifyProbeFailure(error) {
  if (error?.category && ['auth_required', 'degraded', 'unavailable'].includes(error.status)) {
    return { status: error.status, category: error.category };
  }
  if (error?.code === 'INVALID_CREDENTIAL') return { status: 'auth_required', category: 'invalid_credential' };
  if (error?.status === 401 || error?.status === 403) return { status: 'auth_required', category: 'invalid_credential' };
  if (error?.status === 429) return { status: 'degraded', category: 'rate_limited' };
  if (Number.isInteger(error?.status) && error.status >= 500) return { status: 'unavailable', category: 'provider_unavailable' };
  if (error?.code) return { status: 'unavailable', category: 'network_error' };
  return { status: 'degraded', category: 'probe_failed' };
}

export async function probeAppsFlyer({ appIds, accessToken, date, fetchImpl = fetch, cacheDir }) {
  const results = await Promise.allSettled(appIds.map(async (appId) => {
    await fetchAppsFlyerCsv({ appId, token: accessToken, from: date, to: date, fetchImpl, cacheDir, bypassCache: true });
    return { appsflyer_app_id: appId, ok: true };
  }));
  const failure = results.find(({ status }) => status === 'rejected');
  if (failure) {
    if (failure.reason instanceof AppsFlyerReportingError) {
      return { ok: false, status: failure.reason.status, category: failure.reason.category };
    }
    return { ok: false, code: 'NETWORK_ERROR' };
  }
  return {
    ok: true,
    window: { from: date, to: date },
    games: results.map(({ value }) => value),
    provenance: 'live_api',
  };
}

export async function probeMeta({ accountId, accessToken, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`https://graph.facebook.com/v23.0/act_${encodeURIComponent(accountId)}?fields=id%2Caccount_status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, status: response.status, provenance: 'live_api' };
    const account = await response.json();
    if (account?.id !== `act_${accountId}` || account?.account_status !== 1) {
      return { ok: false, status: 'degraded', category: 'identity_mismatch', provenance: 'live_api' };
    }
    return {
      ok: true,
      window: 'account_read',
      verified_identities: { ad_account_id: accountId },
      provenance: 'live_api',
    };
  } catch (error) {
    return { ok: false, code: error?.code ?? 'NETWORK_ERROR' };
  }
}

export async function probeAppStoreConnect({ issuerId, keyId, privateKey, expectedAppIds, nowSeconds = Math.floor(Date.now() / 1000), fetchImpl = fetch }) {
  let token;
  try {
    const header = base64urlJson({ alg: 'ES256', kid: keyId, typ: 'JWT' });
    const payload = base64urlJson({ iss: issuerId, iat: nowSeconds, exp: nowSeconds + 1190, aud: 'appstoreconnect-v1' });
    const signingInput = `${header}.${payload}`;
    const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    token = `${signingInput}.${signature}`;
  } catch {
    return { ok: false, code: 'INVALID_CREDENTIAL' };
  }
  try {
    const expected = [...(expectedAppIds ?? [])].sort();
    const returned = new Set();
    const seenPages = new Set();
    let nextUrl = 'https://api.appstoreconnect.apple.com/v1/apps?limit=200';
    while (nextUrl && expected.some((id) => !returned.has(id))) {
      const parsedUrl = new URL(nextUrl);
      if (parsedUrl.origin !== 'https://api.appstoreconnect.apple.com'
        || seenPages.has(parsedUrl.toString())
        || seenPages.size >= 100) {
        return { ok: false, status: 'degraded', category: 'invalid_pagination', provenance: 'live_api' };
      }
      seenPages.add(parsedUrl.toString());
      const response = await fetchImpl(parsedUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { ok: false, status: response.status, provenance: 'live_api' };
      const payload = await response.json();
      if (Array.isArray(payload?.data)) {
        for (const { id } of payload.data) returned.add(id);
      }
      nextUrl = payload?.links?.next ?? null;
    }
    if (expected.length === 0 || expected.some((id) => !returned.has(id))) {
      return { ok: false, status: 'degraded', category: 'identity_mismatch', provenance: 'live_api' };
    }
    return {
      ok: true,
      window: 'catalog_read',
      games: expected.map((app_store_id) => ({ app_store_id })),
      provenance: 'live_api',
    };
  } catch (error) {
    return { ok: false, code: error?.code ?? 'NETWORK_ERROR' };
  }
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function buildHealthSnapshot({ observedAt, games, providers, tabs, browserContract, browserFailure, env, probes = {} }) {
  validateObservedAt(observedAt);
  validateIdentityConfig(games);
  const browser = inspectBrowserInventory(tabs, providers, browserContract);
  if (browserFailure) {
    browser.workspace.status = 'unavailable';
    browser.workspace.error = { category: 'browser_unavailable' };
  }
  return {
    schema_version: 1,
    observed_at: observedAt,
    browser: browser.workspace,
    providers: providers.map((provider) => buildProviderHealth(provider, games, browser.providers[provider.id], env, probes[provider.id], observedAt)),
  };
}

function buildProviderHealth(provider, games, browserState, env, probe, observedAt) {
  const credentials = (provider.credentials ?? []).map((credential) => inspectCredential(credential, env));
  const base = {
    observed_at: observedAt,
    provider: provider.id,
    status: 'degraded',
    source: { kind: 'authenticated_browser', provenance: provider.id },
    freshness: { observed_at: observedAt, window: null },
    games: games.map((game) => ({ ...game })),
    credentials,
    error: null,
  };
  if (probe?.ok) {
    const fixture = probe.provenance === 'fixture';
    return {
      ...base,
      status: fixture ? 'degraded' : 'healthy',
      source: { kind: fixture ? 'fixture' : 'live_api', provenance: provider.api ?? provider.id },
      freshness: { observed_at: observedAt, window: probe.window ?? null },
      games: verifiedGames(games, probe.games),
      ...(probe.verified_identities ? { verified_identities: probe.verified_identities } : {}),
      ...(fixture ? { error: { category: 'fixture_evidence_only' } } : {}),
    };
  }
  if (probe && !probe.ok) {
    const failure = classifyProbeFailure(probe);
    const fixture = probe.provenance === 'fixture';
    return {
      ...base,
      status: failure.status,
      source: { kind: fixture ? 'fixture' : 'live_api', provenance: provider.api ?? provider.id },
      games: [],
      error: { category: failure.category },
    };
  }
  const reporting = credentials.filter(({ kind }) => kind === 'reporting_api');
  const missingReporting = reporting.length > 0 && reporting.some(({ status }) => status === 'missing_credential');
  if (browserState.status === 'auth_required') return { ...base, status: 'auth_required', error: { category: 'browser_auth_required' } };
  if (browserState.status === 'missing') return { ...base, status: missingReporting ? 'missing_credential' : 'unavailable', source: { kind: 'none', provenance: provider.id }, error: { category: missingReporting ? 'missing_credential' : 'browser_tab_missing' } };
  if (browserState.status === 'duplicate') return { ...base, status: 'degraded', error: { category: 'browser_tab_duplicate' } };
  if (missingReporting) return { ...base, error: { category: 'missing_credential' } };
  return { ...base, error: { category: 'browser_fallback_only' } };
}

function verifiedGames(games, identities) {
  if (!Array.isArray(identities)) return [];
  return games.filter((game) => identities.some((identity) => (
    (identity.appsflyer_app_id && identity.appsflyer_app_id === game.appsflyer_app_id)
    || (identity.app_store_id && identity.app_store_id === game.app_store_id)
  ))).map((game) => ({ ...game }));
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : '<invalid-url>';
  } catch {
    return '<invalid-url>';
  }
}

function tabMatchesProvider(tab, spec) {
  try {
    const url = new URL(tab.url);
    return url.protocol === 'https:' && url.port === ''
      && spec.hosts.some((host) => url.hostname.toLowerCase() === host.toLowerCase());
  } catch {
    return false;
  }
}

function isLoginRoute(value) {
  try {
    const url = new URL(value);
    return LOGIN_ROUTE.test(`${url.hostname}${url.pathname}`);
  } catch {
    return false;
  }
}
