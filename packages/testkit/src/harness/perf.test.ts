import { describe, expect, test } from 'vitest';

import { createPerfRecorder } from './perf.ts';

describe('createPerfRecorder', (): void => {
  test('buckets frames by fps and tracks the worst frame', (): void => {
    const recorder = createPerfRecorder();
    recorder.record(16); // ~62.5fps -> >=60
    recorder.record(16); // >=60
    recorder.record(33); // ~30fps -> >=30
    recorder.record(60); // ~16.6fps -> <20

    const sample = recorder.sample();
    expect(sample.frameCount).toBe(4);
    expect(sample.worstFrameMs).toBe(60);
    expect(sample.buckets).toEqual([
      { label: '>=60', count: 2 },
      { label: '>=30', count: 1 },
      { label: '<20', count: 1 },
    ]);
  });

  test('empty recorder reports a zeroed sample', (): void => {
    expect(createPerfRecorder().sample()).toEqual({
      buckets: [],
      worstFrameMs: 0,
      frameCount: 0,
    });
  });

  test('reset clears counts and worst-frame', (): void => {
    const recorder = createPerfRecorder();
    recorder.record(100);
    recorder.reset();
    expect(recorder.sample()).toEqual({ buckets: [], worstFrameMs: 0, frameCount: 0 });
  });
});
