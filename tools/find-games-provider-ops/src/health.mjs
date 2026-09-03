import fs from 'node:fs';
import { sign } from 'node:crypto';
import { AppsFlyerReportingError, fetchAppsFlyerCsv } from './appsflyer.mjs';

const LOGIN_ROUTE = /(?:\/login|\/signin|accounts\.google\.com|appleid\.apple\.com|business\.facebook\.com\/login)/i;

export function inspectBrowserInventory(tabs, providers, contract) {
  const windows = new Set(tabs.map((tab) => tab.window));
  const providerResults = {};
  for (const provider of providers) {
    const matches = tabs.filter((tab) => tabMatchesProvider(tab, provider.tab));
    let status = 'authenticated';
    if (matches.length === 0) status = 'missing';
    else if (matches.length > 1) status = 'duplicate';
    else if (LOGIN_ROUTE.test(matches[0].url) || LOGIN_ROUTE.test(matches[0].title)) status = 'auth_required';
    providerResults[provider.id] = {
      status,
      tab_count: matches.length,
      tabs: matches.map(({ window, index, title, url }) => ({ window, index, title, url: sanitizeUrl(url) })),
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
    await fetchAppsFlyerCsv({ appId, token: accessToken, from: date, to: date, fetchImpl, cacheDir });
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
  };
}

export async function probeMeta({ accountId, accessToken, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`https://graph.facebook.com/v23.0/act_${encodeURIComponent(accountId)}?fields=id%2Caccount_status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true, window: 'account_read' } : { ok: false, status: response.status };
  } catch (error) {
    return { ok: false, code: error?.code ?? 'NETWORK_ERROR' };
  }
}

export async function probeAppStoreConnect({ issuerId, keyId, privateKey, nowSeconds = Math.floor(Date.now() / 1000), fetchImpl = fetch }) {
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
    const response = await fetchImpl('https://api.appstoreconnect.apple.com/v1/apps?limit=1', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true, window: 'catalog_read' } : { ok: false, status: response.status };
  } catch (error) {
    return { ok: false, code: error?.code ?? 'NETWORK_ERROR' };
  }
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function buildHealthSnapshot({ observedAt, games, providers, tabs, browserContract, env, probes = {} }) {
  validateIdentityConfig(games);
  const browser = inspectBrowserInventory(tabs, providers, browserContract);
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
    return {
      ...base,
      status: 'healthy',
      source: { kind: 'live_api', provenance: provider.api ?? provider.id },
      freshness: { observed_at: observedAt, window: probe.window ?? null },
    };
  }
  if (probe && !probe.ok) {
    const failure = classifyProbeFailure(probe);
    return {
      ...base,
      status: failure.status,
      source: { kind: 'live_api', provenance: provider.api ?? provider.id },
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

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

function tabMatchesProvider(tab, spec) {
  const haystack = `${tab.title} ${tab.url}`.toLowerCase();
  return spec.hosts.some((host) => haystack.includes(host.toLowerCase()))
    || haystack.includes(spec.label.toLowerCase());
}
