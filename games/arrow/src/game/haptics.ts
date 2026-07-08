/**
 * Haptics — @capacitor/haptics wrapper that no-ops on the web.
 *
 * Specimen A14 (pop) + A16 (thud) + A15 (chime) all want a tactile
 * counterpart on device. Called alongside the audio cues in loop.ts.
 */

export type HapticCue = "tap" | "collide" | "level-complete";

let warned = false;
// Cache the dynamic-import promise so rapid taps don't all independently
// trigger a module resolution — browser dedupes the network but we
// avoid allocating one per call.
let modPromise: Promise<typeof import("@capacitor/haptics")> | null = null;

function getHapticsModule(): Promise<typeof import("@capacitor/haptics")> {
  if (modPromise !== null) return modPromise;
  modPromise = import("@capacitor/haptics");
  return modPromise;
}

export async function haptic(cue: HapticCue): Promise<void> {
  try {
    const { Haptics, ImpactStyle, NotificationType } = await getHapticsModule();
    switch (cue) {
      case "tap":
        await Haptics.impact({ style: ImpactStyle.Light });
        break;
      case "collide":
        await Haptics.impact({ style: ImpactStyle.Medium });
        break;
      case "level-complete":
        await Haptics.notification({ type: NotificationType.Success });
        break;
    }
  } catch (e) {
    if (!warned) {
      console.info("[arrow] haptics unavailable (likely web context):", (e as Error).message);
      warned = true;
    }
  }
}
