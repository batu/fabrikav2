import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the 2026-09-10 iPhone memory kill (fabrikav2 PR #69).
 *
 * Phaser pre-allocates the Pre FX render-target ladder at boot (three targets
 * per 32px step up to the shorter canvas edge, plus three full-frame targets,
 * each with a depth-stencil buffer). On an iPhone 12 that was ~625 MB of GPU
 * memory before any level loaded, and WebKit killed the game process on the
 * first level. `disablePreFX: true` removes the ladder.
 *
 * With Pre FX disabled Phaser still hands every Game Object a `preFX`
 * controller, so any `preFX.add*` call routes the object to a pipeline that
 * does not exist and throws inside render, which stops the animation loop
 * (pickups stuck, completion card never shown). So no source may touch
 * `.preFX` at all; `?.` guards do not help.
 */
const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('Phaser Pre FX guard', () => {
  it('keeps the Pre FX render-target ladder disabled in the game config', () => {
    const config = readFileSync(join(SRC, 'core', 'GameConfig.ts'), 'utf8');
    expect(config).toMatch(/^\s*disablePreFX:\s*true,\s*$/m);
  });

  it('never references a Game Object preFX controller anywhere in src', () => {
    const offenders = walk(SRC)
      .map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n') }))
      .flatMap(({ file, lines }) => lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /\.preFX\b/.test(line) && !/^\s*(\/\/|\*)/.test(line))
        .map(({ index }) => `${file.replace(process.cwd(), '.')}:${index + 1}`));
    expect(offenders).toEqual([]);
  });
});
