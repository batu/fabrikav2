---
name: game-qa
description: End-to-end QA testing for Phaser 3 mobile games with Playwright.
scope: optional
---

# Game QA — Playwright E2E Testing (TypeScript)

You are an expert QA engineer testing Phaser 3 mobile games built with TypeScript, Vite, and Capacitor. Tests run against the dev server in a browser, simulating mobile viewports. The goal is to verify that the core gameplay loop works, not to test Phaser internals.

## Tech Stack

| Tool | Purpose |
|------|---------|
| `@playwright/test` | E2E test runner and assertions |
| `@axe-core/playwright` | Accessibility audits on UI overlays |
| `playwright.config.ts` | Project config with mobile device emulation |

## Project Setup

Install dependencies:

```bash
npm install -D @playwright/test @axe-core/playwright
npx playwright install chromium
```

## Directory Structure

```
tests/
├── e2e/
│   ├── boot.spec.ts           # Game boots and reaches menu
│   ├── gameplay.spec.ts       # Core loop: input → state → render
│   ├── scoring.spec.ts        # Score increments, best score persists
│   ├── game-over.spec.ts      # Game over triggers, UI buttons work
│   ├── restart.spec.ts        # Restart works cleanly N times
│   ├── mute.spec.ts           # Audio toggle persists
│   ├── visual.spec.ts         # Screenshot comparisons
│   └── performance.spec.ts    # Load time, FPS
├── fixtures/
│   └── gamePage.ts            # Custom test fixture with game helpers
playwright.config.ts
```

## Playwright Config

The config starts the Vite dev server automatically, uses a Pixel 5 viewport, and sets sensible timeouts for game loading.

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,           // Games share GPU — run serially
  retries: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,    // Allow 2% pixel diff for anti-aliasing
    },
  },
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
      },
    },
    {
      name: 'desktop',
      use: {
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
```

**Key decisions:**
- `fullyParallel: false` — Phaser games are GPU-heavy. Parallel tests fight over resources.
- `maxDiffPixelRatio: 0.02` — Anti-aliasing differs across GPUs. Allow a small tolerance.
- Pixel 5 project is the primary target — matches the most common Play Store device class.

## Testability Requirements

The game **must** expose state to the test harness. In `main.ts`, attach the Phaser game instance and the GameState singleton to `window`:

```typescript
// main.ts
import Phaser from 'phaser';
import { GameConfig } from './core/GameConfig';
import { gameState } from './core/GameState';

const game = new Phaser.Game(GameConfig);

// Expose for Playwright E2E tests
if (typeof window !== 'undefined') {
  (window as any).__GAME__ = game;
  (window as any).__GAME_STATE__ = gameState;
}
```

Declare the types so test code gets autocomplete:

```typescript
// tests/global.d.ts
import type { GameStateData } from '../src/core/GameState';

declare global {
  interface Window {
    __GAME__: Phaser.Game;
    __GAME_STATE__: GameStateData & { reset(): void; addScore(n?: number): void };
  }
}
```

**Why this approach:** Tests need to read game state (score, gameOver, current scene) and sometimes mutate it (force a game-over to test the results screen). Polling the DOM does not work because Phaser renders to a `<canvas>`. Exposing state on `window` is the standard pattern for canvas-based game testing.

## Custom Test Fixture

Create a `gamePage` fixture that handles waiting for the game to boot and provides helper methods:

```typescript
// tests/fixtures/gamePage.ts
import { test as base, expect, Page } from '@playwright/test';

type GameFixtures = {
  gamePage: GamePage;
};

class GamePage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
    // Wait for Phaser to boot and reach a scene
    await this.page.waitForFunction(
      () => window.__GAME__?.scene?.scenes?.length > 0,
      { timeout: 15_000 },
    );
  }

  async waitForScene(sceneKey: string, timeoutMs: number = 10_000): Promise<void> {
    await this.page.waitForFunction(
      (key) => window.__GAME__.scene.isActive(key),
      sceneKey,
      { timeout: timeoutMs },
    );
  }

  async getState<K extends keyof Window['__GAME_STATE__']>(
    key: K,
  ): Promise<Window['__GAME_STATE__'][K]> {
    return this.page.evaluate((k) => window.__GAME_STATE__[k], key);
  }

  async setState(partial: Partial<Window['__GAME_STATE__']>): Promise<void> {
    await this.page.evaluate((data) => {
      Object.assign(window.__GAME_STATE__, data);
    }, partial);
  }

  async tapCanvas(x: number, y: number): Promise<void> {
    const canvas = this.page.locator('canvas');
    await canvas.tap({ position: { x, y } });
  }

  async clickCanvas(x: number, y: number): Promise<void> {
    const canvas = this.page.locator('canvas');
    await canvas.click({ position: { x, y } });
  }

  async screenshotCanvas(): Promise<Buffer> {
    const canvas = this.page.locator('canvas');
    return canvas.screenshot();
  }

  async getFPS(): Promise<number> {
    return this.page.evaluate(() => window.__GAME__.loop.actualFps);
  }
}

