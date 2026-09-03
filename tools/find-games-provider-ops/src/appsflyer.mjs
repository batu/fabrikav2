import fs from 'node:fs';
import path from 'node:path';

const CACHE_MAX_AGE_SECONDS = 86_400;
const REPORTS = {
  partners: {
    name: 'partners_by_date_report_v5',
    endpoint: 'partners_by_date_report',
    version: 'v5',
    apiPath: 'agg-data',
  },
  organicInstalls: {
    name: 'organic_installs_report_v5',
    endpoint: 'organic_installs_report',
    version: 'v5',
    apiPath: 'raw-data',
  },
};
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

export async function fetchAppsFlyerCsv({
  appId,
  token,
  from,
  to,
  fetchImpl = fetch,
  cacheDir,
  bypassCache = false,
  report = REPORTS.partners,
  now = new Date(),
}) {
  validateDateWindow(from, to);
  const cacheFile = cacheDir ? resolveCacheFile(cacheDir, appId, report, from, to) : null;
  if (!bypassCache && cacheFile) {
    try {
      return readSafeCacheEntry(cacheFile, { appId, report, from, to, now });
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.message !== 'AppsFlyer cache expired') throw error;
      if (error?.message === 'AppsFlyer cache expired') fs.rmSync(cacheFile);
    }
  }
  const url = new URL(`https://hq1.appsflyer.com/api/${report.apiPath}/export/app/${encodeURIComponent(appId)}/${report.endpoint}/${report.version}`);
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
  const acquiredAt = now.toISOString();
  if (cacheFile) writeSafeCacheEntry(cacheFile, {
    schema_version: 1,
    app_id: appId,
    report: report.name,
    report_version: report.version,
    requested_window: { from, to },
    acquired_at: acquiredAt,
    csv,
  });
  return { csv, source: 'live_api', acquiredAt, report: report.name };
}

export async function fetchAppsFlyerAggregateSummary({
  games,
  token,
  from,
  to,
  observedAt = new Date().toISOString(),
  fetchImpl = fetch,
  cacheDir,
  now = new Date(),
}) {
  validateDateWindow(from, to);
  const results = await Promise.allSettled(games.map(async (game) => {
    const aggregate = await fetchAppsFlyerCsv({
      appId: game.appsflyer_app_id, token, from, to, fetchImpl, cacheDir, now,
    });
    let rawOrganic;
    let rawOrganicError;
    if (game.appsflyer_contamination) {
      try {
        rawOrganic = await fetchAppsFlyerCsv({
          appId: game.appsflyer_app_id,
          token,
          from,
          to,
          fetchImpl,
          cacheDir,
          now,
          report: REPORTS.organicInstalls,
        });
      } catch (error) {
        rawOrganic = undefined;
        rawOrganicError = {
          category: error instanceof AppsFlyerReportingError ? error.category : 'raw_report_unavailable',
          source_kind: /^AppsFlyer cache /.test(error?.message ?? '') ? 'local_cache' : 'live_api',
          report: REPORTS.organicInstalls.name,
        };
      }
    }
    return { game, aggregate, rawOrganic, rawOrganicError };
  }));
  const failure = results.find(({ status }) => status === 'rejected');
  if (failure) {
    if (failure.reason instanceof AppsFlyerReportingError || /^AppsFlyer cache /.test(failure.reason?.message ?? '')) throw failure.reason;
    throw new AppsFlyerReportingError('unavailable', 'probe_failed');
  }
  const values = results.map(({ value }) => value);
  const acquisitions = values.flatMap(({ aggregate, rawOrganic }) => [aggregate, rawOrganic].filter(Boolean));
  const sourceInputs = values.flatMap(({ game, aggregate, rawOrganic }) => [
    acquisitionSource(game, aggregate),
    ...(rawOrganic ? [acquisitionSource(game, rawOrganic)] : []),
  ]);
  const cached = acquisitions.some(({ source }) => source === 'local_cache');
  const acquiredAt = acquisitions.map(({ acquiredAt: value }) => value).sort()[0] ?? observedAt;
  return buildAppsFlyerAggregateSummary({
    games,
    csvByAppId: new Map(values.map(({ game, aggregate }) => [game.appsflyer_app_id, aggregate.csv])),
    rawOrganicCsvByAppId: new Map(values.flatMap(({ game, rawOrganic }) => rawOrganic ? [[game.appsflyer_app_id, rawOrganic.csv]] : [])),
    rawOrganicErrorByAppId: new Map(values.flatMap(({ game, rawOrganicError }) => rawOrganicError ? [[game.appsflyer_app_id, rawOrganicError]] : [])),
    from,
    to,
    observedAt: cached ? acquiredAt : observedAt,
    sourceKind: cached ? 'local_cache' : 'live_api',
    acquiredAt,
    sourceInputs,
  });
}

