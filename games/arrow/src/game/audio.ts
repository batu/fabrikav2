/**
 * Audio cues — aesthetic A13 (no BGM) + A14 pop + A15 chime + A16 thud.
 *
 * WebAudio synthesis keeps the build small and avoids a third-party
 * SFX dep. The AudioContext is lazy-constructed on the first user
 * gesture so autoplay policies don't fight us.
 */

type CueKind = "pop" | "chime" | "thud";

export class AudioCues {
  private ctx: AudioContext | null = null;
  private muted = false;

  init(): void {
    if (this.ctx) return;
    // Safari / older iOS exposes AudioContext as webkitAudioContext only.
    type WithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      // Some privacy-hardened browsers expose AudioContext but refuse
      // construction. Permanently disable rather than re-throwing into
      // the tap handler every frame.
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  play(kind: CueKind): void {
    if (this.muted) return;
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    switch (kind) {
      case "pop":
        this.tone(880, 0.05, "triangle", 0.25, now);
        this.tone(1320, 0.04, "sine", 0.12, now + 0.01);
        break;
      case "chime":
        this.tone(523.25, 0.25, "sine", 0.18, now);
        this.tone(659.25, 0.35, "sine", 0.14, now + 0.1);
        this.tone(783.99, 0.5, "sine", 0.12, now + 0.2);
        break;
      case "thud":
        this.tone(120, 0.2, "sawtooth", 0.22, now);
        this.tone(80, 0.2, "sine", 0.15, now + 0.02);
        break;
    }
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    startAt: number,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, startAt);
    env.gain.linearRampToValueAtTime(gain, startAt + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(env).connect(this.ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }
}
