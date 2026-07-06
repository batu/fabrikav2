import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTimeoutError, TimeoutError, withTimeout } from './with-timeout.ts';

describe('withTimeout', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('resolves with the underlying promise value before the timeout', async (): Promise<void> => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'fast call')).resolves.toBe('ok');
  });

  it('rejects with a typed TimeoutError after the timeout elapses', async (): Promise<void> => {
    vi.useFakeTimers();

    const result = withTimeout(new Promise<string>(() => {}), 25, 'slow call');
    const expectation = expect(result).rejects.toMatchObject({
      name: 'TimeoutError',
      label: 'slow call',
      timeoutMs: 25,
      message: 'slow call timed out after 25ms',
    });
    await vi.advanceTimersByTimeAsync(25);
    await expectation;
  });

  it('identifies timeout errors without swallowing ordinary errors', async (): Promise<void> => {
    const timeoutError = new TimeoutError('native call', 10);
    const ordinaryError = new Error('boom');

    expect(isTimeoutError(timeoutError)).toBe(true);
    expect(isTimeoutError(ordinaryError)).toBe(false);
    await expect(withTimeout(Promise.reject(ordinaryError), 10, 'native call')).rejects.toBe(ordinaryError);
  });
});
