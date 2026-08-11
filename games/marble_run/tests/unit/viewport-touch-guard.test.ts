import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { installViewportTouchGuard } from '../../src/platform/viewportTouchGuard';

describe('installViewportTouchGuard', () => {
  it('cancels WebKit viewport panning on every game surface', () => {
    const testWindow = new Window();
    const document = testWindow.document as unknown as Document;
    const release = installViewportTouchGuard(document);

    const gameplay = testWindow.document.createElement('div');
    testWindow.document.body.appendChild(gameplay);
    const gameplayMove = new testWindow.Event('touchmove', { bubbles: true, cancelable: true });
    gameplay.dispatchEvent(gameplayMove);
    expect(gameplayMove.defaultPrevented).toBe(true);

    release();
    const afterRelease = new testWindow.Event('touchmove', { bubbles: true, cancelable: true });
    gameplay.dispatchEvent(afterRelease);
    expect(afterRelease.defaultPrevented).toBe(false);
  });
});
