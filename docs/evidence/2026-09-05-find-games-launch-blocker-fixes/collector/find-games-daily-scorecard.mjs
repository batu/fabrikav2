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
    paid_cohort: null, // Only Ads may approve after Store public/receipt evidence and QA exclusion.
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
    paid_cohort: null, // Diagnostic CLEAN_WINDOW_START is not a public T0.
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

function parseCsv(text, report) {
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
  if (quoted || !rows.length) throw new Error('invalid_report_csv');
  const header = rows.shift().map((value) => value.replace(/^\uFEFF/, ''));
  if (!['App Version', 'app_version'].some((name) => header.includes(name))) throw new Error('missing_app_version_column');
  if (report === 'installs_report' && [
    ['App ID', 'app_id'], ['Install Time', 'install_time'],
    ['Media Source', 'media_source'], ['Campaign ID', 'campaign_id'],
  ].some((names) => !names.some((name) => header.includes(name)))) throw new Error('missing_paid_cohort_column');
  const data = rows.filter((values) => values.some(Boolean));
  if (data.some((values) => values.length !== header.length)) throw new Error('invalid_report_row');
  return data.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index]])));
}

function countBy(rows, keys, fallback = 'unknown') {
  const counts = {};
  for (const row of rows) {
    const key = keys.map((name) => row[name]).find((value) => value?.trim())?.trim() || fallback;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function installTimestamp(value) {
  // AppsFlyer timestamps without a zone are UTC; require seconds, never invent midnight.
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(\.\d{1,3})?(Z|[+-]\d\d:\d\d)?$/);
  if (!match) return NaN;
  const local = `${match[1]}T${match[2]}${(match[3] || '.').padEnd(4, '0')}Z`;
  const time = Date.parse(local);
  // ISO round-trip rejects impossible dates, 24:00 and out-of-range clock components.
  if (!Number.isFinite(time) || new Date(time).toISOString() !== local) return NaN;
  const zone = match[4] || 'Z';
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return NaN;
  return Date.parse(`${match[1]}T${match[2]}${match[3] || ''}${zone}`);
}

function paidAcquisition(rows, config) {
  const cohort = config.paid_cohort;
  // Approval is an operator assertion after public availability + exact-build receipt,
  // never inferred from version, report date, or this diagnostic window's start.
  const utc = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
  const valid = cohort?.approved === true && utc(cohort.from_utc)
    && Date.parse(cohort.from_utc) >= Date.parse(`${CLEAN_WINDOW_START}T00:00:00Z`)
    && Date.parse(cohort.from_utc) <= Date.parse(observedAt)
    && config.clean_versions.includes(cohort.app_version)
    && !config.test_versions.includes(cohort.app_version) && !config.contaminated_versions.includes(cohort.app_version)
    && Array.isArray(cohort.campaign_ids) && cohort.campaign_ids.length > 0
    && cohort.campaign_ids.every((id) => typeof id === 'string' && id.trim())
    && cohort.qa_exclusions_complete === true && Array.isArray(cohort.excluded_qa_windows)
    && cohort.excluded_qa_windows.every((window) => utc(window?.from) && utc(window?.to) && Date.parse(window.from) <= Date.parse(window.to));
  if (!valid) return { paid_status: 'pending_cohort', paid_attributed_installs: null };
  if (!rows) return { paid_status: 'incomplete', paid_attributed_installs: null };
  const counts = { accepted: 0, excluded: 0, unknown: 0 };
  for (const row of rows) {
    const value = (title, alias) => row[title] ?? row[alias] ?? '';
    const app = value('App ID', 'app_id');
    const version = value('App Version', 'app_version');
    const rawTime = value('Install Time', 'install_time');
    const time = installTimestamp(rawTime);
    const media = value('Media Source', 'media_source');
    const campaign = value('Campaign ID', 'campaign_id');
    if ([app, version, media, campaign].some((dimension) => typeof dimension !== 'string' || !dimension.trim()) || !Number.isFinite(time)) {
      counts.unknown += 1;
    } else if (app !== config.appsflyer_id || !config.clean_versions.includes(version)
      || config.test_versions.includes(version) || config.contaminated_versions.includes(version)
      || version !== cohort.app_version || time < Date.parse(cohort.from_utc)
      || time > Date.parse(observedAt)
      || !cohort.campaign_ids.includes(campaign) || media.toLowerCase() === 'organic'
      || cohort.excluded_qa_windows.some((window) => time >= Date.parse(window.from) && time <= Date.parse(window.to))) {
      counts.excluded += 1;
    } else counts.accepted += 1;
  }
  return {
    paid_status: counts.unknown ? 'incomplete' : 'complete',
    paid_attributed_installs: counts.unknown ? null : counts.accepted,
    paid_classification_counts: counts,
  };
}

async function appsFlyerSnapshot(game, config, token) {
  const reports = {};
  let attributedRows = null;
  for (const report of ['organic_installs_report', 'installs_report', 'in_app_events_report']) {
    const query = new URLSearchParams({ from: CLEAN_WINDOW_START, to: today });
    const url = `https://hq1.appsflyer.com/api/raw-data/export/app/${config.appsflyer_id}/${report}/v5?${query}`;
    try {
      const rows = parseCsv(await fetchText(url, { Authorization: `Bearer ${token}` }), report);
      reports[report] = {
        status: 'healthy',
        row_count: rows.length,
        by_app_version: countBy(rows, ['App Version', 'app_version']),
        by_media_source: countBy(rows, ['Media Source', 'media_source'], 'unattributed'),
        by_event: countBy(rows.filter((row) => row['Event Name'] || row.event_name), ['Event Name', 'event_name']),
      };
      if (report === 'installs_report') attributedRows = rows;
    } catch (error) {
      reports[report] = { status: String(error.message).includes('HTTP_403') ? 'rate_limited' : 'unavailable', error_category: String(error.message).slice(0, 40) };
    }
  }
  const organicVersions = reports.organic_installs_report.by_app_version || {};

  const organicComplete = reports.organic_installs_report.status === 'healthy' && !organicVersions.unknown;
  const sum = (versions) => organicComplete ? versions.reduce((total, version) => total + (organicVersions[version] || 0), 0) : null;
  return {
    provider: 'AppsFlyer',
    source: 'live_api',
    app_id: config.appsflyer_id,
    reports,
    acquisition: {
      organic_status: organicComplete ? 'complete' : 'incomplete',
      clean_public_unattributed_installs: sum(config.clean_versions),
      clean_test_or_prerelease_unattributed_installs: sum(config.test_versions),
      contaminated_installs_excluded: sum(config.contaminated_versions),
      ...paidAcquisition(attributedRows, config),
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

// Serialized into Runtime.evaluate: no collector-side dependencies. innerText
// alone includes GA's collapsed demo banner, so require rendered text geometry.
function gameAnalyticsPageSnapshot() {
  const demo = /\bdemo\s+(?:mode|data)\b/i;
  const visible = (element) => {
    let rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return false;
      rect = node.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
        left = Math.max(left, rect.left); right = Math.min(right, rect.right);
      }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
        top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
      }
      if (right <= left || bottom <= top) return false;
    }
    return true;
  };
  // Prefer the smallest element containing the phrase (also handles nested
  // spans), not body-sized ancestors containing unrelated dashboard text.
  const candidates = [...(document.body?.querySelectorAll('*') ?? [])].filter((element) =>
    demo.test(element.textContent ?? '') && ![...element.children].some((child) => demo.test(child.textContent ?? '')));
  return { url: location.href, readyState: document.readyState,
    text: document.body?.innerText ?? '', visibleDemo: candidates.some(visible) };
}

async function browserSnapshots() {
  const targets = await (await fetch(CDP_LIST, { signal: AbortSignal.timeout(5_000) })).json();
  const gaTarget = targets.find((target) => target.type === 'page' && target.url.startsWith(`${GA_ORIGIN}/game/`));
  if (!gaTarget) throw new Error('gameanalytics_browser_target_missing');
  const originalGaUrl = gaTarget.url;
  const client = cdpClient(gaTarget.webSocketDebuggerUrl);
  try {
    for (const [game, config] of Object.entries(APPS)) {
      const unavailable = (reason) => ({
        provider: 'GameAnalytics', source: 'authenticated_browser', project_id: config.gameanalytics_project_id,
        dau: null, new_users: null, sessions: null, playtime: null, active_now: null,
        status: 'unavailable', error_category: reason,
      });
      result.games[game].gameanalytics = unavailable('page_not_ready');
      const navigation = await client.call('Page.navigate', { url: config.gameanalytics_url });
      if (navigation.error || navigation.result?.errorText || !navigation.result?.loaderId) {
        result.games[game].gameanalytics = unavailable('navigation_failed');
        continue;
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await delay(attempt === 0 ? 7_000 : 4_000);
        const frameResponse = await client.call('Page.getFrameTree');
        const frame = frameResponse.result?.frameTree?.frame;
        const response = await client.call('Runtime.evaluate', {
          expression: `(${gameAnalyticsPageSnapshot.toString()})()`,
          returnByValue: true,
        });
        const page = response.result?.result?.value;
        const ownPage = (url) => {
          try {
            const actual = new URL(url);
            const expected = new URL(config.gameanalytics_url);
            return actual.origin === expected.origin && actual.pathname === expected.pathname;
          } catch { return false; }
        };
        // Bind body text to the document produced by this navigation, not a
        // previous project still visible in the operator's authenticated tab.
        if (frame?.loaderId !== navigation.result.loaderId || !ownPage(frame?.url)
          || !ownPage(page?.url) || page?.readyState !== 'complete' || typeof page?.text !== 'string'
          || typeof page?.visibleDemo !== 'boolean') {
          result.games[game].gameanalytics = unavailable('page_identity_unverified');
          continue;
        }
        const text = page.text;
        if (page.visibleDemo) {
          result.games[game].gameanalytics = unavailable('demo_data');
          break;
        }
        const parsedDau = overviewMetric(text, 'DAU');
        const dau = Number.isSafeInteger(parsedDau) && parsedDau >= 0 ? parsedDau : null;
        const activeNow = [...text.matchAll(/Active users\n(\d+)/g)].at(-1)?.[1];
        result.games[game].gameanalytics = {
          provider: 'GameAnalytics', source: 'authenticated_browser', project_id: config.gameanalytics_project_id,
          dau, new_users: overviewMetric(text, 'New Users'), sessions: overviewMetric(text, 'Sessions'),
          playtime: overviewMetric(text, 'Playtime'), active_now: activeNow === undefined ? null : Number(activeNow),
          status: dau === null ? 'pending_processing' : 'healthy',
        };
        if (dau !== null) break;
      }
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
