import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildAppsFlyerAggregateSummary,
  fetchAppsFlyerAggregateSummary,
  readProtectedToken,
  validateDateWindow,
} from '../src/appsflyer.mjs';

const games = [
  { id: 'find_the_dog', appsflyer_app_id: 'id6772100729' },
  { id: 'find_the_bird', appsflyer_app_id: 'id6796698146' },
];
const contaminatedBird = {
  ...games[1],
  appsflyer_contamination: {
    foreign_game: 'find_the_dog',
    foreign_app_versions: ['1.0.4'],
    hardened_release_at: '2026-09-03T05:03:10Z',
  },
};

const dogCsv = `Date,Media Source (pid),Campaign (c),Impressions,Clicks,Installs,Sessions,Total Cost,Total Revenue\n2026-09-01,organic,,0,0,3,5,,\n2026-09-01,meta,Dog Launch,100,10,2,4,1.25,3.50\n2026-09-02,meta,Dog Launch,50,5,1,2,0.75,1.50\n`;
const birdCsv = `Date,Media Source (pid),Campaign (c),Impressions,Clicks,Installs,Sessions,Total Cost,Total Revenue\n2026-09-01,organic,,0,0,7,9,,\n2026-09-01,googleadwords_int,Bird Search,200,20,4,6,2.50,4.25\n`;

test('aggregate summary keeps games isolated, adds matching rows, and classifies organic', () => {
  const result = buildAppsFlyerAggregateSummary({
    games,
    csvByAppId: new Map([
      ['id6772100729', dogCsv],
      ['id6796698146', birdCsv],
    ]),
    from: '2026-09-01',
    to: '2026-09-02',
    observedAt: '2026-09-03T10:00:00.000Z',
  });

  assert.equal(result.schema_version, 1);
  assert.deepEqual(result.source, {
    kind: 'live_api',
    provenance: 'appsflyer',
    report: 'partners_by_date_report_v5',
  });
  assert.equal(result.observed_at, '2026-09-03T10:00:00.000Z');
  assert.deepEqual(result.requested_window, { from: '2026-09-01', to: '2026-09-02' });
  assert.deepEqual(result.rows, [
    {
      game: 'find_the_bird', appsflyer_app_id: 'id6796698146', media_source: 'googleadwords_int', campaign: 'Bird Search', attribution: 'non_organic',
      metrics: { clicks: 20, impressions: 200, installs: 4, sessions: 6, total_cost: 2.5, total_revenue: 4.25 },
    },
    {
      game: 'find_the_bird', appsflyer_app_id: 'id6796698146', media_source: 'organic', campaign: null, attribution: 'organic',
      metrics: { clicks: 0, impressions: 0, installs: 7, sessions: 9, total_cost: 0, total_revenue: 0 },
    },
    {
      game: 'find_the_dog', appsflyer_app_id: 'id6772100729', media_source: 'meta', campaign: 'Dog Launch', attribution: 'non_organic',
      metrics: { clicks: 15, impressions: 150, installs: 3, sessions: 6, total_cost: 2, total_revenue: 5 },
    },
    {
      game: 'find_the_dog', appsflyer_app_id: 'id6772100729', media_source: 'organic', campaign: null, attribution: 'organic',
      metrics: { clicks: 0, impressions: 0, installs: 3, sessions: 5, total_cost: 0, total_revenue: 0 },
    },
  ]);
  assert.equal('active_users' in result.rows[0].metrics, false);
});

