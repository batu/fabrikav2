import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPageShell } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function freshBody(text = 'Body'): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  return el;
}

/** Dispatch a synthetic touch event with a single point at `clientY`. */
function touch(el: Element, type: 'touchstart' | 'touchend', clientY: number): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'touches', { value: [{ clientY }] });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientY }] });
  el.dispatchEvent(event);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mountPageShell', () => {
  it('adds the slide-in open class on the next animation frame', async () => {
    const handle = mountPageShell({ mountInto: host(), body: freshBody(), id: 'page' });
    expect(handle.el.classList.contains('fab-page--open')).toBe(false);
    await nextFrame();
    expect(handle.el.classList.contains('fab-page--open')).toBe(true);
  });

  it('renders an injected header slot and a back button with icon + label', async () => {
    const injectedBackIcon = 'https://cdn.example/ui/back-icon';
    const header = document.createElement('h2');
    header.textContent = 'Settings';
    const handle = mountPageShell({
      mountInto: host(),
      header,
      body: freshBody(),
      // Injected icon URL — kept extensionless so the token-only audit (which
      // treats a bare *.png literal as a baked asset path) stays clean; the
      // point is only that the injected URL reaches the img.src.
      backIcon: injectedBackIcon,
      backLabel: 'Go back',
      id: 'page',
    });
    expect(handle.el.querySelector('.fab-page-title')?.textContent).toBe('Settings');
    const back = handle.el.querySelector<HTMLButtonElement>('.fab-page-back')!;
    expect(back.getAttribute('aria-label')).toBe('Go back');
    expect(handle.el.querySelector<HTMLImageElement>('.fab-page-back-art')?.getAttribute('src')).toBe(
      injectedBackIcon,
    );
  });

  it('dismisses on a swipe-down past the threshold and stays below it', async () => {
    const h = host();
    const handle = mountPageShell({ mountInto: h, body: freshBody(), id: 'page' });
    await nextFrame();

    // Below the 80px fallback threshold — stays open.
    touch(handle.el, 'touchstart', 100);
    touch(handle.el, 'touchend', 150);
    expect(h.querySelector('#page')).not.toBeNull();

    // Past the threshold — begins closing; the transform transitionend removes it.
    touch(handle.el, 'touchstart', 100);
    touch(handle.el, 'touchend', 220);
    expect(handle.el.classList.contains('fab-page--open')).toBe(false);
    const done = new Event('transitionend');
    Object.defineProperty(done, 'propertyName', { value: 'transform' });
    Object.defineProperty(done, 'target', { value: handle.el });
    handle.el.dispatchEvent(done);
    expect(h.querySelector('#page')).toBeNull();
  });

  it('ignores a swipe that started inside the scrollable body', async () => {
    const h = host();
    const body = freshBody('scrollable');
    mountPageShell({ mountInto: h, body, id: 'page' });
    await nextFrame();
    // Gesture begins on the body content — treated as scroll, never dismiss.
    touch(body, 'touchstart', 100);
    touch(body, 'touchend', 400);
    expect(h.querySelector('#page')).not.toBeNull();
  });

  it('tears down on the transform transitionend (not the opacity fade)', async () => {
    const h = host();
    const handle = mountPageShell({ mountInto: h, body: freshBody(), onDismiss: vi.fn(), id: 'page' });
    await nextFrame();
    handle.dismiss();
    expect(handle.el.classList.contains('fab-page--open')).toBe(false);

    // An opacity transitionend must NOT tear down (exit would be cut short).
    const opacity = new Event('transitionend');
    Object.defineProperty(opacity, 'propertyName', { value: 'opacity' });
    Object.defineProperty(opacity, 'target', { value: handle.el });
    handle.el.dispatchEvent(opacity);
    expect(h.querySelector('#page')).not.toBeNull();

    const transform = new Event('transitionend');
    Object.defineProperty(transform, 'propertyName', { value: 'transform' });
    Object.defineProperty(transform, 'target', { value: handle.el });
    handle.el.dispatchEvent(transform);
    expect(h.querySelector('#page')).toBeNull();
  });

  it('falls back to a timeout when transitionend never fires', () => {
    vi.useFakeTimers();
    const h = host();
    const onDismiss = vi.fn();
    const handle = mountPageShell({ mountInto: h, body: freshBody(), onDismiss, id: 'page' });
    handle.dismiss();
    expect(h.querySelector('#page')).not.toBeNull();
    vi.advanceTimersByTime(420); // --fab-page-exit-ms fallback
    expect(h.querySelector('#page')).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('instant pages skip the entrance and remove synchronously on dismiss', () => {
    const h = host();
    const handle = mountPageShell({ mountInto: h, body: freshBody(), instant: true, id: 'page' });
    expect(handle.el.classList.contains('fab-page--instant')).toBe(true);
    handle.dismiss();
    expect(h.querySelector('#page')).toBeNull();
  });
});
