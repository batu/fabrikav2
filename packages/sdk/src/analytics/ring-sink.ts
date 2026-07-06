/**
 * RingBufferSink — an in-memory {@link AnalyticsSink} that retains the last N
 * emitted events so a TEST can drain them and assert event semantics. It is the
 * `drainEvents()` witness behind the testkit GameHarness contract: the game
 * wires this sink into its analytics fan-out (beside console/firebase), and a
 * test reads the buffer to check "did tapping the cell emit `wrong_tap`?".
 *
 * Additive, beside the existing sinks (the packages/sdk house style: the next
 * backend is a file, not a fork — see `sink.ts`). It buffers the fully-stamped
 * {@link AnalyticsEvent} (env marker + session + timestamp included), so a test
 * inspects exactly what a transport would have received.
 *
 * BOUNDED by construction: the ring holds at most `capacity` events; the oldest
 * is overwritten once full, so a long session can't grow the buffer without
 * limit. `drain()` returns the buffered events oldest-first AND clears them;
 * `snapshot()` reads them without clearing.
 */
import type { AnalyticsEvent } from './contract.ts';
import type { AnalyticsSink } from './sink.ts';

/** Default ring capacity — enough headroom for a test scenario's event trace
 *  without unbounded growth. Override via {@link RingBufferSinkOptions}. */
export const DEFAULT_RING_CAPACITY = 512;

export interface RingBufferSinkOptions {
  /** Max retained events; the oldest is dropped when full. Default 512. */
  readonly capacity?: number;
}

export interface RingBufferSink extends AnalyticsSink {
  /** Buffered events, oldest-first, WITHOUT clearing. */
  snapshot(): AnalyticsEvent[];
  /** Buffered events, oldest-first, AND clear the buffer. */
  drain(): AnalyticsEvent[];
  /** Clear the buffer without returning anything. */
  clear(): void;
  /** How many events are currently buffered. */
  readonly size: number;
}

export function createRingBufferSink(options: RingBufferSinkOptions = {}): RingBufferSink {
  const capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_RING_CAPACITY));
  // Fixed-size ring: `head` is the next write slot; `count` tracks fill (caps at
  // capacity once we start overwriting). Reading walks the oldest→newest window.
  const buffer: (AnalyticsEvent | undefined)[] = new Array(capacity);
  let head = 0;
  let count = 0;

  function ordered(): AnalyticsEvent[] {
    const out: AnalyticsEvent[] = [];
    const start = count < capacity ? 0 : head; // oldest slot
    for (let i = 0; i < count; i += 1) {
      const event = buffer[(start + i) % capacity];
      if (event !== undefined) out.push(event);
    }
    return out;
  }

  function clear(): void {
    buffer.fill(undefined);
    head = 0;
    count = 0;
  }

  return {
    name: 'ring-buffer',
    emit(event: AnalyticsEvent): void {
      buffer[head] = event;
      head = (head + 1) % capacity;
      if (count < capacity) count += 1;
    },
    snapshot(): AnalyticsEvent[] {
      return ordered();
    },
    drain(): AnalyticsEvent[] {
      const events = ordered();
      clear();
      return events;
    },
    clear,
    get size(): number {
      return count;
    },
  };
}
