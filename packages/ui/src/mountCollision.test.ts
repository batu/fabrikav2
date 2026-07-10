import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mountConnectivityIndicator,
  mountModalShell,
  mountPageShell,
  mountPauseOverlay,
  mountResultCard,
  mountSettingsPage,
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
const SETTINGS = {
  music: true,
  sfx: true,
  haptics: false,
  labels: { music: 'Music', sfx: 'Sound effects', haptics: 'Haptics' },
};

function resultSlots(): {
  art: HTMLElement;
  rewardDisplay: HTMLElement;
  continueOffer: HTMLElement;
  actions: HTMLElement;
} {
  return {
    art: document.createElement('div'),
    rewardDisplay: document.createElement('div'),
    continueOffer: document.createElement('div'),
    actions: document.createElement('div'),
  };
}

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

  it('keeps PageShell and SettingsPage distinct in both mount orders', () => {
    const h = host();
    const baseBody = document.createElement('div');
    const page = mountPageShell({ mountInto: h, body: baseBody, id: 'shared', instant: true });
    const header = document.createElement('h2');

    expect(() =>
      mountSettingsPage({
        mountInto: h,
        header,
        settings: SETTINGS,
        onToggle: vi.fn(),
        id: 'shared',
        instant: true,
      }),
    ).toThrow(/id collision.*shared.*settings-page.*page-shell/i);

    expect(header.parentNode).toBeNull();
    expect(header.classList.contains('fab-page-title')).toBe(false);
    expect(h.querySelector('#shared')).toBe(page.el);

    page.dismiss();
    const settings = mountSettingsPage({
      mountInto: h,
      settings: SETTINGS,
      onToggle: vi.fn(),
      id: 'shared',
      instant: true,
    });
    const replacementBody = document.createElement('div');

    expect(() =>
      mountPageShell({ mountInto: h, body: replacementBody, id: 'shared', instant: true }),
    ).toThrow(/id collision.*shared.*page-shell.*settings-page/i);

    expect(replacementBody.parentNode).toBeNull();
    expect(h.querySelector('#shared')).toBe(settings.el);
  });

  it('keeps ModalShell and ResultCard distinct before mutating caller slots', () => {
    const h = host();
    const modal = mountModalShell({ mountInto: h, title: 'Base', id: 'shared' });
    const slots = resultSlots();

    expect(() =>
      mountResultCard({
        mountInto: h,
        variant: 'win',
        title: 'Complete',
        ribbonImage: '/ribbon.png',
        ...slots,
        id: 'shared',
      }),
    ).toThrow(/id collision.*shared.*result-card.*modal-shell/i);

    expect(slots.art.parentNode).toBeNull();
    expect(slots.rewardDisplay.parentNode).toBeNull();
    expect(slots.continueOffer.parentNode).toBeNull();
    expect(slots.actions.parentNode).toBeNull();
    expect(slots.art.classList.contains('fab-result-art')).toBe(false);
    expect(slots.rewardDisplay.classList.contains('fab-result-reward')).toBe(false);
    expect(slots.continueOffer.classList.contains('fab-result-continue')).toBe(false);
    expect(h.querySelector('#shared')).toBe(modal.el);

    modal.dismiss();
    const result = mountResultCard({
      mountInto: h,
      variant: 'lose',
      title: 'Try again',
      ribbonImage: '/ribbon.png',
      actions: [],
      id: 'shared',
    });
    const replacementBody = document.createElement('div');

    expect(() =>
      mountModalShell({ mountInto: h, body: replacementBody, id: 'shared' }),
    ).toThrow(/id collision.*shared.*modal-shell.*result-card/i);

    expect(replacementBody.parentNode).toBeNull();
    expect(h.querySelector('#shared')).toBe(result.el);
  });

  it('keeps ModalShell and PauseOverlay distinct in both mount orders', () => {
    const h = host();
    const modal = mountModalShell({ mountInto: h, title: 'Base', id: 'shared' });

    expect(() =>
      mountPauseOverlay({
        mountInto: h,
        labels: { resume: 'Resume', quit: 'Quit' },
        actions: { onResume: vi.fn(), onQuit: vi.fn() },
        id: 'shared',
      }),
    ).toThrow(/id collision.*shared.*pause-overlay.*modal-shell/i);

    expect(h.querySelector('#shared')).toBe(modal.el);
    modal.dismiss();

    const pause = mountPauseOverlay({
      mountInto: h,
      labels: { resume: 'Resume', quit: 'Quit' },
      actions: { onResume: vi.fn(), onQuit: vi.fn() },
      id: 'shared',
    });

    expect(() => mountModalShell({ mountInto: h, title: 'Replacement', id: 'shared' })).toThrow(
      /id collision.*shared.*modal-shell.*pause-overlay/i,
    );
    expect(h.querySelector('#shared')).toBe(pause.el);
  });

  it('keeps ResultCard and PauseOverlay distinct without pre-mutating result slots', () => {
    const h = host();
    const result = mountResultCard({
      mountInto: h,
      variant: 'win',
      title: 'Complete',
      ribbonImage: '/ribbon.png',
      actions: [],
      id: 'shared',
    });

    expect(() =>
      mountPauseOverlay({
        mountInto: h,
        labels: { resume: 'Resume', quit: 'Quit' },
        actions: { onResume: vi.fn(), onQuit: vi.fn() },
        id: 'shared',
      }),
    ).toThrow(/id collision.*shared.*pause-overlay.*result-card/i);
    expect(h.querySelector('#shared')).toBe(result.el);

    result.dismiss();
    const pause = mountPauseOverlay({
      mountInto: h,
      labels: { resume: 'Resume', quit: 'Quit' },
      actions: { onResume: vi.fn(), onQuit: vi.fn() },
      id: 'shared',
    });
    const slots = resultSlots();

    expect(() =>
      mountResultCard({
        mountInto: h,
        variant: 'lose',
        title: 'Try again',
        ribbonImage: '/ribbon.png',
        ...slots,
        id: 'shared',
      }),
    ).toThrow(/id collision.*shared.*result-card.*pause-overlay/i);

    expect(slots.art.parentNode).toBeNull();
    expect(slots.rewardDisplay.parentNode).toBeNull();
    expect(slots.continueOffer.parentNode).toBeNull();
    expect(slots.actions.parentNode).toBeNull();
    expect(slots.art.className).toBe('');
    expect(slots.rewardDisplay.className).toBe('');
    expect(slots.continueOffer.className).toBe('');
    expect(h.querySelector('#shared')).toBe(pause.el);
  });

  it('reuses wrapper handles without touching slots from a later same-kind mount', () => {
    const h = host();
    const firstResult = mountResultCard({
      mountInto: h,
      variant: 'win',
      title: 'Complete',
      ribbonImage: '/ribbon.png',
      actions: [],
      id: 'result',
    });
    const slots = resultSlots();
    const secondResult = mountResultCard({
      mountInto: h,
      variant: 'lose',
      title: 'Ignored',
      ribbonImage: '/other-ribbon.png',
      ...slots,
      id: 'result',
    });

    expect(secondResult).toBe(firstResult);
    expect(slots.art.parentNode).toBeNull();
    expect(slots.rewardDisplay.parentNode).toBeNull();
    expect(slots.continueOffer.parentNode).toBeNull();
    expect(slots.actions.parentNode).toBeNull();
    expect(slots.art.className).toBe('');
    expect(slots.rewardDisplay.className).toBe('');
    expect(slots.continueOffer.className).toBe('');

    const firstSettings = mountSettingsPage({
      mountInto: h,
      settings: SETTINGS,
      onToggle: vi.fn(),
      id: 'settings',
      instant: true,
    });
    const laterHeader = document.createElement('h2');
    const secondSettings = mountSettingsPage({
      mountInto: h,
      header: laterHeader,
      settings: SETTINGS,
      onToggle: vi.fn(),
      id: 'settings',
      instant: true,
    });

    expect(secondSettings).toBe(firstSettings);
    expect(laterHeader.parentNode).toBeNull();
    expect(laterHeader.className).toBe('');
  });

  it('rejects a matching non-HTMLElement direct child such as SVG', () => {
    const h = host();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'shared';
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    svg.appendChild(circle);
    h.appendChild(svg);

    expect(() => mountToaster({ mountInto: h, id: 'shared' })).toThrow(
      /id collision.*shared.*toaster.*non-HTMLElement.*svg/i,
    );

    expect(h.children).toHaveLength(1);
    expect(h.firstElementChild).toBe(svg);
    expect(svg.firstElementChild).toBe(circle);
  });

  it.each([
    ['owned root first', false],
    ['foreign duplicate first', true],
  ])('rejects ambiguous duplicate direct children with %s', (_label, foreignFirst) => {
    const h = host();
    const toaster = mountToaster({ mountInto: h, id: 'shared' });
    const foreign = document.createElement('div');
    foreign.id = 'shared';
    foreign.dataset.owner = 'host-app';
    if (foreignFirst) h.insertBefore(foreign, toaster.el);
    else h.appendChild(foreign);

    expect(() => mountToaster({ mountInto: h, id: 'shared' })).toThrow(
      /id collision.*shared.*toaster.*ambiguous.*2/i,
    );

    expect(h.querySelectorAll('#shared')).toHaveLength(2);
    expect(h.contains(toaster.el)).toBe(true);
    expect(h.contains(foreign)).toBe(true);
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