test('aggregate summary emits only metric fields present in each CSV', () => {
  const result = buildAppsFlyerAggregateSummary({
    games: [games[0]],
    csvByAppId: new Map([['id6772100729', 'Media Source (pid),Campaign (c),Installs,Revenue\norganic,,2,\n']]),
    from: '2026-09-01', to: '2026-09-01', observedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.deepEqual(result.rows[0].metrics, { installs: 2, revenue: 0 });
});

test('aggregate summary represents provider N/A metrics as null and normalizes organic None campaign', () => {
  const result = buildAppsFlyerAggregateSummary({
    games: [games[0]],
    csvByAppId: new Map([['id6772100729', 'Media Source (pid),Campaign (c),Impressions,Clicks,Installs,Total Cost\nOrganic,None,N/A,N/A,1,N/A\n']]),
    from: '2026-09-01', to: '2026-09-01', observedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.deepEqual(result.rows[0], {
    game: 'find_the_dog', appsflyer_app_id: 'id6772100729', media_source: 'organic', campaign: null, attribution: 'organic',
    metrics: { clicks: null, impressions: null, installs: 1, total_cost: null },
    completeness: { clicks: 'incomplete', impressions: 'incomplete', installs: 'complete', total_cost: 'incomplete' },
  });
});

test('aggregate summary keeps a grouped metric null when any contributing value is N/A', () => {
  const result = buildAppsFlyerAggregateSummary({
    games: [games[0]],
    csvByAppId: new Map([['id6772100729', 'Media Source (pid),Campaign (c),Installs,Total Cost\nmeta,Launch,1,N/A\nmeta,Launch,2,3.50\n']]),
    from: '2026-09-01', to: '2026-09-01', observedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.deepEqual(result.rows[0].metrics, { installs: 3, total_cost: null });
  assert.deepEqual(result.rows[0].completeness, { installs: 'complete', total_cost: 'incomplete' });
});

test('FTB organic installs are split by raw app version and contaminated rows are not published as clean', () => {
  const aggregate = 'Media Source (pid),Campaign (c),Installs,Sessions\norganic,,41,50\n';
  const rawRows = [
    ...Array.from({ length: 38 }, (_, index) => `2026-09-02 10:${String(index).padStart(2, '0')}:00,1.0.4,contaminated-${index}`),
    '2026-09-03 06:00:00,1.2,bird-0',
    '2026-09-03 06:01:00,1.0,bird-1',
    '2026-09-03 06:02:00,1.0,bird-2',
  ];
  const raw = `Install Time,App Version,AppsFlyer ID\n${rawRows.join('\n')}\n`;
  const result = buildAppsFlyerAggregateSummary({
    games: [contaminatedBird],
    csvByAppId: new Map([['id6796698146', aggregate]]),
    rawOrganicCsvByAppId: new Map([['id6796698146', raw]]),
    from: '2026-09-02', to: '2026-09-03', observedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.rows[0].metrics, { installs: null, sessions: null });
  assert.deepEqual(result.rows[0].completeness, { installs: 'incomplete', sessions: 'incomplete' });
  assert.deepEqual(result.rows[0].contamination, {
    status: 'confirmed', contaminated_installs: 38, plausible_ftb_installs: 3, clean_installs: null, raw_installs: 41,
    aggregate_installs: 41, segmentation_complete: true, foreign_game: 'find_the_dog',
    foreign_app_versions: ['1.0.4'], hardened_release_at: '2026-09-03T05:03:10Z',
  });
});

test('FTB non-1.0.4 versions remain plausible rather than proving clean traffic', () => {
  const result = buildAppsFlyerAggregateSummary({
    games: [contaminatedBird],
    csvByAppId: new Map([['id6796698146', 'Media Source (pid),Campaign (c),Installs\norganic,,3\n']]),
    rawOrganicCsvByAppId: new Map([['id6796698146', 'Install Time,App Version\n2026-09-03 06:00:00,1.2\n2026-09-03 06:01:00,1.0\n2026-09-03 06:02:00,1.0\n']]),
    from: '2026-09-03', to: '2026-09-03', observedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.equal(result.status, 'degraded');
  assert.equal(result.rows[0].contamination.status, 'plausible');
  assert.equal(result.rows[0].contamination.plausible_ftb_installs, 3);
  assert.equal(result.rows[0].metrics.installs, null);
});

test('FTB raw evidence without an aggregate organic row remains explicitly degraded', () => {
  const result = buildAppsFlyerAggregateSummary({
    games: [contaminatedBird],
    csvByAppId: new Map([['id6796698146', 'Media Source (pid),Campaign (c),Installs\nmeta,Launch,2\n']]),
    rawOrganicCsvByAppId: new Map([['id6796698146', 'Install Time,App Version\n2026-09-03 06:00:00,1.0.0\n']]),
    from: '2026-09-03', to: '2026-09-03', observedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.equal(result.status, 'degraded');
  const organic = result.rows.find(({ attribution }) => attribution === 'organic');
  assert.equal(organic.contamination.status, 'unsegmented');
  assert.equal(organic.contamination.raw_installs, 1);
  assert.equal(organic.contamination.aggregate_installs, null);
});

test('FTB cross-cutover aggregate is non-green when raw app-version evidence is unavailable', () => {
  const result = buildAppsFlyerAggregateSummary({
    games: [contaminatedBird],
    csvByAppId: new Map([['id6796698146', 'Media Source (pid),Campaign (c),Installs,Sessions\norganic,,41,50\n']]),
    from: '2026-09-02', to: '2026-09-03', observedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.rows[0].metrics, { installs: null, sessions: null });
  assert.equal(result.rows[0].contamination.status, 'unsegmented');
  assert.equal(result.rows[0].contamination.segmentation_complete, false);
});

test('date windows require real ordered YYYY-MM-DD calendar dates', () => {
  assert.deepEqual(validateDateWindow('2026-09-01', '2026-09-02'), { from: '2026-09-01', to: '2026-09-02' });
  for (const [from, to] of [['09/01/2026', '2026-09-02'], ['2026-02-30', '2026-03-01'], ['2026-09-03', '2026-09-02']]) {
    assert.throws(() => validateDateWindow(from, to), /valid ordered YYYY-MM-DD/);
  }
});

test('aggregate summary rejects a non-canonical observed_at timestamp', () => {
  assert.throws(() => buildAppsFlyerAggregateSummary({
    games: [games[0]],
    csvByAppId: new Map([['id6772100729', dogCsv]]),
    from: '2026-09-01', to: '2026-09-02', observedAt: '2026-09-03T10:00:00Z',
  }), /canonical ISO-8601/);
});

test('protected token reader rejects missing, symlinked, and group/world-readable files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsflyer-token-'));
  const safe = path.join(dir, 'safe.token');
  const unsafe = path.join(dir, 'unsafe.token');
  const link = path.join(dir, 'linked.token');
  fs.writeFileSync(safe, 'secret-token\n', { mode: 0o600 });
  fs.writeFileSync(unsafe, 'unsafe-secret\n', { mode: 0o644 });
  fs.symlinkSync(safe, link);
  try {
    assert.equal(readProtectedToken(safe), 'secret-token');
    assert.throws(() => readProtectedToken(path.join(dir, 'missing')), /protected token unavailable/);
    assert.throws(() => readProtectedToken(unsafe), /protected token unavailable/);
    assert.throws(() => readProtectedToken(link), /protected token unavailable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('live aggregate fetch uses bearer header for both exact app IDs and leaks no token', async () => {
  const requests = [];
  const result = await fetchAppsFlyerAggregateSummary({
    games,
    token: 'reporting-super-secret',
    from: '2026-09-01', to: '2026-09-02',
    observedAt: '2026-09-03T10:00:00.000Z',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, text: async () => url.includes('id6772100729') ? dogCsv : birdCsv };
    },
  });
  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
    '/api/agg-data/export/app/id6772100729/partners_by_date_report/v5',
    '/api/agg-data/export/app/id6796698146/partners_by_date_report/v5',
  ]);
  assert.ok(requests.every(({ url }) => !url.includes('reporting-super-secret')));
  assert.ok(requests.every(({ options }) => options.headers.Authorization === 'Bearer reporting-super-secret'));
  assert.doesNotMatch(JSON.stringify(result), /reporting-super-secret/);
});

test('live FTB aggregate fetches raw organic installs from the raw-data API for app-version evidence', async () => {
  const requests = [];
  const rawRows = [
    ...Array.from({ length: 38 }, () => '2026-09-02 10:00:00,1.0.4'),
    ...Array.from({ length: 3 }, () => '2026-09-03 06:00:00,1.0.0'),
  ];
  const result = await fetchAppsFlyerAggregateSummary({
    games: [contaminatedBird], token: 'SECRET', from: '2026-09-02', to: '2026-09-03',
    observedAt: '2026-09-03T10:00:00.000Z',
    fetchImpl: async (url) => {
      requests.push(new URL(url).pathname);
      return {
        ok: true,
        status: 200,
        text: async () => url.includes('organic_installs_report')
          ? `Install Time,App Version\n${rawRows.join('\n')}\n`
          : 'Media Source (pid),Campaign (c),Installs,Sessions\norganic,,41,50\n',
      };
    },
  });
  assert.deepEqual(requests, [
    '/api/agg-data/export/app/id6796698146/partners_by_date_report/v5',
    '/api/raw-data/export/app/id6796698146/organic_installs_report/v5',
  ]);
  assert.equal(result.rows[0].contamination.contaminated_installs, 38);
  assert.equal(result.rows[0].contamination.plausible_ftb_installs, 3);
  assert.equal(result.rows[0].contamination.clean_installs, null);
  assert.equal(result.rows[0].metrics.installs, null);
});

test('raw segmentation failures retain a redacted category in contamination evidence', async () => {
  const result = await fetchAppsFlyerAggregateSummary({
    games: [contaminatedBird], token: 'SECRET', from: '2026-09-02', to: '2026-09-03',
    observedAt: '2026-09-03T10:00:00.000Z',
    fetchImpl: async (url) => url.includes('organic_installs_report')
      ? { ok: false, status: 429, text: async () => 'DO-NOT-LEAK' }
      : { ok: true, status: 200, text: async () => 'Media Source (pid),Campaign (c),Installs\norganic,,41\n' },
  });
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.rows[0].contamination.error, {
    category: 'rate_limited', source_kind: 'live_api', report: 'organic_installs_report_v5',
  });
  assert.doesNotMatch(JSON.stringify(result), /DO-NOT-LEAK|SECRET/);
});

test('raw cache validation failures retain local-cache provenance', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsflyer-invalid-raw-cache-'));
  fs.writeFileSync(path.join(cacheDir, 'id6796698146_organic_installs_report_v5_2026-09-02_2026-09-03.json'), JSON.stringify({
    schema_version: 0,
    app_id: 'id6796698146',
    report: 'organic_installs_report_v5',
    report_version: 'v5',
    requested_window: { from: '2026-09-02', to: '2026-09-03' },
    acquired_at: '2026-09-03T09:00:00.000Z',
    csv: 'must-not-be-used',
  }), { mode: 0o600 });
  try {
    const result = await fetchAppsFlyerAggregateSummary({
      games: [contaminatedBird], token: 'SECRET', from: '2026-09-02', to: '2026-09-03', cacheDir,
      observedAt: '2026-09-03T10:00:00.000Z', now: new Date('2026-09-03T10:00:00.000Z'),
      fetchImpl: async () => ({
        ok: true, status: 200, text: async () => 'Media Source (pid),Campaign (c),Installs\norganic,,41\n',
      }),
    });
    assert.equal(result.rows[0].contamination.error.source_kind, 'local_cache');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('aggregate cache records provenance, acquisition time, permissions, report identity, and bounded freshness', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsflyer-cache-'));
  let requests = 0;
  try {
    const options = {
      games: [games[0]], token: 'SECRET', from: '2026-09-01', to: '2026-09-02', cacheDir,
      observedAt: '2026-09-03T10:00:00.000Z', now: new Date('2026-09-03T10:00:00.000Z'),
      fetchImpl: async () => {
        requests += 1;
        return { ok: true, status: 200, text: async () => dogCsv };
      },
    };
    const first = await fetchAppsFlyerAggregateSummary(options);
    const second = await fetchAppsFlyerAggregateSummary({
      ...options,
      observedAt: '2026-09-03T10:05:00.000Z', now: new Date('2026-09-03T10:05:00.000Z'),
      fetchImpl: async () => { throw new Error('must use cache'); },
    });
    assert.equal(requests, 1);
    assert.equal(first.source.kind, 'live_api');
    assert.equal(second.source.kind, 'local_cache');
    assert.equal(second.source.report, 'partners_by_date_report_v5');
    assert.equal(second.observed_at, '2026-09-03T10:00:00.000Z');
    assert.equal(second.status, 'degraded');
    assert.deepEqual(second.freshness, {
      status: 'fresh', acquired_at: '2026-09-03T10:00:00.000Z', max_age_seconds: 86400,
    });
    const cacheFiles = fs.readdirSync(cacheDir);
    assert.ok(cacheFiles.some((file) => file.includes('partners_by_date_report_v5')));
    assert.ok(cacheFiles.every((file) => (fs.statSync(path.join(cacheDir, file)).mode & 0o077) === 0));
    assert.ok(cacheFiles.every((file) => !file.includes('SECRET')));
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('aggregate records exact per-input provenance when cached and live acquisitions are mixed', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsflyer-mixed-cache-'));
  const acquiredAt = '2026-09-03T10:00:00.000Z';
  fs.writeFileSync(path.join(cacheDir, 'id6772100729_partners_by_date_report_v5_2026-09-01_2026-09-02.json'), JSON.stringify({
    schema_version: 1,
    app_id: 'id6772100729',
    report: 'partners_by_date_report_v5',
    report_version: 'v5',
    requested_window: { from: '2026-09-01', to: '2026-09-02' },
    acquired_at: acquiredAt,
    csv: dogCsv,
  }), { mode: 0o600 });
  try {
    const result = await fetchAppsFlyerAggregateSummary({
      games, token: 'SECRET', from: '2026-09-01', to: '2026-09-02', cacheDir,
      observedAt: '2026-09-03T10:05:00.000Z', now: new Date('2026-09-03T10:05:00.000Z'),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => birdCsv }),
    });
    assert.equal(result.source.kind, 'local_cache');
    assert.deepEqual(result.source.inputs, [
      {
        game: 'find_the_dog', app_id: 'id6772100729', report: 'partners_by_date_report_v5',
        kind: 'local_cache', acquired_at: acquiredAt,
      },
      {
        game: 'find_the_bird', app_id: 'id6796698146', report: 'partners_by_date_report_v5',
        kind: 'live_api', acquired_at: '2026-09-03T10:05:00.000Z',
      },
    ]);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('aggregate refreshes an expired cache entry instead of reusing stale evidence', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsflyer-stale-cache-'));
  let requests = 0;
  try {
    const options = {
      games: [games[0]], token: 'SECRET', from: '2026-09-01', to: '2026-09-02', cacheDir,
      observedAt: '2026-09-03T10:00:00.000Z', now: new Date('2026-09-03T10:00:00.000Z'),
      fetchImpl: async () => { requests += 1; return { ok: true, status: 200, text: async () => dogCsv }; },
    };
    await fetchAppsFlyerAggregateSummary(options);
    const refreshed = await fetchAppsFlyerAggregateSummary({
      ...options,
      observedAt: '2026-09-04T10:00:01.000Z', now: new Date('2026-09-04T10:00:01.000Z'),
    });
    assert.equal(requests, 2);
    assert.equal(refreshed.source.kind, 'live_api');
    assert.equal(refreshed.observed_at, '2026-09-04T10:00:01.000Z');
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('cache acquisition time uses wall clock rather than caller observed_at', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsflyer-cache-clock-'));
  const before = Date.now();
  try {
    await fetchAppsFlyerAggregateSummary({
      games: [games[0]], token: 'SECRET', from: '2026-09-01', to: '2026-09-02', cacheDir,
      observedAt: '2000-01-01T00:00:00.000Z',
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => dogCsv }),
    });
    const entry = JSON.parse(fs.readFileSync(path.join(cacheDir, fs.readdirSync(cacheDir)[0]), 'utf8'));
    assert.ok(new Date(entry.acquired_at).valueOf() >= before);
    assert.ok(new Date(entry.acquired_at).valueOf() <= Date.now());
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('live aggregate fetch returns redacted stable auth, rate, server, and network failures', async () => {
  const cases = [
    [{ ok: false, status: 401, text: async () => 'TOKEN-LEAK-401' }, 'auth_required'],
    [{ ok: false, status: 403, text: async () => 'TOKEN-LEAK-403' }, 'auth_required'],
    [{ ok: false, status: 403, text: async () => 'Limit reached for partners-daily-report' }, 'degraded'],
    [{ ok: false, status: 429, text: async () => 'TOKEN-LEAK-429' }, 'degraded'],
    [{ ok: false, status: 503, text: async () => 'TOKEN-LEAK-503' }, 'unavailable'],
  ];
  for (const [response, category] of cases) {
    await assert.rejects(
      fetchAppsFlyerAggregateSummary({ games, token: 'SECRET', from: '2026-09-01', to: '2026-09-02', fetchImpl: async () => response }),
      (error) => error.status === category && !JSON.stringify(error).includes('TOKEN-LEAK'),
    );
  }
  await assert.rejects(
    fetchAppsFlyerAggregateSummary({ games, token: 'SECRET', from: '2026-09-01', to: '2026-09-02', fetchImpl: async () => { throw Object.assign(new Error('URL?token=SECRET'), { code: 'ENOTFOUND' }); } }),
    (error) => error.status === 'unavailable' && error.category === 'network_error' && !error.message.includes('SECRET'),
  );
});
