import { type UiHandle } from './internal.ts';

/**
 * PageStack — the `ui`-level back-stack navigator (the AC's "back-stack
 * behavior"). Per the flow-machine graduation verdict (brainstorm S1), page
 * navigation is a genuinely different data structure from the game-lifecycle
 * machine — an ordered LIFO stack of live {@link UiHandle}s — so it lives in
 * `ui`, orthogonal to `@fabrikav2/kernel/flow`, which stays untouched (its only
 * "go back" edge is `toMenu()`, a hard jump, not a push/pop).
 *
 * `push(mount)` mounts a page and records its handle; `pop()`/`back()` dismiss
 * the top page first (LIFO); `back()` at depth 0 is a no-op. A page that
 * self-dismisses (its own back button / swipe-down) is removed from the stack
 * automatically, so nested Settings-over-Pause pops back to Pause, not Menu.
 */

export interface PageStackOptions {
  /** Fired when the last page is popped and the stack becomes empty. */
  onEmpty?: () => void;
}

export interface PageStack {
  /** Mount a page via the thunk, record its handle on top, return the handle. */
  push(mount: () => UiHandle): UiHandle;
  /** Dismiss the top page (LIFO). No-op when empty. */
  pop(): void;
  /** Hardware/gesture back — dismiss the top page. No-op at depth 0. */
  back(): void;
  readonly depth: number;
  readonly top: UiHandle | null;
  /** Dismiss every remaining page (top-first) and clear the stack. */
  dispose(): void;
}

export function createPageStack(opts: PageStackOptions = {}): PageStack {
  const stack: UiHandle[] = [];

  const remove = (handle: UiHandle): void => {
    const index = stack.indexOf(handle);
    if (index === -1) return;
    stack.splice(index, 1);
    if (stack.length === 0) opts.onEmpty?.();
  };

  const pop = (): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) return;
    // Remove BEFORE dismissing so the self-dismiss observer below is a no-op
    // (and `onEmpty` fires exactly once).
    remove(top);
    top.dismiss();
  };

  return {
    push(mount: () => UiHandle): UiHandle {
      const handle = mount();
      stack.push(handle);
      // Keep the stack in sync if the page tears itself down (own back / swipe).
      void handle.dismissed.then(() => remove(handle));
      return handle;
    },
    pop,
    back: pop,
    get depth(): number {
      return stack.length;
    },
    get top(): UiHandle | null {
      return stack.length > 0 ? stack[stack.length - 1]! : null;
    },
    dispose(): void {
      while (stack.length > 0) {
        const handle = stack.pop()!;
        handle.dismiss();
      }
    },
  };
}