export const test = base.extend<GameFixtures>({
  gamePage: async ({ page }, use) => {
    const gamePage = new GamePage(page);
    await use(gamePage);
  },
});

export { expect };
```

## Core Testing Patterns

### 1. Game Boot and Scene Flow

Verify the game starts and progresses through its scene chain:

```typescript
// tests/e2e/boot.spec.ts
import { test, expect } from '../fixtures/gamePage';

test('game boots and reaches MenuScene', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('MenuScene');
});

test('menu transitions to GameScene on tap', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('MenuScene');

  // Tap center of canvas to start
  const canvas = gamePage.page.locator('canvas');
  const box = await canvas.boundingBox();
  await gamePage.tapCanvas(box!.width / 2, box!.height / 2);

  await gamePage.waitForScene('GameScene');
});
```

### 2. Gameplay Verification — Input Affects State

The most important test: does player input actually change game state?

```typescript
test('player input changes game state', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('GameScene');

  const scoreBefore = await gamePage.getState('score');

  // Perform a game-specific action (tap a valid target)
  // Replace coordinates with your game's interactive zone
  await gamePage.tapCanvas(200, 400);

  // Wait for state to update
  await gamePage.page.waitForFunction(
    (prev) => window.__GAME_STATE__.score !== prev,
    scoreBefore,
    { timeout: 5_000 },
  );

  const scoreAfter = await gamePage.getState('score');
  expect(scoreAfter).toBeGreaterThan(scoreBefore);
});
```

### 3. Scoring Works

```typescript
test('score increments and best score persists across restarts', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('GameScene');

  // Force some score
  await gamePage.setState({ score: 42 });
  await gamePage.page.evaluate(() => window.__GAME_STATE__.addScore(0)); // triggers bestScore update

  const best = await gamePage.getState('bestScore');
  expect(best).toBeGreaterThanOrEqual(42);
});
```

### 4. Game Over Triggers

```typescript
test('game over is reachable and shows GameOverScene', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('GameScene');

  // Force game-over state and emit the event
  await gamePage.page.evaluate(() => {
    window.__GAME_STATE__.gameOver = true;
    // Trigger whatever mechanism your game uses to transition
    window.__GAME__.scene.start('GameOverScene', { score: window.__GAME_STATE__.score });
  });

  await gamePage.waitForScene('GameOverScene');
});
```

### 5. Restart Works Cleanly (3x in a Row)

This catches stale references, leaked timers, and state that survives `reset()`:

```typescript
test('restart works cleanly 3 times in a row', async ({ gamePage }) => {
  await gamePage.goto();

  for (let i = 0; i < 3; i++) {
    await gamePage.waitForScene('GameScene');

    // Play briefly — tap a few times
    await gamePage.tapCanvas(200, 400);
    await gamePage.page.waitForTimeout(500);

    // Force game over → restart
    await gamePage.page.evaluate(() => {
      window.__GAME_STATE__.gameOver = true;
      window.__GAME__.scene.start('GameOverScene', { score: window.__GAME_STATE__.score });
    });
    await gamePage.waitForScene('GameOverScene');

    // Tap restart button area
    const box = await gamePage.page.locator('canvas').boundingBox();
    await gamePage.tapCanvas(box!.width / 2, box!.height * 0.7);

    // Verify state was reset
    const score = await gamePage.getState('score');
    const gameOver = await gamePage.getState('gameOver');
    expect(score).toBe(0);
    expect(gameOver).toBe(false);
  }
});
```

### 6. Mute Toggle

```typescript
test('mute toggle changes state and persists', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('MenuScene');

  const mutedBefore = await gamePage.getState('isMuted');

  // Tap mute button area (top-right corner typically)
  const box = await gamePage.page.locator('canvas').boundingBox();
  await gamePage.tapCanvas(box!.width * 0.9, box!.height * 0.05);

  const mutedAfter = await gamePage.getState('isMuted');
  expect(mutedAfter).toBe(!mutedBefore);

  // Reload — mute should persist via localStorage
  await gamePage.goto();
  const mutedReloaded = await gamePage.getState('isMuted');
  expect(mutedReloaded).toBe(!mutedBefore);
});
```

### 7. Game-Over Buttons Have Visible Text

Phaser renders buttons to canvas, so we cannot query the DOM. Instead, verify via state transitions that buttons are functional, and use screenshot comparison to confirm text is visible:

```typescript
test('game-over screen has visible button text', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('GameScene');

  // Force to game over
  await gamePage.page.evaluate(() => {
    window.__GAME__.scene.start('GameOverScene', { score: 10 });
  });
  await gamePage.waitForScene('GameOverScene');

  // Wait for scene to settle
  await gamePage.page.waitForTimeout(500);

  // Visual check — screenshot should show readable button text
  const screenshot = await gamePage.screenshotCanvas();
  expect(screenshot).toMatchSnapshot('game-over-buttons.png');
});
```

### 8. Real Pointer HUD Smoke Test

State hooks can bypass the rendered HUD or menu path. For Phaser/canvas games,
at least one UI/UX-facing smoke test should use a real Playwright pointer/tap
against the canvas instead of only mutating `window.__GAME_STATE__` or starting
scenes directly.

Pick one control touched by the change, such as:

- menu start/play
- HUD pause/settings/mute
- retry/continue on game over
- level select card
- shop buy/close

The assertion can still read harness state after the tap, but the input must
travel through the actual rendered hit area:

```typescript
test('HUD mute button responds to a real pointer tap', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('GameScene');

  const mutedBefore = await gamePage.getState('isMuted');
  const box = await gamePage.page.locator('canvas').boundingBox();

  await gamePage.tapCanvas(box!.width * 0.92, box!.height * 0.08);

  const mutedAfter = await gamePage.getState('isMuted');
  expect(mutedAfter).toBe(!mutedBefore);
});
```

This catches harness-bypass risk: a test that forces state directly can pass
while the visible HUD button is dead, misaligned, outside the safe area, or
covered by another canvas object.

## Visual Regression

Use Playwright's built-in `toHaveScreenshot()` for deterministic visual checks. Pin scenes to known states before capturing:

```typescript
// tests/e2e/visual.spec.ts
import { test, expect } from '../fixtures/gamePage';

