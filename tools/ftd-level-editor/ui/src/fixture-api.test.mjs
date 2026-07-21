import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fixtureFetch } from './fixture-api.ts';

describe('fail-closed browser fixture', () => {
  it('serves only explicitly scripted backend paths', async () => {
    const bootstrap = await fixtureFetch('/bootstrap');
    const status = await fixtureFetch('/api/status', {
      headers: { 'X-FTD-Launch-Credential': 'fixture-launch-credential' },
    });

    assert.deepEqual(await bootstrap.json(), {
      launchCredential: 'fixture-launch-credential',
    });
    assert.deepEqual(await status.json(), {
      service: 'ftd-level-editor',
      providerMode: 'fail-closed',
      workerMode: 'manual',
      stores: [],
    });
  });

  it('requires the launch credential on scripted protected paths', async () => {
    await assert.rejects(
      fixtureFetch('/api/status'),
      /Fixture launch credential required/,
    );
  });

  for (const path of ['/api/jobs', '/assets/missing.png', '/downloads/missing.png']) {
    it(`rejects unmatched protected request ${path} instead of proxying`, async () => {
      await assert.rejects(
        fixtureFetch(path),
        new RegExp(`Unmatched protected fixture request: GET ${path}`),
      );
    });
  }

  it('rejects absolute cross-origin requests', async () => {
    await assert.rejects(
      fixtureFetch('http://127.0.0.1:5192/api/status'),
      /Fixture requests must use same-origin paths/,
    );
  });

  it('rejects unlisted query variants of scripted paths', async () => {
    await assert.rejects(
      fixtureFetch('/api/status?unlisted=true', {
        headers: { 'X-FTD-Launch-Credential': 'fixture-launch-credential' },
      }),
      /Unmatched protected fixture request: GET \/api\/status\?unlisted=true/,
    );
  });
});
