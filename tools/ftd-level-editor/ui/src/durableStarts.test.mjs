import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startSpriteAnimation } from './features/animations/durableStarts.ts';
import { startSequenceWorkflow } from './features/lineup/durableStarts.ts';
import {
  startBackgroundGeneration,
  startBandGeneration,
  startCropInpaint,
  startDogRegeneration,
  startDogVariantUpscale,
  startMagentaInpaint,
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
  'ftd.magenta_inpaint',
  'ftd.dog_regenerate',
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
  [startBackgroundGeneration, 'ftd.background_generate', { sceneIntent: { scene: 's1' } }],
  [startCropInpaint, 'ftd.crop_inpaint', { dogId: 'd1', hitbox: { x: 0, y: 0 }, dogIntent: { style: 'clean_old_cartoon' } }],
  [startRetryFailedDogs, 'ftd.retry_failed_dogs', { dogs: [{ dogId: 'd1', hitbox: { x: 1 }, dogIntent: { style: 'clean_old_cartoon' } }] }],
  [startBandGeneration, 'ftd.band_generate', { bandIndex: 2 }],
  [startMultiSceneGeneration, 'ftd.multi_scene_generate', { sceneCount: 3 }],
  [startSequenceWorkflow, 'ftd.sequence_workflow', { sequenceName: 'seq', levelIds: ['l1'] }],
  [startSpriteAnimation, 'ftd.sprite_animate', { dogId: 'd1', sourceCandidateId: 'c1' }],
  [startMagentaInpaint, 'ftd.magenta_inpaint', { dogIntent: { style: 'clean_old_cartoon' }, hitboxes: [{ x: 1 }] }],
  [startDogRegeneration, 'ftd.dog_regenerate', { dogId: 'd1', hitbox: { x: 1 }, dogIntent: { style: 'clean_old_cartoon' } }],
  [
    startDogVariantUpscale,
    'ftd.dog_variant_upscale',
    { target: 'dog_variant', dogId: 'd1', hitbox: { x: 1 }, model: 'fal-ai/esrgan' },
  ],
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