test('menu scene matches baseline', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('MenuScene');
  await gamePage.page.waitForTimeout(1_000); // Let animations settle

  await expect(gamePage.page.locator('canvas')).toHaveScreenshot('menu.png');
});

test('game over scene matches baseline', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('GameScene');

  await gamePage.page.evaluate(() => {
    window.__GAME__.scene.start('GameOverScene', { score: 99 });
  });
  await gamePage.waitForScene('GameOverScene');
  await gamePage.page.waitForTimeout(500);

  await expect(gamePage.page.locator('canvas')).toHaveScreenshot('game-over.png');
});
```

**Tips:**
- Generate baseline screenshots with `npx playwright test --update-snapshots`.
- Run visual tests only in the `mobile` project to keep baselines manageable.
- The 2% `maxDiffPixelRatio` in the config handles minor anti-aliasing differences.
- CI must use the same OS and GPU driver as the baseline machine (or use Docker).

## Performance Tests

```typescript
// tests/e2e/performance.spec.ts
import { test, expect } from '../fixtures/gamePage';

test('game loads in under 4 seconds', async ({ gamePage }) => {
  const start = Date.now();
  await gamePage.goto();
  await gamePage.waitForScene('MenuScene');
  const loadTime = Date.now() - start;

  expect(loadTime).toBeLessThan(4_000);
});

test('gameplay maintains 50+ FPS', async ({ gamePage }) => {
  await gamePage.goto();
  await gamePage.waitForScene('GameScene');

  // Let the game run for 3 seconds
  await gamePage.page.waitForTimeout(3_000);

  const fps = await gamePage.getFPS();
  expect(fps).toBeGreaterThan(50);
});

