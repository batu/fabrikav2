import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the canonical collector without running its provider/browser/write entrypoint.
const source = fs.readFileSync(new URL('./find-games-daily-scorecard.mjs', import.meta.url), 'utf8');
const boundary = source.indexOf('\ntry {\n  const afToken');
assert.ok(boundary > 0, 'collector entrypoint boundary must exist');
function collector(responses = {}) {
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-05T12:00:00Z'])); }
    static now() { return Date.parse('2026-09-05T12:00:00Z'); }
  }
  const context = vm.createContext({ Date: FrozenDate, URLSearchParams, AbortSignal, fetch: async (url) => {
    const report = new URL(url).pathname.split('/').at(-2);
    const response = responses[report] ?? 'App ID,App Version,Install Time,Media Source\n';
    if (typeof response === 'number') return { ok: false, status: response };
    return { ok: true, text: async () => response };
  } });
  vm.runInContext(source.slice(0, boundary).replace(/^import .*;\n/gm, '') + '\nglobalThis.api = { appsFlyerSnapshot, APPS };', context);
  return context.api;
}

async function browserCollector(mode = 'healthy') {
  let currentUrl = 'https://tool.gameanalytics.com/game/350269/overview/overview';
  let loader = 0;
  const client = {
    async call(method, params) {
      if (method === 'Page.navigate') {
        currentUrl = params.url;
        loader++;
        return mode === 'navigation_error' ? { result: { errorText: 'net::ERR_FAILED' } }
          : { result: { frameId: 'main', loaderId: `document-${loader}` } };
      }
      if (method === 'Page.getFrameTree') return { result: { frameTree: { frame: {
        loaderId: mode === 'stale_document' ? 'previous-document' : `document-${loader}`, url: currentUrl,
      } } } };
      assert.equal(method, 'Runtime.evaluate');
      const dau = mode === 'unavailable_metric' ? 'N/A' : mode === 'invalid_metric' ? 'Error'
        : currentUrl.includes('/350269/') ? '42' : '17';
      const element = (text, parentElement = null, overrides = {}) => ({
        textContent: text, children: [], parentElement,
        getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 24, width: 200, height: 24 }),
        style: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' },
        ...overrides,
      });
      const body = element('');
      const banner = element('', body, mode === 'hidden_demo' ? {
        style: { ...body.style, overflowY: 'hidden' },
        getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, bottom: 0, width: 200, height: 0 }),
      } : {});
      const label = element('Demo mode', banner);
      banner.children = [label];
      body.querySelectorAll = () => ['demo', 'hidden_demo'].includes(mode) ? [banner, label] : [];
      body.innerText = `${['demo', 'hidden_demo'].includes(mode) ? 'Demo mode\n' : ''}DAU\n${dau}\nSessions\n84\nPlaytime\n10m\nNew Users\n7\n`;
      const value = vm.runInNewContext(params.expression, {
        location: { href: mode === 'wrong_project' ? 'https://tool.gameanalytics.com/game/999/overview/overview' : currentUrl },
        document: { readyState: 'complete', body }, getComputedStyle: (node) => node.style,
      });
      return { result: { result: { value } } };
    },
    close() {},
  };
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal,
    setTimeout: (callback) => { callback(); return 0; }, client,
    fetch: async (url) => {
      assert.equal(url, 'http://127.0.0.1:9222/json/list');
      return { json: async () => [{ type: 'page', url: currentUrl, webSocketDebuggerUrl: 'fixture:never-connect' }] };
    },
  });
  vm.runInContext(source.slice(0, boundary).replace(/^import .*;\n/gm, '')
    + '\ncdpClient = () => client; for (const game of Object.keys(APPS)) result.games[game] = {}; globalThis.run = browserSnapshots; globalThis.result = result;', context);
  await context.run();
  return context.result.games;
}

test('browser metrics are bound to each successfully loaded production project', async () => {
  const games = await browserCollector();
  assert.equal(games.find_the_dog.gameanalytics.dau, 42);
  assert.equal(games.find_the_bird.gameanalytics.dau, 17);
  assert.equal(games.find_the_dog.gameanalytics.project_id, '350269');
  assert.equal(games.find_the_bird.gameanalytics.project_id, '351396');
  for (const game of Object.values(games)) assert.equal(game.gameanalytics.status, 'healthy');
});

