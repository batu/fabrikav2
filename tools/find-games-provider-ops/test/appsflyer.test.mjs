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
  });
});

test('date windows require real ordered YYYY-MM-DD calendar dates', () => {
  assert.deepEqual(validateDateWindow('2026-09-01', '2026-09-02'), { from: '2026-09-01', to: '2026-09-02' });
  for (const [from, to] of [['09/01/2026', '2026-09-02'], ['2026-02-30', '2026-03-01'], ['2026-09-03', '2026-09-02']]) {
    assert.throws(() => validateDateWindow(from, to), /valid ordered YYYY-MM-DD/);
  }
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

test('aggregate fetch caches each app/window once to avoid quota-burning retries', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsflyer-cache-'));
  let requests = 0;
  try {
    const options = {
      games: [games[0]], token: 'SECRET', from: '2026-09-01', to: '2026-09-02', cacheDir,
      observedAt: '2026-09-03T10:00:00.000Z',
      fetchImpl: async () => {
        requests += 1;
        return { ok: true, status: 200, text: async () => dogCsv };
      },
    };
    const first = await fetchAppsFlyerAggregateSummary(options);
    const second = await fetchAppsFlyerAggregateSummary({
      ...options,
      fetchImpl: async () => { throw new Error('must use cache'); },
    });
    assert.equal(requests, 1);
    assert.deepEqual(second, first);
    assert.ok(fs.readdirSync(cacheDir).every((file) => !file.includes('SECRET')));
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
