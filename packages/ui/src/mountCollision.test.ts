import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountConnectivityIndicator, mountToaster } from './index.ts';

/**
 * Cross-component mount-id collisions on the shared `createUiRoot` registry.
 * A root left by one component must never hand a later mount of a DIFFERENT
 * component a handle missing that component's methods (AUDIT #28). The stale
 * root is torn down and replaced predictably; a same-component re-mount still
 * reuses idempotently.
 */

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}

const CONN_COPY = { onlineCopy: 'Back online', offlineCopy: 'Offline — playing cached levels' };

afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('shared-UI mount-id collisions', () => {
  it('connectivity mount over a toaster id returns a working indicator, not a method-less cast', () => {
    setOnline(true);
    const h = host();
    const toaster = mountToaster({ mountInto: h, id: 'shared' });
    toaster.show('First');

    const indicator = mountConnectivityIndicator({ mountInto: h, ...CONN_COPY, id: 'shared' });

    // The collision must yield a real indicator API, not the toaster's.
    expect(typeof indicator.isOnline).toBe('function');
    expect(indicator.isOnline()).toBe(true);
    expect((indicator as unknown as { show?: unknown }).show).toBeUndefined();

    // Exactly one root under the shared id, and it is the indicator's dot.
    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(h.querySelector('#shared')!.classList.contains('fab-connectivity')).toBe(true);
    expect(h.querySelector('.fab-toaster')).toBeNull();
  });

  it('toaster mount over a connectivity id returns a working toaster and tears down the old listeners', () => {
    setOnline(true);
    const h = host();
    const onToast = vi.fn();
    mountConnectivityIndicator({ mountInto: h, ...CONN_COPY, onToast, id: 'shared' });

    const toaster = mountToaster({ mountInto: h, id: 'shared' });

    // The collision must yield a real toaster API, not the indicator's.
    expect(typeof toaster.show).toBe('function');
    expect((toaster as unknown as { isOnline?: unknown }).isOnline).toBeUndefined();
    toaster.show('Hello');
    expect(toaster.el.querySelector('.fab-toast')!.textContent).toBe('Hello');

    // Exactly one root under the shared id, and it is the toaster host.
    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(h.querySelector('#shared')!.classList.contains('fab-toaster')).toBe(true);
    expect(h.querySelector('.fab-connectivity')).toBeNull();

    // Replacement cleaned the indicator's window listeners: a transition must
    // not reach the old toast sink (no leak).
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    expect(onToast).not.toHaveBeenCalled();
  });

  it('same-component re-mount reuses the live handle idempotently (toaster)', () => {
    const h = host();
    const first = mountToaster({ mountInto: h, id: 'shared' });
    const second = mountToaster({ mountInto: h, id: 'shared' });
    expect(second).toBe(first);
    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    // The reused handle still shows toasts.
    second.show('Reused');
    expect(h.querySelector('.fab-toast')!.textContent).toBe('Reused');
  });

  it('same-component re-mount reuses the live handle idempotently (connectivity)', () => {
    setOnline(true);
    const h = host();
    const first = mountConnectivityIndicator({ mountInto: h, ...CONN_COPY, id: 'shared' });
    const second = mountConnectivityIndicator({ mountInto: h, ...CONN_COPY, id: 'shared' });
    expect(second).toBe(first);
    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(second.isOnline()).toBe(true);
  });

  it('replacing a mount does not leak the old timers onto the new root', () => {
    vi.useFakeTimers();
    try {
      const h = host();
      const toaster = mountToaster({ mountInto: h, id: 'shared' });
      toaster.show('Stale'); // schedules fade/remove timers on the old host
      const indicator = mountConnectivityIndicator({ mountInto: h, ...CONN_COPY, id: 'shared' });

      // The old toaster's pending timers must fire harmlessly and never touch the
      // indicator that replaced it.
      vi.advanceTimersByTime(10000);
      expect(h.querySelectorAll('#shared')).toHaveLength(1);
      expect(h.querySelector('#shared')).toBe(indicator.el);
      expect(h.querySelector('.fab-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
