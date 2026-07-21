import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startSequenceWorkflow } from './features/lineup/durableStarts.ts';
import {
  startBackgroundGeneration,
  startBandGeneration,
  startCropInpaint,
  startMultiSceneGeneration,
  startRetryFailedDogs,
} from './features/wizard/durableStarts.ts';

// Every started kind must exist in backend FTD_ACTION_KINDS
// (backend/ftd_editor/jobs/actions.py); a typo here would 404 at start time.
const BACKEND_ACTION_KINDS = [
  'ftd.dog_variant_upscale',
  'ftd.background_generate',
  'ftd.sprite_animate',
  'ftd.crop_inpaint',
  'ftd.retry_failed_dogs',
  'ftd.band_generate',
  'ftd.sequence_workflow',
  'ftd.multi_scene_generate',
];

function makeContext() {
  const calls = [];
  const job = { jobId: 'job-1', status: 'queued' };
  const context = {
    transport: {
      async startAction(kind, body) {
        calls.push({ kind, body });
        return job;
      },
      async getJob() {
        return job;
      },
      async listJobs() {
        return [job];
      },
      async listEvents() {
        return [];
      },
    },
    sessionId: 'level-01',
    revision: 'rev-1',
    requestId: 'req-1',
  };
  return { calls, context, job };
}

const STARTS = [
  [startBackgroundGeneration, 'ftd.background_generate', { sceneKey: 's1' }],
  [startCropInpaint, 'ftd.crop_inpaint', { dogKey: 'd1', cropBox: { x: 0, y: 0 } }],
  [startRetryFailedDogs, 'ftd.retry_failed_dogs', { dogKeys: ['d1'] }],
  [startBandGeneration, 'ftd.band_generate', { bandIndex: 2 }],
  [startMultiSceneGeneration, 'ftd.multi_scene_generate', { sceneCount: 3 }],
  [startSequenceWorkflow, 'ftd.sequence_workflow', { sequenceName: 'seq', levelIds: ['l1'] }],
];

describe('durable feature starts', () => {
  for (const [start, expectedKind, inputs] of STARTS) {
    it(`${start.name} posts kind ${expectedKind} with the durable identity body`, async () => {
      const { calls, context, job } = makeContext();
      const result = await start(context, inputs);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].kind, expectedKind);
      assert.ok(BACKEND_ACTION_KINDS.includes(calls[0].kind));
      assert.deepEqual(calls[0].body, {
        requestId: 'req-1',
        sessionId: 'level-01',
        revision: 'rev-1',
        inputs,
      });
      assert.equal(result.job, job);
      assert.equal(result.observer.state().pendingRequestId, 'req-1');
      assert.equal(result.observer.state().jobId, 'job-1');
    });
  }
});
