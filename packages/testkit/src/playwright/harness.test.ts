import { afterEach, describe, expect, test } from 'vitest';

import { callHarness, pollHarness, readHarness, waitForHarness } from './harness.ts';

type MockWindow = Record<string, unknown>;

type MockPage = {
  evaluate: <TResult, TArg>(
    pageFunction: (arg: TArg) => TResult | Promise<TResult>,
    arg: TArg,
  ) => Promise<TResult>;
  waitForFunction: <TArg>(
    pageFunction: (arg: TArg) => boolean,
    arg: TArg,
    options?: { timeout?: number },
  ) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
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

function createMockPage(
  mockWindow: MockWindow,
  onWait?: (ms: number) => void,
): MockPage {
  return {
    async evaluate<TResult, TArg>(
      pageFunction: (arg: TArg) => TResult | Promise<TResult>,
      arg: TArg,
    ): Promise<TResult> {
      const browserFunction = new Function(`return (${pageFunction.toString()});`)() as (
        value: TArg,
      ) => TResult | Promise<TResult>;
      return await withWindow(mockWindow, () => browserFunction(arg));
    },
    async waitForFunction<TArg>(
      pageFunction: (arg: TArg) => boolean,
      arg: TArg,
      options?: { timeout?: number },
    ): Promise<void> {
      const timeoutMs = options?.timeout ?? 1_000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const browserFunction = new Function(`return (${pageFunction.toString()});`)() as (
          value: TArg,
        ) => boolean;
        const done = withWindow(mockWindow, () => browserFunction(arg));
        if (done) {
          return;
        }
        onWait?.(10);
      }
      throw new Error(`Timed out after ${timeoutMs}ms`);
    },
    async waitForTimeout(ms: number): Promise<void> {
      onWait?.(ms);
    },
  };
}

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, 'window');
});

describe('waitForHarness', () => {
  test('waits until the window harness reports ready', async () => {
    const mockWindow: MockWindow = {};
    let waitCount = 0;
    const page = createMockPage(mockWindow, () => {
      waitCount += 1;
      if (waitCount === 2) {
        mockWindow.__HARNESS__ = { ready: true };
      }
    });

    await waitForHarness(
      page,
      '__HARNESS__',
      (harness: { ready: boolean }): boolean => harness.ready,
      100,
    );

    expect(mockWindow.__HARNESS__).toEqual({ ready: true });
  });
});

describe('readHarness', () => {
  test('throws a clear error when the harness key is missing', async () => {
    const page = createMockPage({});

    await expect(readHarness(
      page,
      '__MISSING__',
      (harness: { ready: boolean }): boolean => harness.ready,
    )).rejects.toThrow('Harness "__MISSING__" is not available on window.');
  });
});

describe('callHarness', () => {
  test('calls a harness method with serializable args', async () => {
    const page = createMockPage({
      __HARNESS__: {
        add(left: number, right: number): number {
          return left + right;
        },
      },
    });

    const result = await callHarness(
      page,
      '__HARNESS__',
      (harness: { add(left: number, right: number): number }, arg: { left: number; right: number }): number => {
        return harness.add(arg.left, arg.right);
      },
      { left: 4, right: 7 },
    );

    expect(result).toBe(11);
  });
});

describe('pollHarness', () => {
  test('polls a harness value until a predicate passes', async () => {
    const mockWindow: MockWindow = {
      __HARNESS__: { count: 0 },
    };
    const page = createMockPage(mockWindow, () => {
      const harness = mockWindow.__HARNESS__ as { count: number };
      harness.count += 1;
    });

    const result = await pollHarness(
      page,
      '__HARNESS__',
      (harness: { count: number }): number => harness.count,
      (value: number): boolean => value >= 3,
      100,
      1,
    );

    expect(result).toBe(3);
  });
});