test('collapsed demo banner text does not reject genuine project metrics', async () => {
  const games = await browserCollector('hidden_demo');
  assert.equal(games.find_the_dog.gameanalytics.dau, 42);
  assert.equal(games.find_the_bird.gameanalytics.dau, 17);
  for (const game of Object.values(games)) assert.equal(game.gameanalytics.status, 'healthy');
});

for (const [mode, reason] of [
  ['navigation_error', 'navigation_failed'], ['wrong_project', 'page_identity_unverified'],
  ['stale_document', 'page_identity_unverified'], ['demo', 'demo_data'],
]) test(`browser ${mode} never becomes healthy data for either game`, async () => {
  const games = await browserCollector(mode);
  for (const game of Object.values(games)) {
    assert.equal(game.gameanalytics.status, 'unavailable');
    assert.equal(game.gameanalytics.error_category, reason);
    assert.equal(game.gameanalytics.dau, null);
    assert.equal(game.gameanalytics.sessions, null);
  }
});

for (const mode of ['unavailable_metric', 'invalid_metric']) test(`browser ${mode} remains unknown`, async () => {
  const games = await browserCollector(mode);
  for (const game of Object.values(games)) {
    assert.equal(game.gameanalytics.status, 'pending_processing');
    assert.equal(game.gameanalytics.dau, null);
  }
});

const csv = (rows) => 'App ID,App Version,Install Time,Media Source,Campaign ID\n' + rows.map((r) => r.join(',')).join('\n');
const approvedCohort = {
  approved: true,
  from_utc: '2026-09-03T12:00:00Z',
  app_version: '1.2',
  campaign_ids: ['fixture-campaign'],
  qa_exclusions_complete: true,
  excluded_qa_windows: [{ from: '2026-09-04T12:00:00Z', to: '2026-09-04T13:00:00Z' }],
};

test('paid totals require own identity and exclude test, contamination, pre-cutoff, foreign campaign and QA rows', async () => {
  const row = ['id6796698146', '1.2', '2026-09-04 10:00:00', 'fixture-paid', 'fixture-campaign'];
  const change = (i, value) => row.map((v, index) => index === i ? value : v);
  const api = collector({ installs_report: csv([
    row, change(0, 'id6772100729'), change(1, '1.0.4'), change(1, '1.2.1'),
    change(2, '2026-09-03 11:59:59'), change(4, 'foreign-campaign'),
    change(2, '2026-09-04 12:30:00'), change(3, 'organic'),
  ]) });
  const config = { ...api.APPS.find_the_bird, paid_cohort: approvedCohort };
  const { acquisition: a, reports } = await api.appsFlyerSnapshot('find_the_bird', config, 'fixture');
  assert.equal(a.paid_attributed_installs, 1);
  assert.equal(a.paid_status, 'complete');
  assert.equal(reports.installs_report.row_count, 8, 'retain unfiltered diagnostic counts');
});

test('paid installs cannot occur after the snapshot observation instant', async () => {
  for (const [time, accepted] of [['2026-09-05T12:00:00Z', 1], ['2026-09-05T12:00:01Z', 0], ['2026-09-06T00:00:00Z', 0]]) {
    const api = collector({ installs_report: csv([['id6796698146', '1.2', time, 'fixture-paid', 'fixture-campaign']]) });
    const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', { ...api.APPS.find_the_bird, paid_cohort: approvedCohort }, 'fixture');
    assert.equal(a.paid_attributed_installs, accepted, time);
    assert.equal(a.paid_status, 'complete');
    assert.equal(a.paid_classification_counts.accepted, accepted);
    assert.equal(a.paid_classification_counts.excluded, 1 - accepted);
  }
});

