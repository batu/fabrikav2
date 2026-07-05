import { waitForHarness, type WaitPage } from './harness.ts';

type BrowserGame = {
  scene?: {
    isActive?: (sceneKey: string) => boolean;
  };
};

type SceneWaitPayload = {
  gameWindowKey: string;
  sceneKey: string;
};

export type NavigableWaitPage = WaitPage & {
  goto(url: string): Promise<unknown>;
};

export async function gotoAndWaitForHarness<THarness>(
  page: NavigableWaitPage,
  path: string,
  options: {
    windowKey: string;
    readyCheck: (harness: THarness) => boolean;
    timeoutMs?: number;
  },
): Promise<void> {
  await page.goto(path);
  await waitForHarness(page, options.windowKey, options.readyCheck, options.timeoutMs);
}

export async function waitForSceneActive(
  page: WaitPage,
  windowGameKey: string,
  sceneKey: string,
  timeoutMs: number = 10_000,
): Promise<void> {
  try {
    await page.waitForFunction(
      ({ gameWindowKey, sceneKey: expectedScene }: SceneWaitPayload): boolean => {
        const game = (window as unknown as Record<string, unknown>)[gameWindowKey] as BrowserGame | undefined;
        return typeof game?.scene?.isActive === 'function' && Boolean(game.scene.isActive(expectedScene));
      },
      {
        gameWindowKey: windowGameKey,
        sceneKey,
      },
      { timeout: timeoutMs },
    );
  } catch {
    throw new Error(`Timed out after ${timeoutMs}ms waiting for scene "${sceneKey}" on "${windowGameKey}".`);
  }
}
