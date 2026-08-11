import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crashlyticsStatus,
  enableCrashlyticsCollection,
  forceCrash,
  readCrashlyticsState,
  resetCrashlyticsStatus,
  sendUnsentCrashReports,
  type CrashlyticsLoader,
} from '../../src/devtools/crashlyticsProbe';

function fakePlugin(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const FirebaseCrashlytics = {
    crash: vi.fn(async () => { calls.push('crash'); }),
    log: vi.fn(async () => { calls.push('log'); }),
    setEnabled: vi.fn(async () => { calls.push('setEnabled'); }),
    isEnabled: vi.fn(async () => ({ enabled: true })),
    didCrashOnPreviousExecution: vi.fn(async () => ({ crashed: false })),
    sendUnsentReports: vi.fn(async () => { calls.push('sendUnsentReports'); }),
    ...overrides,
  };
  const load: CrashlyticsLoader = async () => ({ FirebaseCrashlytics } as never);
  return { FirebaseCrashlytics, load, calls };
}

describe('crashlyticsProbe', () => {
  beforeEach(() => {
    resetCrashlyticsStatus();
  });

  it('logs the marker breadcrumb before crashing so the report is identifiable', async () => {
    const { FirebaseCrashlytics, load, calls } = fakePlugin();

    const marker = await forceCrash(load);

    expect(calls).toEqual(['log', 'crash']);
    expect(marker).toContain('sdk_verifier_forced_crash');
    expect(FirebaseCrashlytics.log).toHaveBeenCalledWith({ message: marker });
    expect(FirebaseCrashlytics.crash).toHaveBeenCalledWith({ message: marker });
  });

  it('reports collection state and whether the previous run crashed', async () => {
    const { load } = fakePlugin({
      isEnabled: vi.fn(async () => ({ enabled: true })),
      didCrashOnPreviousExecution: vi.fn(async () => ({ crashed: true })),
    });

    expect(await readCrashlyticsState(load)).toBe('collection true / crashed last run: true');
    expect(crashlyticsStatus()).toBe('collection true / crashed last run: true');
  });

  it('still reports the crashed-last-run answer when isEnabled is unavailable', async () => {
    const { load } = fakePlugin({
      isEnabled: vi.fn(async () => { throw new Error('not implemented on android'); }),
      didCrashOnPreviousExecution: vi.fn(async () => ({ crashed: true })),
    });

    expect(await readCrashlyticsState(load)).toBe('collection unavailable (android) / crashed last run: true');
  });

  it('says enabling collection only applies from the next launch', async () => {
    const { FirebaseCrashlytics, load } = fakePlugin();

    expect(await enableCrashlyticsCollection(load)).toContain('next launch');
    expect(FirebaseCrashlytics.setEnabled).toHaveBeenCalledWith({ enabled: true });
  });

  it('queues unsent reports for upload', async () => {
    const { FirebaseCrashlytics, load } = fakePlugin();

    expect(await sendUnsentCrashReports(load)).toContain('queued');
    expect(FirebaseCrashlytics.sendUnsentReports).toHaveBeenCalledOnce();
  });
});
