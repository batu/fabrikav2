// Animations feature adapter: sprite animation leaves the v1 blocking POST +
// per-session JSON mini-ledger behind. The start is a durable POST and all
// progress/preview state is the Job, its events, and its opaque artifacts.

import {
  type DurableStart,
  type DurableStartContext,
  startDurable,
} from '../wizard/durableStarts.ts';

export function startSpriteAnimation(
  context: DurableStartContext,
  inputs: {
    dogId: string;
    sourceCandidateId: string;
    motionPreset?: string;
    customPrompt?: string;
    durationSeconds?: number;
    fps?: number;
  },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.sprite_animate', inputs);
}
