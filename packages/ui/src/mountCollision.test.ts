import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mountConnectivityIndicator,
  mountModalShell,
  mountPageShell,
  mountToaster,
} from './index.ts';

/**
 * Cross-component mount-id collisions on the shared `createUiRoot` registry.
 * A root left by one component must never hand a later mount of a DIFFERENT
 * component a handle missing that component's methods (AUDIT #28). Collisions
 * fail before mutating either owned or foreign DOM; a same-component re-mount
 * still reuses idempotently.
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('shared-UI mount-id collisions', () => {
  it('rejects a foreign same-id element without disturbing its subtree', () => {
    const h = host();
    const foreign = document.createElement('section');
    foreign.id = 'shared';
    foreign.dataset.owner = 'host-app';
    const child = document.createElement('button');
    child.textContent = 'Host action';
    foreign.appendChild(child);
    h.appendChild(foreign);

    expect(() => mountToaster({ mountInto: h, id: 'shared' })).toThrow(
      /id collision.*shared.*toaster.*untracked/i,
    );

    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(h.querySelector('#shared')).toBe(foreign);
    expect(foreign.dataset.owner).toBe('host-app');
    expect(foreign.firstElementChild).toBe(child);
  });

  it('rejects an incompatible owned kind without dismissing it or clearing its timers', async () => {
    vi.useFakeTimers();
    const h = host();
    const toaster = mountToaster({ mountInto: h, id: 'shared' });
    toaster.show('Still owned');
    let dismissed = false;
    void toaster.dismissed.then(() => {
      dismissed = true;
    });

    expect(() =>
      mountConnectivityIndicator({ mountInto: h, ...CONN_COPY, id: 'shared' }),
    ).toThrow(/id collision.*shared.*connectivity.*toaster/i);

    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(h.querySelector('#shared')).toBe(toaster.el);
    expect(h.querySelector('.fab-toast')?.textContent).toBe('Still owned');
    await Promise.resolve();
    expect(dismissed).toBe(false);

    // A rejected collision does not cancel the existing owner's timers.
    vi.advanceTimersByTime(3250);
    expect(h.querySelector('.fab-toast')).toBeNull();
    expect(h.querySelector('#shared')).toBe(toaster.el);
    await Promise.resolve();
    expect(dismissed).toBe(false);

    toaster.dismiss();
    await toaster.dismissed;
    expect(dismissed).toBe(true);
    expect(h.querySelector('#shared')).toBeNull();
  });

  it('rejects the reverse owned collision and leaves existing listeners active', () => {
    setOnline(true);
    const h = host();
    const onToast = vi.fn();
    const indicator = mountConnectivityIndicator({
      mountInto: h,
      ...CONN_COPY,
      onToast,
      id: 'shared',
    });

    expect(() => mountToaster({ mountInto: h, id: 'shared' })).toThrow(
      /id collision.*shared.*toaster.*connectivity/i,
    );

    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(h.querySelector('#shared')).toBe(indicator.el);
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    expect(onToast).toHaveBeenCalledWith(CONN_COPY.offlineCopy);
  });

  it('does not assume PageShell async dismissal vacates a collided id', async () => {
    vi.useFakeTimers();
    const h = host();
    const body = document.createElement('div');
    const page = mountPageShell({ mountInto: h, body, id: 'shared' });
    let dismissed = false;
    void page.dismissed.then(() => {
      dismissed = true;
    });

    expect(() => mountToaster({ mountInto: h, id: 'shared' })).toThrow(
      /id collision.*shared.*toaster.*page-shell/i,
    );

    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(h.querySelector('#shared')).toBe(page.el);
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(h.querySelector('#shared')).toBe(page.el);
    expect(dismissed).toBe(false);

    page.dismiss();
    vi.advanceTimersByTime(420);
    await page.dismissed;
    expect(dismissed).toBe(true);
    expect(h.querySelector('#shared')).toBeNull();
  });

  it('does not trigger ModalShell onDismiss while rejecting a collision', async () => {
    const h = host();
    let replacement: ReturnType<typeof mountModalShell> | undefined;
    const onDismiss = vi.fn(() => {
      replacement = mountModalShell({ mountInto: h, title: 'Replacement', id: 'shared' });
    });
    const modal = mountModalShell({ mountInto: h, title: 'Original', onDismiss, id: 'shared' });

    expect(() => mountToaster({ mountInto: h, id: 'shared' })).toThrow(
      /id collision.*shared.*toaster.*modal-shell/i,
    );

    expect(onDismiss).not.toHaveBeenCalled();
    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(h.querySelector('#shared')).toBe(modal.el);

    // The modal's normal synchronous teardown/remount contract still works.
    modal.dismiss();
    await modal.dismissed;
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(h.querySelectorAll('#shared')).toHaveLength(1);
    expect(h.querySelector('#shared')).toBe(replacement?.el);
    expect(h.querySelector('#shared .fab-modal-title')?.textContent).toBe('Replacement');
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
});
