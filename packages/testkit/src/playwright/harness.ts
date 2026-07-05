export type EvaluatePage = {
  evaluate<TResult, TArg>(
    pageFunction: (arg: TArg) => TResult | Promise<TResult>,
    arg: TArg,
  ): Promise<TResult>;
};

export type WaitPage = {
  waitForFunction<TArg>(
    pageFunction: (arg: TArg) => unknown,
    arg: TArg,
    options?: { timeout?: number },
  ): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
};

type HarnessPage = EvaluatePage & WaitPage;

type CallbackPayload<TArg> = {
  arg: TArg;
  source: string;
  windowKey: string;
};

export async function waitForHarness<THarness>(
  page: WaitPage,
  windowKey: string,
  readyCheck: (harness: THarness) => boolean,
  timeoutMs: number = 10_000,
): Promise<void> {
  try {
    await page.waitForFunction(
      ({ source, windowKey: key }: CallbackPayload<undefined>): boolean => {
        const harness = (window as unknown as Record<string, unknown>)[key];
        if (harness === undefined || harness === null) {
          return false;
        }
        const ready = new Function(`return (${source});`)() as (value: THarness) => boolean;
        return Boolean(ready(harness as THarness));
      },
      {
        arg: undefined,
        source: readyCheck.toString(),
        windowKey,
      },
      { timeout: timeoutMs },
    );
  } catch {
    throw new Error(`Timed out after ${timeoutMs}ms waiting for harness "${windowKey}" to become ready.`);
  }
}

export async function readHarness<THarness, TResult>(
  page: EvaluatePage,
  windowKey: string,
  reader: (harness: THarness) => TResult,
): Promise<TResult> {
  return page.evaluate(
    ({ source, windowKey: key }: CallbackPayload<undefined>): TResult => {
      const harness = (window as unknown as Record<string, unknown>)[key];
      if (harness === undefined || harness === null) {
        throw new Error(`Harness "${key}" is not available on window.`);
      }
      const read = new Function(`return (${source});`)() as (value: THarness) => TResult;
      return read(harness as THarness);
    },
    {
      arg: undefined,
      source: reader.toString(),
      windowKey,
    },
  );
}

export async function callHarness<THarness, TArg, TResult>(
  page: EvaluatePage,
  windowKey: string,
  action: (harness: THarness, arg: TArg) => TResult,
  arg: TArg,
): Promise<TResult> {
  return page.evaluate(
    ({ arg: callbackArg, source, windowKey: key }: CallbackPayload<TArg>): TResult => {
      const harness = (window as unknown as Record<string, unknown>)[key];
      if (harness === undefined || harness === null) {
        throw new Error(`Harness "${key}" is not available on window.`);
      }
      const execute = new Function(`return (${source});`)() as (args: [THarness, TArg]) => TResult;
      return execute([harness as THarness, callbackArg] as [THarness, TArg]);
    },
    {
      arg,
      source: `([harness, arg]) => (${action.toString()})(harness, arg)`,
      windowKey,
    },
  );
}

export async function pollHarness<THarness, TResult>(
  page: HarnessPage,
  windowKey: string,
  reader: (harness: THarness) => TResult,
  predicate: (value: TResult) => boolean,
  timeoutMs: number,
  intervalMs: number = 250,
): Promise<TResult> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: TResult | null = null;

  while (Date.now() < deadline) {
    const value = await readHarness(page, windowKey, reader);
    lastValue = value;
    if (predicate(value)) {
      return value;
    }
    await page.waitForTimeout(intervalMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for harness "${windowKey}" condition.` +
      (lastValue === null ? '' : ` Last value: ${JSON.stringify(lastValue)}`),
  );
}
