import { describe, expect, it, vi } from 'vitest';
import { createTrackingRequest, setNotificationPromptReady, showTrackingExplanation } from './TrackingExplanation';

vi.mock('../audio/AudioManager', () => ({ playUITap: vi.fn() }));

describe('tracking explanation sequence', () => {
  it('waits for the launch notification prompt before mounting and resolves only on Continue', async () => {
    let release!: () => void;
    setNotificationPromptReady(new Promise<void>((resolve) => { release = resolve; }));
    const pending = showTrackingExplanation();
    await Promise.resolve();
    expect(document.getElementById('tracking-explanation')).toBeNull();
    release();
    await vi.waitFor(() => expect(document.getElementById('tracking-explanation')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('#tracking-explanation button')!.click();
    await pending;
    expect(document.getElementById('tracking-explanation')).toBeNull();
    setNotificationPromptReady(Promise.resolve());
  });
  it('settles a never-returning status API without opening a prompt', async () => {
    vi.useFakeTimers();
    const explain = vi.fn(); const request = vi.fn();
    const run = createTrackingRequest({ platform: 'ios', status: () => new Promise(() => {}), explain, request, timeoutMs: 25 });
    const pending = run(); await vi.advanceTimersByTimeAsync(25); await pending;
    expect(explain).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it.each(['denied', 'authorized', 'restricted'])('skips known status %s', async (status) => {
    const explain = vi.fn(); const request = vi.fn();
    await createTrackingRequest({ platform: 'ios', status: async () => ({ status }), explain, request })();
    expect(explain).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  it('serializes callers behind Continue and requests once', async () => {
    let proceed!: () => void;
    const explain = vi.fn(() => new Promise<void>((resolve) => { proceed = resolve; }));
    const request = vi.fn(async () => {});
    const run = createTrackingRequest({ platform: 'ios', status: async () => ({ status: 'notDetermined' }), explain, request });
    const first = run(); const second = run();
    await vi.waitFor(() => expect(explain).toHaveBeenCalledOnce());
    expect(request).not.toHaveBeenCalled(); proceed();
    await Promise.all([first, second]); expect(request).toHaveBeenCalledOnce();
  });
  it('never shows the iOS explanation on Android', async () => {
    const status = vi.fn();
    await createTrackingRequest({ platform: 'android', status, explain: vi.fn(), request: vi.fn() })();
    expect(status).not.toHaveBeenCalled();
  });
  it('settles unavailable native calls without a retry race', async () => {
    const request = vi.fn();
    const run = createTrackingRequest({ platform: 'ios', status: async () => { throw new Error('unavailable'); }, explain: vi.fn(), request });
    await run(); await run(); expect(request).not.toHaveBeenCalled();
  });
});
