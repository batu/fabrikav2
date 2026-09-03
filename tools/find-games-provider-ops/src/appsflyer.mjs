import fs from 'node:fs';
import path from 'node:path';

const REPORT_NAME = 'partners_by_date_report_v5';
const METRIC_COLUMNS = [
  { key: 'clicks', headers: ['clicks'] },
  { key: 'impressions', headers: ['impressions'] },
  { key: 'installs', headers: ['installs'] },
  { key: 'sessions', headers: ['sessions'] },
  { key: 'cost', headers: ['cost'] },
  { key: 'total_cost', headers: ['total cost'] },
  { key: 'revenue', headers: ['revenue'] },
  { key: 'total_revenue', headers: ['total revenue'] },
];

export class AppsFlyerReportingError extends Error {
  constructor(status, category) {
    super(`AppsFlyer reporting ${category}`);
    this.name = 'AppsFlyerReportingError';
    this.status = status;
    this.category = category;
  }
}

export function validateDateWindow(from, to) {
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) {
    throw new Error('AppsFlyer window must contain valid ordered YYYY-MM-DD dates');
  }
  return { from, to };
}

export function readProtectedToken(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('unsafe');
    const token = fs.readFileSync(file, 'utf8').trim();
    if (token === '') throw new Error('empty');
    return token;
  } catch {
    throw new Error('AppsFlyer protected token unavailable');
  }
}

export async function fetchAppsFlyerCsv({ appId, token, from, to, fetchImpl = fetch, cacheDir }) {
  validateDateWindow(from, to);
  const cacheFile = cacheDir ? resolveCacheFile(cacheDir, appId, from, to) : null;
  if (cacheFile && fs.existsSync(cacheFile)) return readSafeCacheFile(cacheFile);
  const url = new URL(`https://hq1.appsflyer.com/api/agg-data/export/app/${encodeURIComponent(appId)}/partners_by_date_report/v5`);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppsFlyerReportingError('unavailable', 'network_error');
  }
  if (!response.ok) {
    const limitReached = response.status === 403
      && (await response.text()).trim() === 'Limit reached for partners-daily-report';
    if (limitReached) throw new AppsFlyerReportingError('degraded', 'rate_limited');
    const failure = failureForStatus(response.status);
    throw new AppsFlyerReportingError(failure.status, failure.category);
  }
  const csv = await response.text();
  if (cacheFile) writeSafeCacheFile(cacheFile, csv);
  return csv;
}

export async function fetchAppsFlyerAggregateSummary({ games, token, from, to, observedAt = new Date().toISOString(), fetchImpl = fetch, cacheDir }) {
  validateDateWindow(from, to);
  const results = await Promise.allSettled(games.map(async (game) => [
    game.appsflyer_app_id,
    await fetchAppsFlyerCsv({ appId: game.appsflyer_app_id, token, from, to, fetchImpl, cacheDir }),
  ]));
  const failure = results.find(({ status }) => status === 'rejected');
  if (failure) throw failure.reason instanceof AppsFlyerReportingError ? failure.reason : new AppsFlyerReportingError('unavailable', 'probe_failed');
  return buildAppsFlyerAggregateSummary({
    games,
    csvByAppId: new Map(results.map(({ value }) => value)),
    from,
    to,
    observedAt,
  });
}

export function buildAppsFlyerAggregateSummary({ games, csvByAppId, from, to, observedAt }) {
  validateDateWindow(from, to);
  const rows = [];
  for (const game of games) {
    const csv = csvByAppId.get(game.appsflyer_app_id);
    if (typeof csv !== 'string') throw new Error('AppsFlyer CSV missing for configured game');
    rows.push(...aggregateGameRows(game, csv));
  }
  rows.sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
  return {
    schema_version: 1,
    source: { kind: 'live_api', provenance: 'appsflyer', report: REPORT_NAME },
    observed_at: observedAt,
    requested_window: { from, to },
    rows,
  };
}

function aggregateGameRows(game, csv) {
  const table = parseCsv(csv);
  if (table.length === 0) return [];
  const headers = table[0].map((header) => header.trim());
  const normalizedHeaders = headers.map(normalizeHeader);
  const sourceIndex = normalizedHeaders.findIndex((header) => header === 'media source pid' || header === 'media source');
  const campaignIndex = normalizedHeaders.findIndex((header) => header === 'campaign c' || header === 'campaign');
  if (sourceIndex < 0 || campaignIndex < 0) throw new Error('AppsFlyer CSV lacks media source or campaign columns');
  const metrics = METRIC_COLUMNS.flatMap((metric) => {
    const index = normalizedHeaders.findIndex((header) => metric.headers.includes(header));
    return index < 0 ? [] : [{ key: metric.key, index }];
  });
  const groups = new Map();
  for (const values of table.slice(1)) {
    if (values.every((value) => value.trim() === '')) continue;
    const rawMediaSource = values[sourceIndex]?.trim() || 'organic';
    const mediaSource = rawMediaSource.toLowerCase() === 'organic' ? 'organic' : rawMediaSource;
    const rawCampaign = values[campaignIndex]?.trim();
    const campaign = !rawCampaign || rawCampaign.toLowerCase() === 'none' ? null : rawCampaign;
    const key = JSON.stringify([mediaSource, campaign]);
    let row = groups.get(key);
    if (!row) {
      row = {
        game: game.id,
        appsflyer_app_id: game.appsflyer_app_id,
        media_source: mediaSource,
        campaign,
        attribution: mediaSource.toLowerCase() === 'organic' ? 'organic' : 'non_organic',
        metrics: Object.fromEntries(metrics.map(({ key: metricKey }) => [metricKey, null])),
      };
      groups.set(key, row);
    }
    for (const metric of metrics) {
      const value = numericValue(values[metric.index]);
      if (value !== null) row.metrics[metric.key] = (row.metrics[metric.key] ?? 0) + value;
    }
  }
  return [...groups.values()];
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted && character === '"' && csv[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function numericValue(value) {
  const normalized = (value ?? '').trim().replaceAll(',', '');
  if (normalized === '') return 0;
  if (normalized.toLowerCase() === 'n/a') return null;
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new Error('AppsFlyer CSV contains an invalid numeric metric');
  return number;
}

function normalizeHeader(header) {
  return header.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim();
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function failureForStatus(status) {
  if (status === 401 || status === 403) return { status: 'auth_required', category: 'invalid_credential' };
  if (status === 429) return { status: 'degraded', category: 'rate_limited' };
  return { status: 'unavailable', category: 'provider_unavailable' };
}

function resolveCacheFile(cacheDir, appId, from, to) {
  if (!/^id\d+$/.test(appId)) throw new Error('invalid AppsFlyer app id');
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(cacheDir, 0o700);
  return path.join(cacheDir, `${appId}_${from}_${to}.csv`);
}

function readSafeCacheFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('AppsFlyer cache unavailable');
  }
  return fs.readFileSync(file, 'utf8');
}

function writeSafeCacheFile(file, csv) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, csv, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function rowKey(row) {
  return `${row.game}\u0000${row.media_source}\u0000${row.campaign ?? ''}`;
}
