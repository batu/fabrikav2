#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const OUTPUT_ROOT = '/Users/base/store-review/find-games/analytics/daily-scorecard';
const AF_TOKEN_FILE = '/Users/base/.config/base-game-lab/appsflyer-reporting-api.token';
const META_TOKEN_FILE = '/Users/base/.config/base-game-lab/meta-marketing-api.token';
const CLEAN_WINDOW_START = '2026-09-03';
const GA_ORIGIN = 'https://tool.gameanalytics.com';
const CDP_LIST = 'http://127.0.0.1:9222/json/list';
const APPS = {
  find_the_dog: {
    appsflyer_id: 'id6772100729',
    clean_versions: ['1.0.5'],
    contaminated_versions: [],
    test_versions: [],
    gameanalytics_project_id: '350269',
    gameanalytics_url: `${GA_ORIGIN}/game/350269/overview/overview`,
    play_app_id: '4973424984228760590',
    play_track_id: '4700446759663339796',
  },
  find_the_bird: {
    appsflyer_id: 'id6796698146',
    clean_versions: ['1.2'],
    contaminated_versions: ['1.0.4'],
    test_versions: ['1.2.1'],
    gameanalytics_project_id: '351396',
    gameanalytics_url: `${GA_ORIGIN}/game/351396/overview/overview`,
    play_app_id: '4974882399025183247',
    play_track_id: '4700710974037075095',
  },
};
const META_OBJECTS = {
  campaign: ['120249362071020442', 'id,name,status,effective_status,start_time,stop_time,spend_cap,issues_info,insights.date_preset(maximum){spend,impressions,clicks}'],
  adset: ['120249363410850442', 'id,name,status,effective_status,start_time,end_time,daily_budget,issues_info'],
  ad: ['120249363412840442', 'id,name,status,effective_status,issues_info'],
};

const observedAt = new Date().toISOString();
const today = observedAt.slice(0, 10);
const result = {
  schema_version: 1,
  observed_at: observedAt,
  window: { from: CLEAN_WINDOW_START, to: today, timezone: 'UTC' },
  authorities: {
    acquisition: 'AppsFlyer',
    product_behavior: 'GameAnalytics',
    paid_delivery: 'Meta',
    android_release: 'Google Play',
  },
  games: {},
  meta: null,
  limitations: [],
};

function readSecret(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return await response.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) return [];
  const header = rows.shift().map((value) => value.replace(/^\uFEFF/, ''));
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}

