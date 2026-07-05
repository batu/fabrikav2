import type { Page } from '@playwright/test';

export interface BoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasFraction {
  x: number;
  y: number;
}

export function pointAtBoxFraction(box: BoxLike, fraction: CanvasFraction): { x: number; y: number } {
  return {
    x: box.x + (box.width * fraction.x),
    y: box.y + (box.height * fraction.y),
  };
}

export async function getCanvasBox(page: Page, selector: string = 'canvas'): Promise<BoxLike> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`No bounding box available for selector "${selector}"`);
  }
  return box;
}

export async function clickCanvasFraction(
  page: Page,
  fraction: CanvasFraction,
  selector: string = 'canvas',
): Promise<void> {
  const box = await getCanvasBox(page, selector);
  const point = pointAtBoxFraction(box, fraction);
  await page.mouse.click(point.x, point.y);
}

export interface DragCanvasFractionOptions {
  steps?: number;
  holdMs?: number;
  selector?: string;
}

export async function dragCanvasFraction(
  page: Page,
  start: CanvasFraction,
  end: CanvasFraction,
  options: DragCanvasFractionOptions = {},
): Promise<void> {
  const {
    steps = 15,
    holdMs = 0,
    selector = 'canvas',
  } = options;
  const box = await getCanvasBox(page, selector);
  const startPoint = pointAtBoxFraction(box, start);
  const endPoint = pointAtBoxFraction(box, end);

  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  if (holdMs > 0) {
    await page.waitForTimeout(holdMs);
  }
  await page.mouse.move(endPoint.x, endPoint.y, { steps });
  await page.mouse.up();
}