export function buildAppsFlyerAggregateSummary({
  games,
  csvByAppId,
  rawOrganicCsvByAppId = new Map(),
  rawOrganicErrorByAppId = new Map(),
  from,
  to,
  observedAt,
  sourceKind = 'live_api',
  acquiredAt = observedAt,
  sourceInputs = [],
}) {
  validateDateWindow(from, to);
  if (!isCanonicalIsoTimestamp(observedAt)) throw new Error('observed_at must be canonical ISO-8601');
  const rows = [];
  for (const game of games) {
    const csv = csvByAppId.get(game.appsflyer_app_id);
    if (typeof csv !== 'string') throw new Error('AppsFlyer CSV missing for configured game');
    const gameRows = aggregateGameRows(game, csv);
    applyContaminationEvidence(
      game,
      gameRows,
      rawOrganicCsvByAppId.get(game.appsflyer_app_id),
      rawOrganicErrorByAppId.get(game.appsflyer_app_id),
    );
    rows.push(...gameRows);
  }
  rows.sort((left, right) => rowKey(left).localeCompare(rowKey(right)));
  const degraded = sourceKind !== 'live_api' || rows.some(({ contamination }) => contamination && contamination.status !== 'clean');
  return {
    schema_version: 1,
    status: degraded ? 'degraded' : 'healthy',
    source: {
      kind: sourceKind,
      provenance: 'appsflyer',
      report: REPORTS.partners.name,
      ...(sourceInputs.length > 0 ? { inputs: sourceInputs } : {}),
    },
    observed_at: observedAt,
    ...(sourceKind === 'local_cache' ? {
      freshness: { status: 'fresh', acquired_at: acquiredAt, max_age_seconds: CACHE_MAX_AGE_SECONDS },
    } : {}),
    requested_window: { from, to },
    rows,
  };
}

function acquisitionSource(game, acquisition) {
  return {
    game: game.id,
    app_id: game.appsflyer_app_id,
    report: acquisition.report,
    kind: acquisition.source,
    acquired_at: acquisition.acquiredAt,
  };
}

function aggregateGameRows(game, csv) {
  const table = parseCsv(csv);
  if (table.length === 0) return [];
  const normalizedHeaders = table[0].map((header) => normalizeHeader(header.trim()));
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
        _unknown: new Set(),
      };
      groups.set(key, row);
    }
    for (const metric of metrics) {
      const value = numericValue(values[metric.index]);
      if (value === null) row._unknown.add(metric.key);
      else if (!row._unknown.has(metric.key)) row.metrics[metric.key] = (row.metrics[metric.key] ?? 0) + value;
    }
  }
  return [...groups.values()].map((row) => {
    for (const key of row._unknown) row.metrics[key] = null;
    if (row._unknown.size > 0) {
      row.completeness = Object.fromEntries(Object.keys(row.metrics).map((key) => [key, row._unknown.has(key) ? 'incomplete' : 'complete']));
    }
    delete row._unknown;
    return row;
  });
}

