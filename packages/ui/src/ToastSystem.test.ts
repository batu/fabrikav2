import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountToaster } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mountToaster', () => {
  it('mounts its host into the injected element', () => {
    const h = host();
    const toaster = mountToaster({ mountInto: h, id: 'toaster' });
    expect(h.contains(toaster.el)).toBe(true);
    expect(toaster.el.classList.contains('fab-toaster')).toBe(true);
  });

  it('shows a role=status toast carrying the injected message', () => {
    const toaster = mountToaster({ mountInto: host() });
    toaster.show('Back online');
    const toast = toaster.el.querySelector<HTMLElement>('.fab-toast')!;
    expect(toast).not.toBeNull();
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toBe('Back online');
  });

  it('adds the visible class on the next animation frame', async () => {
    const toaster = mountToaster({ mountInto: host() });
    toaster.show('Hi');
    const toast = toaster.el.querySelector<HTMLElement>('.fab-toast')!;
    expect(toast.classList.contains('fab-toast--visible')).toBe(false);
    await nextFrame();
    expect(toast.classList.contains('fab-toast--visible')).toBe(true);
  });

  it('is queue-of-one: a second show replaces the in-flight toast', () => {
    const toaster = mountToaster({ mountInto: host() });
    toaster.show('First');
    toaster.show('Second');
    const toasts = toaster.el.querySelectorAll('.fab-toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].textContent).toBe('Second');
  });

  it('fades out and removes the toast on the duration + fade timers', () => {
    vi.useFakeTimers();
    const toaster = mountToaster({ mountInto: host() });
    toaster.show('Bye');
    const toast = toaster.el.querySelector<HTMLElement>('.fab-toast')!;

    vi.advanceTimersByTime(3000);
    expect(toast.classList.contains('fab-toast--visible')).toBe(false);
    expect(toaster.el.querySelector('.fab-toast')).not.toBeNull();

    vi.advanceTimersByTime(250);
    expect(toaster.el.querySelector('.fab-toast')).toBeNull();
  });

  it('dismiss removes the toaster host and cancels pending timers', async () => {
    vi.useFakeTimers();
    const h = host();
    const toaster = mountToaster({ mountInto: h, id: 'toaster' });
    toaster.show('Bye');
    toaster.dismiss();
    expect(h.querySelector('#toaster')).toBeNull();
    // No pending timer should resurrect a toast onto the detached host.
    vi.advanceTimersByTime(10000);
    expect(h.querySelector('.fab-toast')).toBeNull();
  });
});
