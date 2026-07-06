import { describe, expect, it } from 'vitest';

import type { AnalyticsEvent } from './contract.ts';
import { createRingBufferSink } from './ring-sink.ts';

function event(name: string, timestamp: number): AnalyticsEvent {
  return { name, params: {}, timestamp, sessionId: 'sess-1', env: 'test' };
}

describe('createRingBufferSink', () => {
  it('buffers emitted events oldest-first and reports its size', () => {
    const sink = createRingBufferSink();
    sink.emit(event('a', 1));
    sink.emit(event('b', 2));

    expect(sink.size).toBe(2);
    expect(sink.snapshot().map((e) => e.name)).toEqual(['a', 'b']);
  });

  it('snapshot() does not clear; drain() returns then clears', () => {
    const sink = createRingBufferSink();
    sink.emit(event('a', 1));

    expect(sink.snapshot().map((e) => e.name)).toEqual(['a']);
    expect(sink.size).toBe(1); // snapshot left it intact

    expect(sink.drain().map((e) => e.name)).toEqual(['a']);
    expect(sink.size).toBe(0); // drain cleared it
    expect(sink.snapshot()).toEqual([]);
  });

  it('retains the fully-stamped event (env marker included) for semantic asserts', () => {
    const sink = createRingBufferSink();
    sink.emit({
      name: 'wrong_tap',
      params: { cell_x: 2, cell_y: 3 },
      timestamp: 1_700_000_000_000,
      sessionId: 'sess-9',
      env: 'development',
    });

    const [got] = sink.snapshot();
    expect(got).toMatchObject({ name: 'wrong_tap', env: 'development', sessionId: 'sess-9' });
    expect(got!.params).toEqual({ cell_x: 2, cell_y: 3 });
  });

  it('is bounded: overwrites the oldest event past capacity', () => {
    const sink = createRingBufferSink({ capacity: 3 });
    for (let i = 1; i <= 5; i += 1) sink.emit(event(`e${i}`, i));

    // Only the last 3 survive, still oldest-first.
    expect(sink.size).toBe(3);
    expect(sink.snapshot().map((e) => e.name)).toEqual(['e3', 'e4', 'e5']);
  });

  it('clamps a nonsensical capacity to at least 1', () => {
    const sink = createRingBufferSink({ capacity: 0 });
    sink.emit(event('a', 1));
    sink.emit(event('b', 2));
    expect(sink.snapshot().map((e) => e.name)).toEqual(['b']);
  });
});