function applyContaminationEvidence(game, rows, rawCsv, rawError) {
  const evidence = game.appsflyer_contamination;
  if (!evidence) return;
  let organic = rows.find(({ attribution }) => attribution === 'organic');
  if (!organic) {
    organic = {
      game: game.id,
      appsflyer_app_id: game.appsflyer_app_id,
      media_source: 'organic',
      campaign: null,
      attribution: 'organic',
      metrics: {},
      completeness: {},
    };
    rows.push(organic);
  }
  const aggregateInstalls = organic.metrics.installs ?? null;
  const segmentation = typeof rawCsv === 'string' ? segmentRawOrganicInstalls(rawCsv, evidence) : null;
  const segmentationComplete = segmentation !== null
    && Number.isFinite(aggregateInstalls)
    && segmentation.rawInstalls === aggregateInstalls
    && segmentation.versionsComplete;
  organic.contamination = {
    status: contaminationStatus(segmentationComplete, segmentation),
    contaminated_installs: segmentationComplete ? segmentation.contaminatedInstalls : null,
    plausible_ftb_installs: segmentationComplete ? segmentation.plausibleFtbInstalls : null,
    clean_installs: null,
    raw_installs: segmentation?.rawInstalls ?? null,
    aggregate_installs: aggregateInstalls,
    segmentation_complete: segmentationComplete,
    foreign_game: evidence.foreign_game,
    foreign_app_versions: evidence.foreign_app_versions,
    hardened_release_at: evidence.hardened_release_at,
    ...(rawError ? { error: rawError } : {}),
  };
  organic.completeness = Object.fromEntries(Object.keys(organic.metrics).map((key) => [key, 'incomplete']));
  for (const key of Object.keys(organic.metrics)) organic.metrics[key] = null;
}

function contaminationStatus(segmentationComplete, segmentation) {
  if (!segmentationComplete) return 'unsegmented';
  return segmentation.contaminatedInstalls === 0 ? 'plausible' : 'confirmed';
}

function segmentRawOrganicInstalls(csv, evidence) {
  const table = parseCsv(csv);
  if (table.length === 0) return null;
  const headers = table[0].map(normalizeHeader);
  const versionIndex = headers.indexOf('app version');
  if (versionIndex < 0) return null;
  let contaminatedInstalls = 0;
  let plausibleFtbInstalls = 0;
  let versionsComplete = true;
  for (const row of table.slice(1)) {
    if (row.every((value) => value.trim() === '')) continue;
    const version = row[versionIndex]?.trim();
    if (!version) versionsComplete = false;
    else if (evidence.foreign_app_versions.includes(version)) contaminatedInstalls += 1;
    else plausibleFtbInstalls += 1;
  }
  return {
    contaminatedInstalls,
    plausibleFtbInstalls,
    rawInstalls: contaminatedInstalls + plausibleFtbInstalls,
    versionsComplete,
  };
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

function resolveCacheFile(cacheDir, appId, report, from, to) {
  if (!/^id\d+$/.test(appId)) throw new Error('invalid AppsFlyer app id');
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(cacheDir, 0o700);
  return path.join(cacheDir, `${appId}_${report.name}_${from}_${to}.json`);
}

function readSafeCacheEntry(file, expected) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('AppsFlyer cache unavailable');
  }
  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('AppsFlyer cache unavailable');
  }
  if (entry.schema_version !== 1
    || entry.app_id !== expected.appId
    || entry.report !== expected.report.name
    || entry.report_version !== expected.report.version
    || entry.requested_window?.from !== expected.from
    || entry.requested_window?.to !== expected.to
    || typeof entry.csv !== 'string'
    || !isCanonicalIsoTimestamp(entry.acquired_at)) {
    throw new Error('AppsFlyer cache metadata mismatch');
  }
  const ageSeconds = (expected.now.valueOf() - new Date(entry.acquired_at).valueOf()) / 1000;
  if (ageSeconds < 0 || ageSeconds > CACHE_MAX_AGE_SECONDS) throw new Error('AppsFlyer cache expired');
  return { csv: entry.csv, source: 'local_cache', acquiredAt: entry.acquired_at, report: entry.report };
}

function writeSafeCacheEntry(file, entry) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function isCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function rowKey(row) {
  return `${row.game}\u0000${row.media_source}\u0000${row.campaign ?? ''}`;
}
