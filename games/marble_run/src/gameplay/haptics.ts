/**
 * Haptics adapter for the ported gameplay slice. v1 called
 * `@fabrika/core/haptics` (`safeImpact`/`safeNotification` + the `ImpactStyle`/
 * `NotificationType` enums). That workspace package does not exist in
 * fabrikav2, so this thin adapter reproduces the same surface on top of
 * `@capacitor/haptics`, staying silent on web (where the plugin would fall
 * back to a noisy `navigator.vibrate`). Call sites in GameplayController are
 * left identical to v1 App.ts.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export { ImpactStyle, NotificationType };

function native(): boolean {
  return Capacitor.isNativePlatform();
}

export async function safeImpact(style: ImpactStyle): Promise<void> {
  if (!native()) return;
  try {
    await Haptics.impact({ style });
  } catch {
    // Haptics are best-effort; a failure must never break gameplay.
  }
}

export async function safeNotification(type: NotificationType): Promise<void> {
  if (!native()) return;
  try {
    await Haptics.notification({ type });
  } catch {
    // Best-effort; ignore.
  }
}
