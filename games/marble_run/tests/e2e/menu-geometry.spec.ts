import { test, expect, type Page } from '@playwright/test';

const MENU_CTA = '[data-fab-action="play"]';
const VIEWPORT = { width: 405, height: 900 };

interface RectMetrics {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface NodeMetrics {
  label: string;
  classes: string;
  rect: RectMetrics;
  dot: RectMetrics;
  backgroundImage: string;
}

interface MenuGeometry {
  viewport: typeof VIEWPORT;
  board: RectMetrics;
  nodes: NodeMetrics[];
  cta: RectMetrics;
}

async function gotoMenu(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await expect(page.locator(MENU_CTA)).toBeVisible();
  await page.waitForTimeout(500);
}

function intersects(a: RectMetrics, b: RectMetrics): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function readMenuGeometry(page: Page): Promise<MenuGeometry> {
  return page.evaluate(async () => {
    function rectOf(el: Element): RectMetrics {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    }

    const canvas = document.querySelector<HTMLCanvasElement>('#scene');
    if (!canvas) throw new Error('#scene canvas not found');
    const canvasRect = rectOf(canvas);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = reject;
      next.src = canvas.toDataURL('image/png');
    });

    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d probe context unavailable');
    ctx.drawImage(image, 0, 0);

    const { data, width, height } = ctx.getImageData(0, 0, probe.width, probe.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[(y * width + x) * 4 + 3] ?? 0;
        if (alpha <= 12) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0 || maxY < 0) throw new Error('decor board alpha bounds not found');

    const scaleX = canvasRect.width / width;
    const scaleY = canvasRect.height / height;
    const board = {
      left: canvasRect.left + minX * scaleX,
      top: canvasRect.top + minY * scaleY,
      right: canvasRect.left + (maxX + 1) * scaleX,
      bottom: canvasRect.top + (maxY + 1) * scaleY,
      width: (maxX - minX + 1) * scaleX,
      height: (maxY - minY + 1) * scaleY,
    };

    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.fab-levelmap-node')).map((el) => {
      const dot = el.querySelector<HTMLElement>('.fab-levelmap-node-dot');
      if (!dot) throw new Error('node dot missing');
      return {
        label: el.textContent?.trim() ?? '',
        classes: el.className,
        rect: rectOf(el),
        dot: rectOf(dot),
        backgroundImage: getComputedStyle(dot).backgroundImage,
      };
    });

    const cta = document.querySelector<HTMLElement>('[data-fab-action="play"]');
    if (!cta) throw new Error('menu CTA missing');
    return { viewport: { width: innerWidth, height: innerHeight }, board, nodes, cta: rectOf(cta) };
  });
}

test.describe('marble_run menu board and saga geometry', () => {
  test('tilted board footprint stays clear of saga nodes and current is the sunburst anchor', async ({ page }) => {
    await gotoMenu(page);
    const geometry = await readMenuGeometry(page);

    expect(geometry.board.width).toBeLessThan(geometry.viewport.width * 0.64);
    for (const node of geometry.nodes) {
      expect(intersects(node.dot, geometry.board), `${node.label} overlaps the decor board`).toBe(false);
      expect(node.dot.top, `${node.label} is not below the decor board`).toBeGreaterThanOrEqual(geometry.board.bottom + 6);
    }

    const current = geometry.nodes.find((node) => node.classes.includes('current'));
    expect(current, 'current saga node missing').toBeTruthy();
    const others = geometry.nodes.filter((node) => !node.classes.includes('current'));
    const largestOther = Math.max(...others.map((node) => node.dot.width));
    expect(current!.dot.width).toBeGreaterThan(largestOther * 2);
    expect(current!.backgroundImage).toContain('level-node-current');
    expect(current!.dot.bottom).toBeLessThanOrEqual(geometry.cta.top - 10);
  });
});
