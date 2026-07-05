import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const impactSpy = vi.fn(async (_opts: { style: string }) => undefined);
const notificationSpy = vi.fn(async (_opts: { type: string }) => undefined);
const vibrateSpy = vi.fn((_pattern: number | number[]) => true);
let platform: 'web' | 'android' | 'ios' = 'web';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform,
    isNativePlatform: () => platform !== 'web',
  },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: (opts: { style: string }) => impactSpy(opts),
    notification: (opts: { type: string }) => notificationSpy(opts),
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

import {
  createHaptics,
  ImpactStyle,
  NotificationType,
  safeImpact,
  safeNotification,
} from './index.ts';

beforeEach(() => {
  impactSpy.mockClear();
  notificationSpy.mockClear();
  vibrateSpy.mockClear();
  impactSpy.mockImplementation(async () => undefined);
  notificationSpy.mockImplementation(async () => undefined);
  platform = 'web';
});

afterEach(() => {
  platform = 'web';
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Carried v1 behavior — the two-layer web/native safety must survive the port.
// ---------------------------------------------------------------------------
describe('safeImpact (carried v1 behavior)', () => {
  it('on web: uses browser vibration fallback, plugin NOT called', async () => {
    platform = 'web';
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    await safeImpact(ImpactStyle.Medium);
    expect(impactSpy).not.toHaveBeenCalled();
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
    expect(vibrateSpy).toHaveBeenCalledWith(24);
  });

  it('on web: maps light and heavy to distinct vibration strengths', async () => {
    platform = 'web';
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    await safeImpact(ImpactStyle.Light);
    expect(vibrateSpy).toHaveBeenLastCalledWith(12);
    await safeImpact(ImpactStyle.Heavy);
    expect(vibrateSpy).toHaveBeenLastCalledWith(36);
    expect(impactSpy).not.toHaveBeenCalled();
  });

  it('on web without Vibration API: resolves without calling the plugin', async () => {
    platform = 'web';
    vi.stubGlobal('navigator', {});
    await expect(safeImpact(ImpactStyle.Light)).resolves.toBeUndefined();
    expect(impactSpy).not.toHaveBeenCalled();
    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it('on android: calls Haptics.impact with the passed style', async () => {
    platform = 'android';
    await safeImpact(ImpactStyle.Medium);
    expect(impactSpy).toHaveBeenCalledTimes(1);
    expect(impactSpy).toHaveBeenCalledWith({ style: 'MEDIUM' });
  });

  it('on android with default arg: passes ImpactStyle.Light', async () => {
    platform = 'android';
    await safeImpact();
    expect(impactSpy).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('on android with rejecting plugin: caller promise still resolves', async () => {
    platform = 'android';
    impactSpy.mockImplementationOnce(async () => {
      throw new Error('UNIMPLEMENTED');
    });
    await expect(safeImpact(ImpactStyle.Light)).resolves.toBeUndefined();
  });

  it('on ios: routes through to Haptics.impact ("web" is the only early-return)', async () => {
    // Pins the contract that the early-return is "web" exactly, not
    // "anything except android" — a regression to !== 'android' would
    // silently disable iOS haptics with no other test catching it.
    platform = 'ios';
    await safeImpact(ImpactStyle.Light);
    expect(impactSpy).toHaveBeenCalledTimes(1);
  });
});

describe('safeNotification (carried v1 behavior)', () => {
  it('on web: uses browser vibration fallback, plugin NOT called', async () => {
    platform = 'web';
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    await safeNotification(NotificationType.Error);
    expect(notificationSpy).not.toHaveBeenCalled();
    expect(vibrateSpy).toHaveBeenCalledWith([36, 35, 36]);
  });

  it('on web: maps success and warning to distinct patterns', async () => {
    platform = 'web';
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    await safeNotification(NotificationType.Success);
    expect(vibrateSpy).toHaveBeenLastCalledWith([12, 40, 24]);
    await safeNotification(NotificationType.Warning);
    expect(vibrateSpy).toHaveBeenLastCalledWith([24, 40, 24]);
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('on android: calls Haptics.notification with the passed type', async () => {
    platform = 'android';
    await safeNotification(NotificationType.Warning);
    expect(notificationSpy).toHaveBeenCalledWith({ type: 'WARNING' });
  });
});

// ---------------------------------------------------------------------------
// The one adaptation — the injected-predicate gate (AC: haptics gating).
// ---------------------------------------------------------------------------
describe('createHaptics — injected-predicate gate', () => {
  it('isEnabled() false: impact/notification fire NO vibrate and NO bridge call', () => {
    platform = 'web';
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    const h = createHaptics({ isEnabled: () => false });
    h.impact(ImpactStyle.Heavy);
    h.notification(NotificationType.Error);
    expect(vibrateSpy).not.toHaveBeenCalled();
    expect(impactSpy).not.toHaveBeenCalled();
    expect(notificationSpy).not.toHaveBeenCalled();
  });

  it('isEnabled() true on web: impact vibrates with the mapped pattern', async () => {
    platform = 'web';
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    const h = createHaptics({ isEnabled: () => true });
    h.impact(ImpactStyle.Medium);
    await Promise.resolve(); // let the fire-and-forget safeImpact settle
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
    expect(vibrateSpy).toHaveBeenCalledWith(24);
  });

  it('predicate is read PER CALL — toggling it mid-session flips behavior', async () => {
    platform = 'web';
    vi.stubGlobal('navigator', { vibrate: vibrateSpy });
    let on = false;
    const h = createHaptics({ isEnabled: () => on });
    h.impact(ImpactStyle.Light);
    await Promise.resolve();
    expect(vibrateSpy).not.toHaveBeenCalled(); // gated off

    on = true;
    h.impact(ImpactStyle.Light);
    await Promise.resolve();
    expect(vibrateSpy).toHaveBeenCalledTimes(1); // now fires — not captured once
  });

  it('isEnabled() true on native: delegates through to the plugin', async () => {
    platform = 'android';
    const h = createHaptics({ isEnabled: () => true });
    h.notification(NotificationType.Success);
    await Promise.resolve();
    expect(notificationSpy).toHaveBeenCalledWith({ type: 'SUCCESS' });
  });

  it('enum re-exports are stable and importable from the subpath', () => {
    expect(ImpactStyle.Light).toBe('LIGHT');
    expect(ImpactStyle.Medium).toBe('MEDIUM');
    expect(ImpactStyle.Heavy).toBe('HEAVY');
    expect(NotificationType.Success).toBe('SUCCESS');
  });
});
