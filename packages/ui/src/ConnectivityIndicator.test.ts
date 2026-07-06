import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountConnectivityIndicator } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}

const COPY = { onlineCopy: 'Back online', offlineCopy: 'Offline — playing cached levels' };

afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
});

describe('mountConnectivityIndicator', () => {
  it('mounts a role=status dot into the injected element', () => {
    setOnline(true);
    const h = host();
    const handle = mountConnectivityIndicator({ mountInto: h, ...COPY, id: 'conn' });
    expect(h.contains(handle.el)).toBe(true);
    expect(handle.el.classList.contains('fab-connectivity')).toBe(true);
    expect(handle.el.getAttribute('role')).toBe('status');
  });

  it('reflects the initial online state (hidden, no offline class)', () => {
    setOnline(true);
    const handle = mountConnectivityIndicator({ mountInto: host(), ...COPY });
    expect(handle.el.classList.contains('fab-connectivity--offline')).toBe(false);
    expect(handle.el.getAttribute('aria-hidden')).toBe('true');
    expect(handle.isOnline()).toBe(true);
  });

  it('mounts already-offline with the offline class shown', () => {
    setOnline(false);
    const handle = mountConnectivityIndicator({ mountInto: host(), ...COPY });
    expect(handle.el.classList.contains('fab-connectivity--offline')).toBe(true);
    expect(handle.el.getAttribute('aria-hidden')).toBe('false');
    expect(handle.isOnline()).toBe(false);
  });

  it('offline event shows the dot and toasts the injected offline copy', () => {
    setOnline(true);
    const onToast = vi.fn();
    const handle = mountConnectivityIndicator({ mountInto: host(), ...COPY, onToast });

    setOnline(false);
    window.dispatchEvent(new Event('offline'));

    expect(handle.el.classList.contains('fab-connectivity--offline')).toBe(true);
    expect(onToast).toHaveBeenCalledWith(COPY.offlineCopy);
  });

  it('online event hides the dot and toasts the injected online copy', () => {
    setOnline(false);
    const onToast = vi.fn();
    const handle = mountConnectivityIndicator({ mountInto: host(), ...COPY, onToast });

    setOnline(true);
    window.dispatchEvent(new Event('online'));

    expect(handle.el.classList.contains('fab-connectivity--offline')).toBe(false);
    expect(onToast).toHaveBeenCalledWith(COPY.onlineCopy);
  });

  it('dismiss removes the dot and unregisters the window listeners', () => {
    setOnline(true);
    const onToast = vi.fn();
    const h = host();
    const handle = mountConnectivityIndicator({ mountInto: h, ...COPY, onToast, id: 'conn' });

    handle.dismiss();
    expect(h.querySelector('#conn')).toBeNull();

    // A post-dismiss transition must not reach the injected toast sink.
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    expect(onToast).not.toHaveBeenCalled();
  });
});
