// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import { driveInputAt } from './inputDriver.ts';

function targetAtCenter(): { element: HTMLElement; events: string[] } {
  const element = document.createElement('button');
  element.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px;';
  document.body.appendChild(element);
  const events: string[] = [];
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    element.addEventListener(type, () => events.push(type));
  }
  // happy-dom's elementFromPoint is not layout-aware; pin it to the target so
  // the driver's hit-test resolves the way a real browser would.
  document.elementFromPoint = () => element;
  return { element, events };
}

describe('driveInputAt', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('dispatches the full pointer + compat mouse + click sequence in tap order', () => {
    const { element, events } = targetAtCenter();
    const { hitTarget } = driveInputAt({ x: 50, y: 50 });
    expect(hitTarget).toBe(element);
    expect(events).toEqual(['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']);
  });

  it('carries the client coordinates and primary button on the mouse pair', () => {
    const { element } = targetAtCenter();
    const seen: Array<{ type: string; x: number; y: number; button: number }> = [];
    element.addEventListener('mousedown', (e) => seen.push({ type: 'mousedown', x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, button: (e as MouseEvent).button }));
    element.addEventListener('mouseup', (e) => seen.push({ type: 'mouseup', x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, button: (e as MouseEvent).button }));
    driveInputAt({ x: 12, y: 34 });
    expect(seen).toEqual([
      { type: 'mousedown', x: 12, y: 34, button: 0 },
      { type: 'mouseup', x: 12, y: 34, button: 0 },
    ]);
  });

  it('fires exactly one click per drive (no double-activation from the compat pair)', () => {
    const { events } = targetAtCenter();
    driveInputAt({ x: 50, y: 50 });
    expect(events.filter((event) => event === 'click')).toHaveLength(1);
  });

  it('reports a null hit and dispatches nothing when no element is at the point', () => {
    const events: string[] = [];
    document.body.addEventListener('mousedown', () => events.push('mousedown'));
    document.elementFromPoint = () => null;
    const { hitTarget } = driveInputAt({ x: 5, y: 5 });
    expect(hitTarget).toBeNull();
    expect(events).toEqual([]);
  });
});
