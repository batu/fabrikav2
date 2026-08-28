import { describe, expect, it, vi } from 'vitest';
import { forceCrashForVerification, readCrashlyticsState } from './crashlytics-probe.ts';

const plugin = () => ({ crash: vi.fn(), log: vi.fn(), isEnabled: vi.fn(async () => ({ enabled: true })), didCrashOnPreviousExecution: vi.fn(async () => ({ crashed: true })), sendUnsentReports: vi.fn() });
describe('Crashlytics verification probe', () => {
  it('reads bounded state lazily', async () => { const p = plugin(); expect(await readCrashlyticsState(async () => ({ FirebaseCrashlytics: p }))).toEqual({ enabled: true, crashedLastRun: true }); });
  it('refuses deliberate crashes outside test builds', async () => { const p = plugin(); await expect(forceCrashForVerification(async () => ({ FirebaseCrashlytics: p }), false, 'marker')).rejects.toThrow(/unavailable/); expect(p.crash).not.toHaveBeenCalled(); });
  it('logs a marker before the explicit test crash', async () => { const p = plugin(); await forceCrashForVerification(async () => ({ FirebaseCrashlytics: p }), true, 'marker'); expect(p.log).toHaveBeenCalledWith({ message: 'marker' }); expect(p.crash).toHaveBeenCalledWith({ message: 'marker' }); });
});
