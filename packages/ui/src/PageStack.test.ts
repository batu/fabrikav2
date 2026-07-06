import { describe, expect, it, vi } from 'vitest';
import { createPageStack, mountPauseOverlay, mountPageShell, type UiHandle } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

/** A trivial synchronous-dismiss page for stack-mechanics assertions. */
function fakePage(h: HTMLElement, id: string): () => UiHandle {
  return () => {
    const el = document.createElement('div');
    el.id = id;
    let resolve: () => void = () => {};
    const dismissed = new Promise<void>((r) => (resolve = r));
    h.appendChild(el);
    return {
      el,
      dismissed,
      dismiss: () => {
        if (el.isConnected) el.remove();
        resolve();
      },
    };
  };
}

describe('createPageStack', () => {
  it('push mounts a page and increments depth; top reflects the newest', () => {
    const h = host();
    const stack = createPageStack();
    expect(stack.depth).toBe(0);
    expect(stack.top).toBeNull();

    const a = stack.push(fakePage(h, 'a'));
    expect(stack.depth).toBe(1);
    expect(stack.top).toBe(a);
    const b = stack.push(fakePage(h, 'b'));
    expect(stack.depth).toBe(2);
    expect(stack.top).toBe(b);
    expect(h.querySelector('#a')).not.toBeNull();
    expect(h.querySelector('#b')).not.toBeNull();
  });

  it('pop / back dismiss the top page first (LIFO)', () => {
    const h = host();
    const stack = createPageStack();
    stack.push(fakePage(h, 'a'));
    stack.push(fakePage(h, 'b'));

    stack.back();
    expect(h.querySelector('#b')).toBeNull();
    expect(h.querySelector('#a')).not.toBeNull();
    expect(stack.depth).toBe(1);

    stack.pop();
    expect(h.querySelector('#a')).toBeNull();
    expect(stack.depth).toBe(0);
  });

  it('back at depth 0 is a no-op', () => {
    const stack = createPageStack();
    expect(() => stack.back()).not.toThrow();
    expect(stack.depth).toBe(0);
  });

  it('nested Settings-over-Pause pops back to Pause, not to the root', () => {
    const h = host();
    const stack = createPageStack();
    const pause = stack.push(() =>
      mountPauseOverlay({
        mountInto: h,
        labels: { resume: 'Resume', quit: 'Quit' },
        actions: { onResume: () => {}, onQuit: () => {} },
        id: 'pause',
      }),
    );
    stack.push(() =>
      mountPageShell({ mountInto: h, body: (() => document.createElement('div'))(), instant: true, id: 'settings' }),
    );
    expect(stack.depth).toBe(2);

    stack.back(); // dismiss Settings only
    expect(h.querySelector('#settings')).toBeNull();
    expect(h.querySelector('#pause')).not.toBeNull();
    expect(stack.depth).toBe(1);
    expect(stack.top).toBe(pause);
  });

  it('a page that self-dismisses (own back/swipe) is removed from the stack', () => {
    const h = host();
    const stack = createPageStack();
    stack.push(fakePage(h, 'a'));
    const b = stack.push(fakePage(h, 'b'));
    // Simulate the page tearing itself down (e.g. its own back button).
    b.dismiss();
    // The dismissed observer syncs the stack.
    return b.dismissed.then(() => {
      expect(stack.depth).toBe(1);
      expect(stack.top?.el.id).toBe('a');
    });
  });

  it('fires onEmpty exactly once when the last page is popped', () => {
    const h = host();
    const onEmpty = vi.fn();
    const stack = createPageStack({ onEmpty });
    stack.push(fakePage(h, 'a'));
    stack.push(fakePage(h, 'b'));
    stack.pop();
    expect(onEmpty).not.toHaveBeenCalled();
    stack.pop();
    expect(onEmpty).toHaveBeenCalledOnce();
  });

  it('dispose dismisses every remaining page', () => {
    const h = host();
    const stack = createPageStack();
    stack.push(fakePage(h, 'a'));
    stack.push(fakePage(h, 'b'));
    stack.dispose();
    expect(h.querySelector('#a')).toBeNull();
    expect(h.querySelector('#b')).toBeNull();
    expect(stack.depth).toBe(0);
  });
});