test('install timestamps require full calendar-valid time without invented precision', async () => {
  for (const time of [
    '2026-09-04', '2026-09-04T10:00', '2026-02-30 10:00:00',
    '2026-02-29T10:00:00Z', '2026-09-31T10:00:00Z', '2026-09-04T24:00:00Z',
    '2026-09-04T10:60:00Z', '2026-09-04T10:00:60Z', '2026-09-04T10:00:00+24:00',
    ' 2026-09-04 10:00:00', '2026-09-04 10:00:00 ',
  ]) {
    const api = collector({ installs_report: csv([['id6796698146', '1.2', time, 'fixture-paid', 'fixture-campaign']]) });
    const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', { ...api.APPS.find_the_bird, paid_cohort: approvedCohort }, 'fixture');
    assert.equal(a.paid_status, 'incomplete', time);
    assert.equal(a.paid_attributed_installs, null, time);
    assert.equal(a.paid_classification_counts.unknown, 1, time);
  }
  for (const time of ['2026-09-04 10:00:00', '2026-09-04T10:00:00Z', '2026-09-04T10:00:00.123Z', '2026-09-04T13:00:00+03:00']) {
    const api = collector({ installs_report: csv([['id6796698146', '1.2', time, 'fixture-paid', 'fixture-campaign']]) });
    const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', { ...api.APPS.find_the_bird, paid_cohort: approvedCohort }, 'fixture');
    assert.equal(a.paid_status, 'complete', time);
    assert.equal(a.paid_attributed_installs, 1, time);
  }
});

test('a cohort cannot be approved without a valid UTC cutoff and complete QA exclusion policy', async () => {
  for (const overrides of [
    { from_utc: 'invalid' }, { from_utc: '2026-09-03' },
    { from_utc: '2026-09-01T00:00:00Z' }, { qa_exclusions_complete: false },
    { excluded_qa_windows: [{ from: 'invalid', to: 'invalid' }] },
    { excluded_qa_windows: [{ from: '2026-09-04T13:00:00Z', to: '2026-09-04T12:00:00Z' }] },
    { campaign_ids: [] }, { app_version: '1.2.1' },
  ]) {
    const api = collector({ installs_report: csv([['id6796698146', '1.2', '2026-09-04 10:00:00', 'fixture-paid', 'fixture-campaign']]) });
    const config = { ...api.APPS.find_the_bird, paid_cohort: { ...approvedCohort, ...overrides } };
    const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', config, 'fixture');
    assert.equal(a.paid_attributed_installs, null, JSON.stringify(overrides));
    assert.equal(a.paid_status, 'pending_cohort');
  }
});

test('empty or malformed successful responses cannot masquerade as a healthy zero', async () => {
  for (const body of ['', '<html>Unavailable</html>', '{"error":"unavailable"}', 'App ID,Install Time\nid6796698146,2026-09-04 10:00:00', 'App ID,App Version,Install Time\n"unterminated']) {
    const api = collector({ organic_installs_report: body, installs_report: body });
    const config = { ...api.APPS.find_the_bird, paid_cohort: approvedCohort };
    const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', config, 'fixture');
    assert.equal(a.clean_public_unattributed_installs, null, body);
    assert.equal(a.organic_status, 'incomplete');
    assert.equal(a.paid_attributed_installs, null);
    assert.equal(a.paid_status, 'incomplete');
  }
});

test('canonical policy has no public paid T0 and never promotes FTB 1.2.1', async () => {
  const api = collector();
  for (const [game, config] of Object.entries(api.APPS)) {
    assert.equal(config.paid_cohort, null);
    const { acquisition: a } = await api.appsFlyerSnapshot(game, config, 'fixture');
    assert.equal(a.paid_attributed_installs, null);
    assert.equal(a.paid_status, 'pending_cohort');
  }
  assert.ok(api.APPS.find_the_bird.test_versions.includes('1.2.1'));
  assert.ok(!api.APPS.find_the_bird.clean_versions.includes('1.2.1'));
});

test('paid header-only exports missing identity or cohort columns are incomplete', async () => {
  const api = collector({ installs_report: 'App Version\n' });
  const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', { ...api.APPS.find_the_bird, paid_cohort: approvedCohort }, 'fixture');
  assert.equal(a.paid_attributed_installs, null);
  assert.equal(a.paid_status, 'incomplete');
});

