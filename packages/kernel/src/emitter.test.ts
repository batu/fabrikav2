import { describe, expect, test, vi } from 'vitest';

import { createTypedEventEmitter } from './emitter.ts';

type EventMap = {
  'game:start': undefined;
  'game:over': { score: number };
};

describe('createTypedEventEmitter', (): void => {
  test('emits payload events to subscribers', (): void => {
    const emitter = createTypedEventEmitter<EventMap>();
    const onGameOver = vi.fn<(payload: { score: number }) => void>();

    emitter.on('game:over', onGameOver);
    emitter.emit('game:over', { score: 42 });

    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(onGameOver).toHaveBeenCalledWith({ score: 42 });
  });

  test('supports undefined payload events', (): void => {
    const emitter = createTypedEventEmitter<EventMap>();
    const onGameStart = vi.fn<() => void>();

    emitter.on('game:start', onGameStart);
    emitter.emit('game:start');

    expect(onGameStart).toHaveBeenCalledTimes(1);
  });

  test('removes listeners selectively and globally', (): void => {
    const emitter = createTypedEventEmitter<EventMap>();
    const first = vi.fn<(payload: { score: number }) => void>();
    const second = vi.fn<(payload: { score: number }) => void>();

    emitter.on('game:over', first);
    emitter.on('game:over', second);
    emitter.off('game:over', first);
    emitter.emit('game:over', { score: 7 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    emitter.removeAll('game:over');
    emitter.emit('game:over', { score: 9 });
    expect(second).toHaveBeenCalledTimes(1);

    emitter.on('game:start', vi.fn());
    emitter.removeAll();
    emitter.emit('game:start');
  });
});
