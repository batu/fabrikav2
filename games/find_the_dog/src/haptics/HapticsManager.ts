import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { gameState } from '../core/GameState';

/**
 * Thin wrapper around Capacitor's Haptics plugin. Respects the user's
 * haptics setting and stays silent on the web platform — the plugin would
 * otherwise fall back to `navigator.vibrate` which is noisy and inconsistent.
 */

function enabled(): boolean {
  return gameState.settings.hapticsOn && Capacitor.isNativePlatform();
}

export function hapticFound(): void {
  if (!enabled()) return;
  void Haptics.impact({ style: ImpactStyle.Light });
}

export function hapticWrong(): void {
  if (!enabled()) return;
  // Light, not Medium: a miss should feel softer than a find, not like a slap.
  // Keeps the wrong-tap feedback playful rather than punishing.
  void Haptics.impact({ style: ImpactStyle.Light });
}

export function hapticLevelComplete(): void {
  if (!enabled()) return;
  // short-short-long: two quick light taps, then a heavy punctuation.
  // Explicit sequence instead of Haptics.notification({type:Success}) so the
  // pattern reads consistently across Android vendor implementations.
  void Haptics.impact({ style: ImpactStyle.Light });
  window.setTimeout(() => {
    if (!enabled()) return;
    void Haptics.impact({ style: ImpactStyle.Light });
  }, 120);
  window.setTimeout(() => {
    if (!enabled()) return;
    void Haptics.impact({ style: ImpactStyle.Heavy });
  }, 280);
}
