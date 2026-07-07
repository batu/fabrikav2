import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MENU_DECOR_BOARD_TILT_DEG,
  MENU_DECOR_CAMERA_YAW_DEG,
  MENU_DECOR_FRAME_SCALE,
} from '../game/menuDecor';
import { buildSagaNodes } from './saga';

/**
 * Saga TOPOLOGY guard: the reference saga is a STRAIGHT vertical line — every
 * node sits on one centre line. packages/ui draws each node with
 *   transform: translateX(var(--node-x))
 * where `--node-x` alternates -offset / +offset for odd / even nodes (the
 * `.current` node is pinned to 0). The game's tokens.css overrides
 * `--fab-levelmap-offset`; setting it to 0 collapses every node's x onto the
 * centre line. This test reads the committed token and reproduces the ui rule
 * so a reverted offset (re-introducing the left/right scatter) fails here.
 */

const TOKENS_CSS = fileURLToPath(new URL('../../design/tokens.css', import.meta.url));

function levelmapOffsetPx(): number {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const match = css.match(/--fab-levelmap-offset:\s*(-?\d+(?:\.\d+)?)px/);
  if (!match) throw new Error('--fab-levelmap-offset not found in tokens.css');
  return Number(match[1]);
}

/** Reproduce packages/ui's per-node translateX given the game's offset token. */
function nodeX(state: string, oneBasedIndex: number, offset: number): number {
  if (state === 'current') return 0; // .fab-levelmap-node.current { --node-x: 0px }
  // `+ 0` normalises the -0 that `-offset` yields when offset === 0 (so signed
  // zero doesn't defeat the Object.is comparison below).
  return (oneBasedIndex % 2 === 1 ? -offset : offset) + 0; // odd -> -offset, even -> +offset
}

describe('saga straight-line topology', () => {
  it('tokens.css zeroes the level-map offset (nodes on one centre line)', () => {
    expect(levelmapOffsetPx()).toBe(0);
  });

  it('every node x-position is equal (straight vertical line)', () => {
    const offset = levelmapOffsetPx();
    for (const unlocked of [1, 5, 10, 20]) {
      const xs = buildSagaNodes(unlocked).map((node, i) => nodeX(node.state, i + 1, offset));
      const first = xs[0];
      for (const x of xs) expect(x).toBe(first);
    }
  });
});

describe('menu board/saga composition constants', () => {
  it('keeps the menu board visibly tilted and smaller than the old upright decor', () => {
    expect(MENU_DECOR_BOARD_TILT_DEG).toBeGreaterThanOrEqual(12);
    expect(MENU_DECOR_CAMERA_YAW_DEG).toBe(75);
    expect(MENU_DECOR_FRAME_SCALE).toBeGreaterThan(1.42);
  });

  it('keeps the current sunburst materially larger than the small medallions', () => {
    const css = readFileSync(TOKENS_CSS, 'utf8');
    const node = Number(css.match(/--fab-levelmap-node-size:\s*(\d+(?:\.\d+)?)px/)?.[1]);
    const current = Number(css.match(/--fab-levelmap-node-current-size:\s*(\d+(?:\.\d+)?)px/)?.[1]);
    if (!Number.isFinite(node) || !Number.isFinite(current)) {
      throw new Error('level-map node size tokens not found in tokens.css');
    }
    expect(current / node).toBeGreaterThan(2);
  });
});
