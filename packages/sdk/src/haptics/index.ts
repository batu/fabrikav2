/**
 * Shared haptics wrapper for Fabrika games — carried nearly verbatim from
 * v1 `packages/core/src/haptics/index.ts` (research 04: "core already
 * suffices"; the failure was adoption, not the code). The only addition is
 * `createHaptics` — a gated factory taking an INJECTED `isEnabled`
 * predicate (see below).
 *
 * `@capacitor/haptics` rejects with `CapacitorException UNIMPLEMENTED`
 * on web (not silent resolve) — every caller must avoid that bridge path
 * OR the dev-server / playwright run will be noisy with unhandled
 * rejections. Two-layer safety:
 *
 *   1. `Capacitor.getPlatform() === 'web'` uses `navigator.vibrate` when
 *      present and avoids the Capacitor bridge entirely.
 *   2. try/catch around the awaited call — covers any future native-side
 *      throw (permission denied, plugin missing, etc.) so callers can
 *      always `void safeImpact(...)` without a `.catch` chain.
 *
 * The native enums (`ImpactStyle`, `NotificationType`) are re-exported
 * directly from `@capacitor/haptics` rather than wrapped in a string
 * union — a Capacitor breaking change to enum names then surfaces at
 * compile time, not as a silent runtime mis-call.
 */
import { Capacitor } from '@capacitor/core';
import {
  Haptics,
  ImpactStyle,
  NotificationType,
} from '@capacitor/haptics';

export { ImpactStyle, NotificationType };

type BrowserVibrationPattern = number | number[];
type BrowserVibrationNavigator = {
  vibrate?: (pattern: BrowserVibrationPattern) => boolean;
};

function webImpactPattern(style: ImpactStyle): BrowserVibrationPattern {
  switch (style) {
    case ImpactStyle.Heavy:
      return 36;
    case ImpactStyle.Medium:
      return 24;
    case ImpactStyle.Light:
    default:
      return 12;
  }
}

function webNotificationPattern(type: NotificationType): BrowserVibrationPattern {
  switch (type) {
    case NotificationType.Error:
      return [36, 35, 36];
    case NotificationType.Warning:
      return [24, 40, 24];
    case NotificationType.Success:
    default:
      return [12, 40, 24];
  }
}

function vibrateOnWeb(pattern: BrowserVibrationPattern): void {
  const maybeNavigator: BrowserVibrationNavigator | undefined =
    typeof globalThis.navigator === 'undefined'
      ? undefined
      : (globalThis.navigator as BrowserVibrationNavigator);
  maybeNavigator?.vibrate?.(pattern);
}

export async function safeImpact(
  style: ImpactStyle = ImpactStyle.Light,
): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    vibrateOnWeb(webImpactPattern(style));
    return;
  }
  try {
    await Haptics.impact({ style });
  } catch {
    // Swallow — caller fired-and-forgot; no unhandled rejection.
  }
}

export async function safeNotification(
  type: NotificationType = NotificationType.Success,
): Promise<void> {
  if (Capacitor.getPlatform() === 'web') {
    vibrateOnWeb(webNotificationPattern(type));
    return;
  }
  try {
    await Haptics.notification({ type });
  } catch {
    // Swallow — caller fired-and-forgot; no unhandled rejection.
  }
}

/**
 * Gated, fire-and-forget haptics — the one adaptation over the v1 carry.
 *
 * v1's 3-of-4 games each wrote their own haptics BEFORE the core module
 * existed, then never migrated. FTD's `HapticsManager` was the closest to
 * shareable, but it gated every call on `gameState.settings.hapticsOn` and
 * hard-imported `../core/GameState` — that coupling is exactly why its gate
 * could not be reused. Here the gate stays, but the predicate is INJECTED:
 * the game passes `{ isEnabled: () => settings.hapticsOn }` (and folds in
 * `Capacitor.isNativePlatform()` itself if it wants native-only, as FTD
 * did — that is a per-game policy, not an SDK concern).
 *
 * Multi-beat sequences (FTD's short-short-long level-complete) deliberately
 * do NOT live here — those belong at call sites (research 04). The SDK
 * ships gated primitives; games compose rhythms.
 */
export interface GatedHaptics {
  /** Fire an impact; no-ops when `isEnabled()` returns false. */
  impact(style?: ImpactStyle): void;
  /** Fire a notification; no-ops when `isEnabled()` returns false. */
  notification(type?: NotificationType): void;
}

export interface CreateHapticsOptions {
  /**
   * Read PER CALL — toggling the underlying setting mid-session flips
   * behavior without re-creating the instance. Not captured once.
   */
  isEnabled: () => boolean;
}

export function createHaptics(opts: CreateHapticsOptions): GatedHaptics {
  return {
    impact(style: ImpactStyle = ImpactStyle.Light): void {
      if (!opts.isEnabled()) return;
      void safeImpact(style);
    },
    notification(type: NotificationType = NotificationType.Success): void {
      if (!opts.isEnabled()) return;
      void safeNotification(type);
    },
  };
}
