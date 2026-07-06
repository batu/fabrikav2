import { describe, expect, it } from 'vitest';
import { resolveDomAnchorToCanvasPoint } from './index.ts';

function stubRect(el: Element, rect: { left: number; top: number; width: number; height: number }): void {
  el.getBoundingClientRect = (): DOMRect =>
    ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function canvasWithRect(rect: { left: number; top: number; width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  stubRect(canvas, rect);
  return canvas;
}

describe('resolveDomAnchorToCanvasPoint', () => {
  it('maps a DOM rect into logical coordinates at the element center', () => {
    const canvas = canvasWithRect({ left: 0, top: 0, width: 100, height: 100 });
    const el = document.createElement('div');
    stubRect(el, { left: 50, top: 50, width: 10, height: 10 });

    const point = resolveDomAnchorToCanvasPoint(el, canvas, 1000, 800);

    // center x = (50 + 5)/100 * 1000, center y = (50 + 5)/100 * 800
    expect(point!.x).toBeCloseTo(550, 6);
    expect(point!.y).toBeCloseTo(440, 6);
  });

  it('accounts for a non-origin canvas rect', () => {
    const canvas = canvasWithRect({ left: 20, top: 40, width: 200, height: 200 });
    const el = document.createElement('div');
    stubRect(el, { left: 120, top: 140, width: 0.0001, height: 0.0001 });

    const point = resolveDomAnchorToCanvasPoint(el, canvas, 400, 400);

    // ~((120 - 20)/200)*400 = 200, ~((140 - 40)/200)*400 = 200
    expect(point!.x).toBeCloseTo(200, 1);
    expect(point!.y).toBeCloseTo(200, 1);
  });

  it('honors an anchor-fraction override (FTD dog-counter 0.34/0.5)', () => {
    const canvas = canvasWithRect({ left: 0, top: 0, width: 100, height: 100 });
    const el = document.createElement('div');
    stubRect(el, { left: 50, top: 50, width: 10, height: 10 });

    const point = resolveDomAnchorToCanvasPoint(el, canvas, 1000, 800, { x: 0.34, y: 0.5 });

    // x = (50 + 10*0.34)/100 * 1000 = 534
    expect(point!.x).toBeCloseTo(534, 6);
    expect(point!.y).toBeCloseTo(440, 6);
  });

  it('returns null for a zero-size canvas', () => {
    const canvas = canvasWithRect({ left: 0, top: 0, width: 0, height: 0 });
    const el = document.createElement('div');
    stubRect(el, { left: 10, top: 10, width: 10, height: 10 });

    expect(resolveDomAnchorToCanvasPoint(el, canvas, 1000, 800)).toBeNull();
  });

  it('returns null for a zero-size element', () => {
    const canvas = canvasWithRect({ left: 0, top: 0, width: 100, height: 100 });
    const el = document.createElement('div');
    stubRect(el, { left: 10, top: 10, width: 0, height: 0 });

    expect(resolveDomAnchorToCanvasPoint(el, canvas, 1000, 800)).toBeNull();
  });
});
