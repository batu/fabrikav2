import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('menu music contract', () => {
  const source = readFileSync(join(process.cwd(), 'src/audio/AmbientManager.ts'), 'utf8');

  it('uses the exact v1 pentatonic music-box pattern and warm drone', () => {
    expect(source).toContain('523.25, 0, 783.99, 0, 659.25, 0, 0, 880');
    expect(source).toContain('0, 783.99, 0, 659.25, 0, 0, 523.25, 0');
    expect(source).toContain('const MUSIC_BOX_STEP_S = 0.34');
    expect(source).toContain('const MUSIC_BOX_NOTE_GAIN = 0.04');
    expect(source).toContain('const MUSIC_BOX_DRONE_GAIN = 0.018');
    expect(source).toContain('for (const frequency of [130.81, 196.0])');
  });

  it('does not ship or fetch the generic shell-template MP3', () => {
    expect(source).not.toContain('BACKGROUND_MUSIC_URL');
    expect(source).not.toContain('loadBackgroundMusicBuffer');
    expect(existsSync(join(process.cwd(), 'public/audio/background-music.mp3'))).toBe(false);
  });
});
