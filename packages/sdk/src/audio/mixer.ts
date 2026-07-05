/**
 * Pure per-channel gain state machine — the testable core of `AudioBus`.
 *
 * Deliberately free of any Web Audio dependency so the mute/volume/duck
 * behavior the AC unit-tests runs WITHOUT a real `AudioContext` (no jsdom
 * Web Audio, no fakes). The `AudioBus` layers thin GainNode wiring over
 * this; every gain decision is made here as arithmetic.
 *
 * Effective gain is the single source of truth:
 *
 *     effectiveGain = muted ? 0 : volume * duckFactor
 *
 * where `volume` is a clamped 0..1 scale and `duckFactor` is the current
 * DEPTH-COUNTED duck attenuation — directly generalizing FTD's
 * `adMusicPauseDepth` (the only real "duck" in v1: a balanced-nesting
 * hard-mute of master during ad interruptions, NOT sfx-under-music).
 * Mute and volume are ORTHOGONAL, so a binary-only game (FTD toggles
 * gains 0/1) and a future volume slider both fall out of the same state.
 */

export type AudioChannel = 'music' | 'sfx';

export const AUDIO_CHANNELS: readonly AudioChannel[] = ['music', 'sfx'];

/** Clamp any gain into the Web Audio 0..1 range (never 0..100). */
export function clampGain(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

interface ChannelState {
  volume: number;
  muted: boolean;
  /**
   * Stack of duck gains — one entry per un-balanced `duck()`. The active
   * duck factor is the top of the stack (the most recent, tightest
   * attenuation an interruption imposed); an empty stack means no duck.
   */
  duckStack: number[];
}

function initialChannelState(): ChannelState {
  return { volume: 1, muted: false, duckStack: [] };
}

export class Mixer {
  private readonly channels: Record<AudioChannel, ChannelState> = {
    music: initialChannelState(),
    sfx: initialChannelState(),
  };

  setVolume(channel: AudioChannel, volume: number): void {
    this.channels[channel].volume = clampGain(volume);
  }

  getVolume(channel: AudioChannel): number {
    return this.channels[channel].volume;
  }

  setMuted(channel: AudioChannel, muted: boolean): void {
    this.channels[channel].muted = muted;
  }

  isMuted(channel: AudioChannel): boolean {
    return this.channels[channel].muted;
  }

  /** Push a depth-counted duck. Balanced by exactly one `unduck`. */
  duck(channel: AudioChannel, toGain: number): void {
    this.channels[channel].duckStack.push(clampGain(toGain));
  }

  /** Pop one duck level. Over-unducking is a no-op (never goes negative). */
  unduck(channel: AudioChannel): void {
    this.channels[channel].duckStack.pop();
  }

  /** Current duck nesting depth for the channel (0 when not ducked). */
  duckDepth(channel: AudioChannel): number {
    return this.channels[channel].duckStack.length;
  }

  /** The active duck attenuation (1 when not ducked). */
  duckFactor(channel: AudioChannel): number {
    const stack = this.channels[channel].duckStack;
    return stack.length === 0 ? 1 : stack[stack.length - 1];
  }

  /** muted ? 0 : volume * duckFactor — the value a channel gain node holds. */
  effectiveGain(channel: AudioChannel): number {
    const state = this.channels[channel];
    if (state.muted) return 0;
    return state.volume * this.duckFactor(channel);
  }
}
