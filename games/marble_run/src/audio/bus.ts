/**
 * Shared v2 AudioBus for Marble Run. Replaces v1's per-module AudioContext +
 * masterGain: the SDK bus owns the AudioContext and the music/sfx channel
 * graph, and Sfx.ts / Music.ts register their procedural voices onto it.
 */
import { createAudioBus } from '@fabrikav2/sdk/audio';

/** The single mixing bus every Marble Run sound routes through. */
export const audioBus = createAudioBus();

/** Resume the context from the first user gesture (autoplay policy). Idempotent. */
export function unlockAudio(): void {
  void audioBus.unlock();
}
