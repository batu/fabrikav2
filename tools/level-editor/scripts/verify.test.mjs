import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runVerification, verificationEnvironment } from './verify.mjs';
import { ciRequirements, coreRevision } from './install-ci-dependencies.mjs';

test('CI requirements retain lock pins and reject accidental editable/sibling sources', () => {
  assert.equal(ciRequirements('pytest==9.0.2\n'), `pytest==9.0.2\nmerceka-core @ git+https://github.com/batu/merceka-core.git@${coreRevision}\n`);
  assert.throws(() => ciRequirements('-e ../../../merceka-core\n'));
  assert.throws(() => ciRequirements('other @ file:///operator/project\n'));
});

test('verification never inherits credentials, live roots, or provider configuration', () => {
  const env = verificationEnvironment({ PATH: '/bin', OPENROUTER_API_KEY: 'secret', FTD_BUILDER_TOKEN: 'secret', LEVEL_EDITOR_API: 'http://live', LEVELBUILDER_WORKSPACE: '/live', NODE_OPTIONS: '--require secret' }, '/tmp/proof');
  assert.equal(env.PATH, '/bin');
  for (const key of ['OPENROUTER_API_KEY', 'FTD_BUILDER_TOKEN', 'LEVEL_EDITOR_API', 'LEVELBUILDER_WORKSPACE', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
  assert.equal(env.PYTHON_DOTENV_DISABLED, '1');
});

for (const failure of [0, 1, 2, 3, 4, 5, null]) {
  test(`gate propagates failure from step ${failure ?? 'none'} and does not skip backend/browser`, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'editor2-gate-test-'));
    const calls = [];
    try {
      const status = runVerification({ source: { EDITOR2_VERIFY_DIR: output }, log() {}, run(command, args) {
        calls.push([command, args]);
        return { status: calls.length - 1 === failure ? 9 : 0 };
      } });
      assert.equal(status, failure === null ? 0 : 1);
      assert.equal(calls.length, failure === null ? 6 : failure + 1);
      assert.deepEqual(calls[0], [process.execPath, ['scripts/install-ci-dependencies.mjs']]);
      if (calls.length >= 3) assert.ok(calls[2][1].includes('pytest'));
      if (calls.length >= 5) assert.ok(calls[4][1].includes('test:smoke-all'));
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });
}