test('no memory leaks across 5 restarts', async ({ gamePage }) => {
  await gamePage.goto();

  const getHeap = () =>
    gamePage.page.evaluate(
      () => (performance as any).memory?.usedJSHeapSize ?? 0,
    );

  await gamePage.waitForScene('GameScene');
  const heapBefore = await getHeap();

  for (let i = 0; i < 5; i++) {
    await gamePage.page.evaluate(() => {
      window.__GAME_STATE__.reset();
      window.__GAME__.scene.start('GameScene');
    });
    await gamePage.waitForScene('GameScene');
    await gamePage.page.waitForTimeout(500);
  }

  const heapAfter = await getHeap();
  // Heap should not grow more than 5MB across restarts
  expect(heapAfter - heapBefore).toBeLessThan(5 * 1024 * 1024);
});
```

**Note:** `performance.memory` is Chromium-only and requires the `--enable-precise-memory-info` flag. Add it to your config's `launchOptions` if you run memory tests:

```typescript
use: {
  launchOptions: {
    args: ['--enable-precise-memory-info'],
  },
},
```

## Mobile-Specific Considerations (Capacitor WebView)

The Playwright tests run in Chromium, not an actual Android WebView. This catches most bugs, but be aware of these differences:

- **Touch events:** Playwright's `tap()` simulates touch correctly for Phaser's pointer events.
- **Viewport:** The Pixel 5 device profile matches the real device viewport. Capacitor's WebView renders at the same dimensions.
- **Performance:** Real device performance is lower than desktop Chromium. If FPS is borderline in tests (50-55), it will likely drop below 30 on low-end phones. Target 55+ FPS in tests.
- **WebView quirks:** Some CSS features behave differently in Android WebView. If a visual regression passes in Playwright but fails on device, that is a real bug to investigate.

Manual testing on a physical device remains necessary before each release. Playwright tests catch regressions between releases.

## What NOT to Test

| Do NOT test | Why |
|-------------|-----|
| Exact pixel positions of game objects | Positions change with responsive scaling. Test state, not coordinates. |
| Audio playback | Playwright cannot verify audio output. Test mute state toggle instead. |
| Phaser internal rendering | Phaser is well-tested. Test your game logic. |
| Subjective visual quality | Use screenshot baselines, not "does it look good" assertions. |
| Exact animation timing | Frame-dependent. Test that state transitions happen, not when. |
| Third-party integrations (AdMob, Firebase) | Mock at the scaffold event boundary. Verify events are emitted, not that AdMob shows an ad. |

## When Adding QA to a Game — Step by Step

1. **Expose testability hooks.** Add `window.__GAME__` and `window.__GAME_STATE__` to `main.ts`.
2. **Create the type declarations.** Add `tests/global.d.ts` with the window augmentation.
3. **Add `playwright.config.ts`.** Copy the config above. Adjust the `webServer.command` and `port` if your dev server differs.
4. **Install dependencies.** `npm install -D @playwright/test && npx playwright install chromium`.
5. **Create the `gamePage` fixture.** Copy `tests/fixtures/gamePage.ts`. Adjust helper methods for your game's specific interactions.
6. **Write the boot test first.** Confirm the game loads and reaches `MenuScene`. If this fails, nothing else matters.
7. **Add gameplay verification.** Write one test that taps a valid target and asserts state changed. This is the highest-value test.
8. **Add the restart test.** Run 3 restarts in a row. This catches 80% of state-leak bugs.
9. **Add visual baselines.** Capture menu and game-over screenshots. Run `--update-snapshots` once, then let CI guard them.
10. **Add performance tests.** Load time and FPS thresholds. Set them generously at first, tighten over time.
11. **Wire into CI.** Add `npx playwright test` to your CI pipeline. Use `retries: 2` in CI for flake tolerance.

## Running Tests

```bash
# Run all tests
npx playwright test

# Run only mobile project
npx playwright test --project=mobile

# Update visual baselines
npx playwright test --update-snapshots

# Run with UI mode for debugging
npx playwright test --ui

# Run a specific test file
npx playwright test tests/e2e/restart.spec.ts
```
