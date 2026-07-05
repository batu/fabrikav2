import { describe, expect, it } from 'vitest';
import { AUDIO_CHANNELS, Mixer, clampGain } from './mixer.ts';

describe('clampGain', () => {
  it('clamps to the Web Audio 0..1 range (never 0..100)', () => {
    expect(clampGain(-1)).toBe(0);
    expect(clampGain(2)).toBe(1);
    expect(clampGain(0.5)).toBe(0.5);
    expect(clampGain(Number.NaN)).toBe(0);
  });
});

describe('Mixer — mute / volume / duck state machine', () => {
  it('defaults each channel to full, unmuted, un-ducked gain', () => {
    const m = new Mixer();
    for (const ch of AUDIO_CHANNELS) {
      expect(m.effectiveGain(ch)).toBe(1);
      expect(m.isMuted(ch)).toBe(false);
      expect(m.duckDepth(ch)).toBe(0);
    }
  });

  it('setVolume sets the effective gain when unmuted', () => {
    const m = new Mixer();
    m.setVolume('music', 0.5);
    expect(m.getVolume('music')).toBe(0.5);
    expect(m.effectiveGain('music')).toBe(0.5);
  });

  it('setVolume clamps out-of-range inputs', () => {
    const m = new Mixer();
    m.setVolume('sfx', -1);
    expect(m.effectiveGain('sfx')).toBe(0);
    m.setVolume('sfx', 2);
    expect(m.effectiveGain('sfx')).toBe(1);
  });

  it('mute forces effective gain to 0 regardless of volume; unmute restores', () => {
    const m = new Mixer();
    m.setVolume('sfx', 0.8);
    m.setMuted('sfx', true);
    expect(m.effectiveGain('sfx')).toBe(0);
    expect(m.getVolume('sfx')).toBe(0.8); // volume preserved under mute
    m.setMuted('sfx', false);
    expect(m.effectiveGain('sfx')).toBe(0.8);
  });

  it('duck is depth-counted: duck twice + unduck once stays ducked', () => {
    const m = new Mixer();
    m.duck('music', 0); // ad interruption enters
    m.duck('music', 0); // nested interruption enters
    expect(m.duckDepth('music')).toBe(2);
    expect(m.effectiveGain('music')).toBe(0);

    m.unduck('music'); // inner leaves — still ducked
    expect(m.duckDepth('music')).toBe(1);
    expect(m.effectiveGain('music')).toBe(0);

    m.unduck('music'); // outer leaves — restored
    expect(m.duckDepth('music')).toBe(0);
    expect(m.effectiveGain('music')).toBe(1);
  });

  it('over-unduck does not go negative or over-restore', () => {
    const m = new Mixer();
    m.unduck('sfx');
    m.unduck('sfx');
    expect(m.duckDepth('sfx')).toBe(0);
    expect(m.effectiveGain('sfx')).toBe(1);
  });

  it('duck factor multiplies volume (partial duck)', () => {
    const m = new Mixer();
    m.setVolume('music', 0.8);
    m.duck('music', 0.5);
    expect(m.effectiveGain('music')).toBeCloseTo(0.4);
  });

  it('channels are independent — ducking music leaves sfx untouched', () => {
    const m = new Mixer();
    m.duck('music', 0);
    expect(m.effectiveGain('music')).toBe(0);
    expect(m.effectiveGain('sfx')).toBe(1);
  });
});
