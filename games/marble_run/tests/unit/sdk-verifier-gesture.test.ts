import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { installSdkVerifierGesture } from '../../src/devtools/installSdkVerifierGesture';

describe('installSdkVerifierGesture', () => {
  it('opens only after four quick taps', () => {
    const testWindow = new Window();
    const window = testWindow as unknown as globalThis.Window;
    const onToggle = vi.fn();
    let now = 0;
    const release = installSdkVerifierGesture(window, onToggle, { now: () => now });
    const tap = () => testWindow.dispatchEvent(new testWindow.PointerEvent('pointerup'));

    tap();
    tap();
    expect(onToggle).not.toHaveBeenCalled();

    now = 100;
    tap();
    tap();
    expect(onToggle).toHaveBeenCalledTimes(1);

    release();
  });

  it('resets a partial sequence after the tap window', () => {
    const testWindow = new Window();
    const window = testWindow as unknown as globalThis.Window;
    const onToggle = vi.fn();
    let now = 0;
    installSdkVerifierGesture(window, onToggle, { now: () => now, tapWindowMs: 600 });
    const tap = () => testWindow.dispatchEvent(new testWindow.PointerEvent('pointerup'));

    tap();
    tap();
    now = 601;
    tap();
    tap();

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('does not count taps made inside the verifier pane', () => {
    const testWindow = new Window();
    const window = testWindow as unknown as globalThis.Window;
    const onToggle = vi.fn();
    installSdkVerifierGesture(window, onToggle);
    const pane = testWindow.document.createElement('aside');
    pane.id = 'sdk-verifier-pane';
    const button = testWindow.document.createElement('button');
    pane.appendChild(button);
    testWindow.document.body.appendChild(pane);

    for (let index = 0; index < 4; index += 1) {
      button.dispatchEvent(new testWindow.PointerEvent('pointerup', { bubbles: true }));
    }

    expect(onToggle).not.toHaveBeenCalled();
  });
});
