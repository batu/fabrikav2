import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { hydrateProviders, validateRuntimeConfig } from '../src/config.mjs';

const toolRoot = path.resolve(import.meta.dirname, '..');

function temporaryJson(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-ops-cli-'));
  const file = path.join(dir, 'fixture.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return { dir, file };
}

test('runtime config accepts locators but rejects embedded credential values', () => {
  assert.doesNotThrow(() => validateRuntimeConfig({
    schema_version: 1,
    credentials: { meta: { reporting_token: { env: 'META_TOKEN' } } },
  }));
  assert.throws(() => validateRuntimeConfig({
    schema_version: 1,
    credentials: { meta: { reporting_token: { value: 'do-not-embed' } } },
  }), /env or path_env/);
});

test('provider hydration rejects unknown runtime provider and credential keys', () => {
  const config = {
    providers: [{
      id: 'meta', tab: { label: 'Meta', hosts: ['example.test'] },
      credentials: [{ id: 'reporting_token', kind: 'reporting_api', locator: { env: 'META_TOKEN' } }],
    }],
  };
  assert.throws(() => hydrateProviders(config, {
    credentials: { typo_provider: { reporting_token: { env: 'META_TOKEN' } } },
  }), /unknown runtime provider/);
  assert.throws(() => hydrateProviders(config, {
    credentials: { meta: { typo_credential: { env: 'META_TOKEN' } } },
  }), /unknown runtime credential/);
});

test('health CLI consumes deterministic tab and probe fixtures without network', () => {
  const tabs = temporaryJson([
    ['AppsFlyer', 'https://hq1.appsflyer.com/dashboard'],
    ['AdMob', 'https://admob.google.com/v2/home'],
    ['Google Play Console', 'https://play.google.com/console/'],
    ['Game Home | GameAnalytics', 'https://tool.gameanalytics.com/game/351396/overview/overview'],
    ['RevenueCat', 'https://app.revenuecat.com/'],
    ['Ads Manager - Manage ads - Campaigns', 'https://adsmanager.facebook.com/adsmanager/manage/campaigns'],
    ['App Store Connect', 'https://appstoreconnect.apple.com/apps'],
    ['Firebase', 'https://console.firebase.google.com/'],
    ['Google Drive', 'https://drive.google.com/drive/my-drive'],
  ].map(([title, url], index) => ({ window: 1, index: index + 1, title, url })));
  const probes = temporaryJson({ meta: { ok: true, window: 'fixture' } });
  try {
    const result = spawnSync(process.execPath, [
      path.join(toolRoot, 'cli.mjs'), 'health',
      '--tabs-file', tabs.file,
      '--probe-file', probes.file,
      '--observed-at', '2026-09-03T10:00:00.000Z',
      '--runtime-config', path.join(tabs.dir, 'missing-runtime.json'),
    ], { cwd: toolRoot, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.browser.status, 'healthy');
    assert.equal(output.providers.length, 9);
    assert.equal(output.providers.find(({ provider }) => provider === 'meta').status, 'healthy');
    assert.equal(output.providers.find(({ provider }) => provider === 'appsflyer').error.category, 'missing_credential');
  } finally {
    fs.rmSync(tabs.dir, { recursive: true, force: true });
    fs.rmSync(probes.dir, { recursive: true, force: true });
  }
});