test('healthy organic counts retain existing version quarantine and successful empty means zero', async () => {
  const api = collector({ organic_installs_report: csv([
    ['id6796698146', '1.2', '2026-09-04 10:00:00', 'organic', ''],
    ['id6796698146', '1.2.1', '2026-09-04 10:00:00', 'organic', ''],
    ['id6796698146', '1.0.4', '2026-09-04 10:00:00', 'organic', ''],
  ]), installs_report: csv([]) });
  const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', { ...api.APPS.find_the_bird, paid_cohort: approvedCohort }, 'fixture');
  assert.equal(a.organic_status, 'complete');
  assert.equal(a.clean_public_unattributed_installs, 1);
  assert.equal(a.clean_test_or_prerelease_unattributed_installs, 1);
  assert.equal(a.contaminated_installs_excluded, 1);
  assert.equal(a.paid_attributed_installs, 0);
  assert.equal(a.paid_status, 'complete');
});

test('unknown paid row dimensions never become a partial clean total', async () => {
  const row = ['id6796698146', '1.2', '2026-09-04 10:00:00', 'fixture-paid', 'fixture-campaign'];
  for (const blank of ['', '   ', '\t']) {
    for (let i = 0; i < row.length; i += 1) {
      const api = collector({ installs_report: csv([row, row.map((value, index) => index === i ? blank : value)]) });
      const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', { ...api.APPS.find_the_bird, paid_cohort: approvedCohort }, 'fixture');
      assert.equal(a.paid_attributed_installs, null, `dimension ${i}: ${JSON.stringify(blank)}`);
      assert.equal(a.paid_status, 'incomplete');
      assert.equal(a.paid_classification_counts.accepted, 1);
      assert.equal(a.paid_classification_counts.unknown, 1);
    }
  }
  // Nonblank identifiers are not repaired into eligibility by trimming.
  for (const i of [0, 1, 4]) {
    const api = collector({ installs_report: csv([row.map((value, index) => index === i ? ` ${value} ` : value)]) });
    const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', { ...api.APPS.find_the_bird, paid_cohort: approvedCohort }, 'fixture');
    assert.equal(a.paid_attributed_installs, 0);
    assert.equal(a.paid_classification_counts.excluded, 1);
  }
});

test('paid report failures remain incomplete even with an approved cohort', async () => {
  for (const status of [403, 500]) {
    const api = collector({ installs_report: status });
    const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', { ...api.APPS.find_the_bird, paid_cohort: approvedCohort }, 'fixture');
    assert.equal(a.paid_attributed_installs, null);
    assert.equal(a.paid_status, 'incomplete');
  }
});

test('blank organic version provenance makes all aggregates incomplete even with known rows', async () => {
  for (const version of ['', '   ', '\t']) {
    for (const mixed of [false, true]) {
      const row = ['id6796698146', version, '2026-09-04 10:00:00', 'organic', ''];
      const rows = mixed ? [row, row.map((v, i) => i === 1 ? '1.2' : v)] : [row];
      const api = collector({ organic_installs_report: csv(rows) });
      const { acquisition: a, reports } = await api.appsFlyerSnapshot('find_the_bird', api.APPS.find_the_bird, 'fixture');
      assert.equal(a.organic_status, 'incomplete');
      assert.equal(a.clean_public_unattributed_installs, null);
      assert.equal(a.clean_test_or_prerelease_unattributed_installs, null);
      assert.equal(a.contaminated_installs_excluded, null);
      assert.equal(reports.organic_installs_report.row_count, rows.length);
      assert.equal(reports.organic_installs_report.by_app_version.unknown, 1);
    }
  }
});

test('unavailable organic report leaves every organic aggregate unknown, not zero', async () => {
  for (const status of [403, 500]) {
    const api = collector({ organic_installs_report: status });
    const { acquisition: a } = await api.appsFlyerSnapshot('find_the_bird', api.APPS.find_the_bird, 'fixture');
    assert.equal(a.clean_public_unattributed_installs, null);
    assert.equal(a.clean_test_or_prerelease_unattributed_installs, null);
    assert.equal(a.contaminated_installs_excluded, null);
    assert.equal(a.organic_status, 'incomplete');
  }
});
