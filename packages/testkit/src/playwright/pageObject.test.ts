import { afterEach, describe, expect, test } from 'vitest';

import { gotoAndWaitForHarness, waitForSceneActive } from './pageObject.ts';

type MockWindow = Record<string, unknown>;

type SerializedWaitPage = {
  goto: (url: string) => Promise<void>;
  waitForFunction: <TArg>(
    pageFunction: (arg: TArg) => unknown,
    arg: TArg,
    options?: { timeout?: number },
  ) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  lastGoto: string | null;
};

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function withWindow<TResult>(mockWindow: MockWindow, run: () => TResult): TResult {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: mockWindow,
  });

  try {
    return run();
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

function evaluateInBrowser<TResult, TArg>(
  mockWindow: MockWindow,
  pageFunction: (arg: TArg) => TResult,
  arg: TArg,
): TResult {
  const browserFunction = new Function(`return (${pageFunction.toString()});`)() as (value: TArg) => TResult;
  return withWindow(mockWindow, () => browserFunction(arg));
}

function createSerializedPage(
  mockWindow: MockWindow,
  onPoll?: (pollCount: number) => void,
): SerializedWaitPage {
  let pollCount = 0;

  return {
    lastGoto: null,
    async goto(url: string): Promise<void> {
      this.lastGoto = url;
    },
    async waitForFunction<TArg>(
      pageFunction: (arg: TArg) => unknown,
      arg: TArg,
      options?: { timeout?: number },
    ): Promise<void> {
      const timeoutMs = options?.timeout ?? 1_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        pollCount += 1;
        onPoll?.(pollCount);
        if (evaluateInBrowser(mockWindow, pageFunction, arg)) {
          return;
        }
      }

      throw new Error(`Timed out after ${timeoutMs}ms`);
    },
    async waitForTimeout(): Promise<void> {},
  };
}

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, 'window');
});

describe('gotoAndWaitForHarness', () => {
  test('navigates before waiting for the harness to become ready', async () => {
    const page = createSerializedPage({
      __HARNESS__: { enabled: true },
    });

    await gotoAndWaitForHarness(
      page,
      '/play',
      {
        windowKey: '__HARNESS__',
        readyCheck: (harness: { enabled: boolean }): boolean => harness.enabled,
      },
    );

    expect(page.lastGoto).toBe('/play');
  });
});

describe('waitForSceneActive', () => {
  test('waits for an active scene using the provided game window key', async () => {
    const page = createSerializedPage({
      __GAME__: {
        scene: {
          isActive: (key: string): boolean => key === 'GameScene',
        },
      },
    });

    await expect(waitForSceneActive(page, '__GAME__', 'GameScene')).resolves.toBeUndefined();
  });

  test('throws a clear error when the expected scene never becomes active', async () => {
    const page = createSerializedPage({
      __GAME__: {
        scene: {
          isActive: (): boolean => false,
        },
      },
    });

    await expect(waitForSceneActive(page, '__GAME__', 'GameScene', 5)).rejects.toThrow(
      'Timed out after 5ms waiting for scene "GameScene" on "__GAME__".',
    );
  });
});
