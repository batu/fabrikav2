import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReviewServer } from '../src/reviewServer.ts';
import { parseAcceptedHandoff } from '../src/publish/handoff.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PUBLICATIONS = path.join(REPO_ROOT, 'games', 'shell_proof_phaser', 'authoring', 'publications');
const ACCEPTED = path.join(PUBLICATIONS, 'accepted.json');

interface BrowserActionRect {
  semanticId: string;
  x: number;
  y: number;
}

interface BrowserLastAction {
  semanticId: string;
  outcome: string;
  sourceState: string;
  targetState: string;
  sdkExecuted?: boolean;
  enabled?: boolean;
}

interface BrowserReview {
  ready: boolean;
  error: string | null;
  transitioning: boolean;
  currentState: string;
  activeActionRects: BrowserActionRect[];
  lastAction: BrowserLastAction | null;
  settingsOrigin: string;
  toggleState: Record<string, boolean>;
  setState(state: string): Promise<unknown>;
  game: {
    scene: {
      getScene(key: string): { children: { list: Array<{ type?: string; text?: string; visible?: boolean }> } };
    };
  };
}

function publicationDir(): string {
  const override = process.env.U5_PUBLICATION_DIR;
  if (override) return path.resolve(override);
  expect(existsSync(ACCEPTED), 'accepted.json is required for the real interaction proof').toBe(true);
  const handoff = parseAcceptedHandoff(JSON.parse(readFileSync(ACCEPTED, 'utf8')));
  return path.join(PUBLICATIONS, handoff.roles.p0.publicationId);
}

async function waitForReview(page: Page, state: string): Promise<void> {
  await page.waitForFunction((expectedState) => {
    const review = (globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__?: BrowserReview })
      .__FABRIKA_PHASER_REVIEW__;
    if (review?.error) throw new Error(review.error);
    return review?.ready === true && review.transitioning === false && review.currentState === expectedState;
  }, state);
}

async function tapAction(page: Page, semanticId: string, expectedState: string): Promise<BrowserLastAction> {
  const action = await page.evaluate((id) => {
    const review = (globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview })
      .__FABRIKA_PHASER_REVIEW__;
    return review.activeActionRects.find((entry) => entry.semanticId === id) ?? null;
  }, semanticId);
  expect(action, `${semanticId} must have an active sealed action rectangle`).not.toBeNull();
  const canvas = page.locator('#game canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    box!.x + action!.x * box!.width / 390,
    box!.y + action!.y * box!.height / 844,
  );
  try {
    await page.waitForFunction(({ id, state }) => {
    const review = (globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview })
      .__FABRIKA_PHASER_REVIEW__;
    return review.transitioning === false
      && review.currentState === state
      && review.lastAction?.semanticId === id;
    }, { id: semanticId, state: expectedState }, { timeout: 4_000 });
  } catch (error) {
    const debug = await page.evaluate(() => {
      const review = (globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview })
        .__FABRIKA_PHASER_REVIEW__;
      const scene = review.game.scene.getScene(review.currentState[0]!.toUpperCase() + review.currentState.slice(1));
      return {
        state: review.currentState,
        transitioning: review.transitioning,
        lastAction: review.lastAction,
        activeActionRects: review.activeActionRects,
        zones: scene.children.list.filter((item) => item.type === 'Zone').map((item) => ({
          x: (item as unknown as { x: number }).x,
          y: (item as unknown as { y: number }).y,
          visible: item.visible,
          inputEnabled: (item as unknown as { input?: { enabled?: boolean } }).input?.enabled,
        })),
      };
    });
    throw new Error(`${semanticId} did not fire: ${JSON.stringify(debug)}\n${String(error)}`);
  }
  return page.evaluate(() => (
    globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview }
  ).__FABRIKA_PHASER_REVIEW__.lastAction!);
}

test('sealed action rectangles drive the review journey without faking SDK outcomes', async ({ page }) => {
  const server = await startReviewServer({ publicationDir: publicationDir() });
  try {
    await page.goto(`${server.url}/player#menu`, { waitUntil: 'load' });
    await waitForReview(page, 'menu');

    await tapAction(page, 'menu.shop', 'shop');
    const restore = await tapAction(page, 'shop.restore', 'shop');
    expect(restore).toMatchObject({ outcome: 'preview-only', sourceState: 'shop', targetState: 'shop', sdkExecuted: false });
    expect(await page.evaluate(() => {
      const review = (globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview })
        .__FABRIKA_PHASER_REVIEW__;
      return review.game.scene.getScene('Shop').children.list.some((item) => (
        item.type === 'Text' && item.visible !== false && item.text?.includes('Restore was not sent')
      ));
    })).toBe(true);
    await tapAction(page, 'shop.back', 'menu');

    await tapAction(page, 'menu.play', 'level');
    await tapAction(page, 'level.pause', 'pause');
    await tapAction(page, 'pause.settings', 'settings');
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview }
    ).__FABRIKA_PHASER_REVIEW__.settingsOrigin)).toBe('pause');
    const music = await tapAction(page, 'settings.music', 'settings');
    expect(music).toMatchObject({ outcome: 'ephemeral-toggle', enabled: false });
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview }
    ).__FABRIKA_PHASER_REVIEW__.toggleState['settings.music'])).toBe(false);
    await tapAction(page, 'settings.back', 'pause');
    await tapAction(page, 'pause.home', 'menu');

    await tapAction(page, 'menu.settings', 'settings');
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview }
    ).__FABRIKA_PHASER_REVIEW__.settingsOrigin)).toBe('menu');
    await tapAction(page, 'settings.back', 'menu');

    await tapAction(page, 'menu.node.current', 'level');
    await tapAction(page, 'level.test-win', 'win');
    expect(await tapAction(page, 'win.claim', 'win')).toMatchObject({ outcome: 'preview-only', sdkExecuted: false });
    expect(await tapAction(page, 'win.claim-double', 'win')).toMatchObject({ outcome: 'preview-only', sdkExecuted: false });

    await page.evaluate(() => (
      globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview }
    ).__FABRIKA_PHASER_REVIEW__.setState('level'));
    await waitForReview(page, 'level');
    await tapAction(page, 'level.test-lose', 'fail');
    expect(await page.evaluate(() => (
      globalThis as typeof globalThis & { __FABRIKA_PHASER_REVIEW__: BrowserReview }
    ).__FABRIKA_PHASER_REVIEW__.activeActionRects.map(({ semanticId }) => semanticId))).not.toContain('fail.bundle');
    expect(await tapAction(page, 'fail.continue-coins', 'fail')).toMatchObject({ outcome: 'preview-only', sdkExecuted: false });
    await tapAction(page, 'fail.retry', 'level');
  } finally {
    await server.close();
  }
});