function countBy(rows, keys, fallback = 'unknown') {
  const counts = {};
  for (const row of rows) {
    const key = keys.map((name) => row[name]).find((value) => value?.trim())?.trim() || fallback;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function appsFlyerSnapshot(game, config, token) {
  const reports = {};
  for (const report of ['organic_installs_report', 'installs_report', 'in_app_events_report']) {
    const query = new URLSearchParams({ from: CLEAN_WINDOW_START, to: today });
    const url = `https://hq1.appsflyer.com/api/raw-data/export/app/${config.appsflyer_id}/${report}/v5?${query}`;
    try {
      const rows = parseCsv(await fetchText(url, { Authorization: `Bearer ${token}` }));
      reports[report] = {
        status: 'healthy',
        row_count: rows.length,
        by_app_version: countBy(rows, ['App Version', 'app_version']),
        by_media_source: countBy(rows, ['Media Source', 'media_source'], 'unattributed'),
        by_event: countBy(rows.filter((row) => row['Event Name'] || row.event_name), ['Event Name', 'event_name']),
      };
    } catch (error) {
      reports[report] = { status: String(error.message).includes('HTTP_403') ? 'rate_limited' : 'unavailable', error_category: String(error.message).slice(0, 40) };
    }
  }
  const organicVersions = reports.organic_installs_report.by_app_version || {};
  const attributedRows = reports.installs_report.row_count ?? null;
  const sum = (versions) => versions.reduce((total, version) => total + (organicVersions[version] || 0), 0);
  return {
    provider: 'AppsFlyer',
    source: 'live_api',
    app_id: config.appsflyer_id,
    reports,
    acquisition: {
      clean_public_unattributed_installs: sum(config.clean_versions),
      clean_test_or_prerelease_unattributed_installs: sum(config.test_versions),
      contaminated_installs_excluded: sum(config.contaminated_versions),
      paid_attributed_installs: attributedRows,
      classifications: {
        clean_public_versions: config.clean_versions,
        test_or_prerelease_versions: config.test_versions,
        contaminated_versions: config.contaminated_versions,
      },
    },
  };
}

function cdpClient(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const call = async (method, params = {}) => {
    await ready;
    const id = ++nextId;
    return await new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return { call, close: () => ws.close() };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function overviewMetric(text, label) {
  const match = text.match(new RegExp(`(?:^|\\n)${label}\\n([^\\n]+)`, 'm'));
  if (!match || match[1] === 'N/A') return null;
  const raw = match[1].trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

function playState(text) {
  const inReview = /\bIn review\b/i.test(text);
  const active = /\bActiveRelease\b/i.test(text) || /Track summary[\s\S]{0,300}\bActive\b/i.test(text);
  const countries = text.match(/(\d+) countries\/regions/i)?.[1];
  return {
    source: 'authenticated_browser',
    track_status: active ? 'Active' : null,
    release_status: inReview ? 'In review' : null,
    targeted_countries: countries ? Number(countries) : null,
  };
}

async function browserSnapshots() {
  const targets = await (await fetch(CDP_LIST, { signal: AbortSignal.timeout(5_000) })).json();
  const gaTarget = targets.find((target) => target.type === 'page' && target.url.startsWith(`${GA_ORIGIN}/game/`));
  if (!gaTarget) throw new Error('gameanalytics_browser_target_missing');
  const originalGaUrl = gaTarget.url;
  const client = cdpClient(gaTarget.webSocketDebuggerUrl);
  try {
    for (const [game, config] of Object.entries(APPS)) {
      await client.call('Page.navigate', { url: config.gameanalytics_url });
      let text = '';
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await delay(attempt === 0 ? 7_000 : 4_000);
        const response = await client.call('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
        text = response.result?.result?.value || '';
        if (!/\nDAU\nN\/A\n/.test(text)) break;
      }
      const dau = overviewMetric(text, 'DAU');
      const sessions = overviewMetric(text, 'Sessions');
      const playtime = overviewMetric(text, 'Playtime');
      const newUsers = overviewMetric(text, 'New Users');
      const activeNow = [...text.matchAll(/Active users\n(\d+)/g)].at(-1)?.[1];
      result.games[game].gameanalytics = {
        provider: 'GameAnalytics', source: 'authenticated_browser', project_id: config.gameanalytics_project_id,
        dau, new_users: newUsers, sessions, playtime, active_now: activeNow === undefined ? null : Number(activeNow),
        status: dau === null ? 'pending_processing' : 'healthy',
      };
    }
  } finally {
    if (originalGaUrl) await client.call('Page.navigate', { url: originalGaUrl });
    client.close();
  }

  const refreshedTargets = await (await fetch(CDP_LIST, { signal: AbortSignal.timeout(5_000) })).json();
  for (const [game, config] of Object.entries(APPS)) {
    const marker = `/app/${config.play_app_id}/tracks/${config.play_track_id}`;
    const target = refreshedTargets.find((candidate) => candidate.type === 'page' && candidate.url.includes(marker));
    if (!target) {
      result.games[game].google_play = { source: 'none', status: 'unavailable', error_category: 'track_browser_target_missing' };
      continue;
    }
    const playClient = cdpClient(target.webSocketDebuggerUrl);
    const response = await playClient.call('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
    playClient.close();
    result.games[game].google_play = playState(response.result?.result?.value || '');
  }
}

async function metaSnapshot(token) {
  const snapshot = { provider: 'Meta', source: 'live_api', objects: {} };
  for (const [name, [id, fields]] of Object.entries(META_OBJECTS)) {
    try {
      const query = new URLSearchParams({ fields, access_token: token });
      const response = await fetch(`https://graph.facebook.com/v24.0/${id}?${query}`, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const raw = await response.json();
      snapshot.objects[name] = {
        id: raw.id, name: raw.name, status: raw.status, effective_status: raw.effective_status,
        start_time: raw.start_time ?? null, stop_time: raw.stop_time ?? raw.end_time ?? null,
        spend_cap: raw.spend_cap ?? null, daily_budget: raw.daily_budget ?? null,
        issues_count: Array.isArray(raw.issues_info) ? raw.issues_info.length : 0,
        insights: raw.insights?.data?.map(({ spend, impressions, clicks, date_start, date_stop }) => ({ spend, impressions, clicks, date_start, date_stop })) ?? [],
      };
    } catch (error) {
      snapshot.objects[name] = { id, status: 'unavailable', error_category: String(error.message).slice(0, 40) };
    }
  }
  const statuses = Object.values(snapshot.objects).map((object) => object.effective_status);
  snapshot.delivery_state = statuses.length === 3 && statuses.every((status) => status === 'ACTIVE') ? 'ACTIVE' : 'DEGRADED';
  return snapshot;
}

function qualityGates() {
  const ftd = result.games.find_the_dog.gameanalytics;
  const ftb = result.games.find_the_bird.gameanalytics;
  result.games.find_the_dog.session_quality = {
    status: 'quarantined_pending_second_clean_snapshot',
    reason: 'Historical GameAnalytics queue replay invalidated native sessions. A single plausible snapshot is not enough to re-authorize the KPI.',
    heuristic_snapshot_plausible: Number.isFinite(ftd?.dau) && Number.isFinite(ftd?.sessions) && ftd.sessions <= ftd.dau * 4,
    acceptance_gate: 'Two consecutive daily snapshots with sessions <= 4x DAU, no inverse playtime/session anomaly, and canonical progression still present.',
  };
  result.games.find_the_bird.session_quality = {
    status: Number.isFinite(ftb?.dau) && ftb.dau >= 10 ? 'candidate' : 'insufficient_sample',
    reason: 'At least 10 DAU are required before using aggregate session ratios for a directional product decision.',
  };
}

try {
  const afToken = readSecret(AF_TOKEN_FILE);
  for (const [game, config] of Object.entries(APPS)) {
    result.games[game] = { appsflyer: await appsFlyerSnapshot(game, config, afToken) };
  }
} catch (error) {
  result.limitations.push(`AppsFlyer unavailable: ${String(error.message).slice(0, 80)}`);
  for (const game of Object.keys(APPS)) result.games[game] = { appsflyer: { status: 'unavailable' } };
}

try { await browserSnapshots(); }
catch (error) { result.limitations.push(`Browser analytics unavailable: ${String(error.message).slice(0, 80)}`); }
try { result.meta = await metaSnapshot(readSecret(META_TOKEN_FILE)); }
catch (error) { result.limitations.push(`Meta unavailable: ${String(error.message).slice(0, 80)}`); }
qualityGates();

fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
const stamp = observedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outputPath = path.join(OUTPUT_ROOT, `${stamp}.json`);
const latestPath = path.join(OUTPUT_ROOT, 'latest.json');
const serialized = `${JSON.stringify(result, null, 2)}\n`;
fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
fs.writeFileSync(latestPath, serialized, { mode: 0o600 });
fs.chmodSync(outputPath, 0o600);
fs.chmodSync(latestPath, 0o600);
console.log(JSON.stringify({ evidence_path: outputPath, ...result }, null, 2));
