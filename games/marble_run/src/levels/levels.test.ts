import { describe, expect, it } from 'vitest';
import { BoardEngine } from '../marble-board/board';
import { scoreLevel } from '../marble-board/score';
import { analyzeDifficulty, solveLevel } from '../marble-board/solver';
import { gateColorsCovered, mirrorDistance, MIN_ASYMMETRIC_DISTANCE } from '../marble-board/generate';
import { CHAR_TO_COLOR, gateMouthCell, type Cell } from '../marble-board/types';
import { effectiveTargetFor, marbleCapFor, targetFor } from './funnel-schedule';
import { LEVEL_MANIFEST } from './levels.manifest.generated';
import { LEVELS } from './levels.generated';

/**
 * The generator searches seeds against `effectiveTargetFor`, but the manifest
 * records the nominal `targetFor` (generate-levels.ts:148,218 vs :241). Those
 * diverge on climax/spotlight slots, so the difficulty assertion below must
 * compare against the target the board was actually tuned to — comparing
 * against `manifest.target` would fail 2/110 correct levels (L12, L87).
 */
const DIFFICULTY_TOLERANCE = 2;

const LEGAL_CHARS = new Set(['.', '#', 'X', ...Object.keys(CHAR_TO_COLOR)]);

describe('generated level set', () => {
  it('has 110 levels with sequential ids', () => {
    expect(LEVELS.length).toBe(110);
    LEVELS.forEach((lvl, i) => expect(lvl.id).toBe(i + 1));
  });

  it('manifest tells the truth about what each board actually contains', () => {
    // buildShape silently degrades to `plain` below 6x6, so a manifest entry
    // claiming a sculpted kind on a board with no voids AND no plugs would be
    // a lie — and the plugs/voids teach pins would never visibly fire.
    expect(LEVEL_MANIFEST.length).toBe(LEVELS.length);
    for (const entry of LEVEL_MANIFEST) {
      const lvl = LEVELS[entry.id - 1]!;
      const board = lvl.cells.join('');
      const sculpted = board.includes('#') || board.includes('X');
      if (entry.shapeKind !== 'plain') {
        expect(sculpted, `level ${entry.id} claims ${entry.shapeKind} but board is unsculpted`).toBe(true);
      }
    }
  });

  it('the plugs and voids teach pins actually fire on their debut levels', () => {
    // MRB-7 pin retune: voids 12 -> 6, plugs 9 -> 8 (see TEACH_PINS).
    expect(LEVELS[5]!.cells.join('')).toContain('#'); // level 6 = voids debut
    expect(LEVELS[7]!.cells.join('')).toContain('X'); // level 8 = plugs debut
  });

  it('no element appears before its debut level', () => {
    for (const lvl of LEVELS.slice(0, 5)) expect(lvl.cells.join('')).not.toContain('#');
    for (const lvl of LEVELS.slice(0, 7)) expect(lvl.cells.join('')).not.toContain('X');
  });

  it('no level has an orphan gate (MRB-7 hard invariant)', () => {
    // A gate whose color has zero marbles on the board is unreachable
    // decoration — it reads as a puzzle element the player can never use.
    for (const lvl of LEVELS) {
      const marbleColors = new Set(
        lvl.cells.join('').split('').map((ch) => CHAR_TO_COLOR[ch]).filter(Boolean),
      );
      const orphans = lvl.gates.filter((g) => !marbleColors.has(g.color));
      expect(
        orphans.map((g) => `${g.side}:${g.index}:${g.color}`),
        `level ${lvl.id} has orphan gates`,
      ).toEqual([]);
      expect(gateColorsCovered(lvl)).toBe(true);
    }
  });

  it('symmetry is bimodal — perfect mirror or clearly asymmetric', () => {
    // Batu on the previous bake: "barely symmetric is worse". A level that
    // is 1-2 cells off a mirror reads as a bug, not as a design choice.
    for (const lvl of LEVELS) {
      const distance = mirrorDistance(lvl.cells, lvl.cols);
      const bimodal = distance === 0 || distance >= MIN_ASYMMETRIC_DISTANCE;
      expect(bimodal, `level ${lvl.id} is ${distance} cells off a perfect mirror`).toBe(true);
    }
  });

  it('the manifest symmetric flag matches the baked board', () => {
    for (const entry of LEVEL_MANIFEST) {
      const lvl = LEVELS[entry.id - 1]!;
      const distance = mirrorDistance(lvl.cells, lvl.cols);
      expect(entry.symmetric, `level ${entry.id} distance ${distance}`).toBe(distance === 0);
    }
  });

  it('symmetric levels are a minority of the set (30-40% requested)', () => {
    // The requested share is 35%; the bake downgrades unsatisfiable mirror
    // requests to asymmetric, so the achieved share is at or below that.
    const symmetric = LEVEL_MANIFEST.filter((e) => e.symmetric).length;
    const share = symmetric / LEVEL_MANIFEST.length;
    expect(share, `${symmetric}/${LEVEL_MANIFEST.length} symmetric`).toBeLessThanOrEqual(0.42);
    expect(share).toBeGreaterThan(0.1);
  });

  it('consecutive levels never share a shape kind', () => {
    for (let i = 1; i < LEVEL_MANIFEST.length; i += 1) {
      const prev = LEVEL_MANIFEST[i - 1]!;
      const cur = LEVEL_MANIFEST[i]!;
      if (prev.shapeKind === 'plain' && cur.shapeKind === 'plain') continue; // pre-sculpt floor
      expect(cur.shapeKind, `levels ${prev.id}/${cur.id} share ${cur.shapeKind}`).not.toBe(prev.shapeKind);
    }
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('level %i is well-formed and solvable', (_id, lvl) => {
    // Dimensions consistent
    expect(lvl.cells.length).toBe(lvl.rows);
    for (const row of lvl.cells) expect(row.length).toBe(lvl.cols);

    // Gates in range, mouths on playable cells
    for (const gate of lvl.gates) {
      const max = gate.side === 'top' || gate.side === 'bottom' ? lvl.cols : lvl.rows;
      expect(gate.index).toBeGreaterThanOrEqual(0);
      expect(gate.index).toBeLessThan(max);
      const mouth = gateMouthCell(gate, lvl.cols, lvl.rows);
      const ch = lvl.cells[mouth.y][mouth.x];
      expect(ch === '#' || ch === 'X').toBe(false);
    }

    // Every marble color has at least one gate
    const gateColors = new Set(lvl.gates.map((g) => g.color));
    for (const row of lvl.cells) {
      for (const ch of row) {
        const color = CHAR_TO_COLOR[ch];
        if (color) expect(gateColors.has(color)).toBe(true);
      }
    }

    // Only characters the engine can interpret — a generator typo that emits
    // an unknown char would otherwise render as a silently-empty cell.
    for (const row of lvl.cells) {
      for (const ch of row) {
        expect(LEGAL_CHARS.has(ch), `level ${lvl.id} has illegal cell char '${ch}'`).toBe(true);
      }
    }

    // Solvable with zero mistakes
    expect(solveLevel(lvl).solvable).toBe(true);

    // Measured difficulty lands near the target the generator actually aimed at.
    const measured = scoreLevel(lvl);
    const effective = effectiveTargetFor(lvl.id);
    expect(
      Math.abs(measured - effective),
      `level ${lvl.id} measured ${measured.toFixed(2)}, effective target ${effective}, nominal target ${targetFor(lvl.id)}`,
    ).toBeLessThanOrEqual(DIFFICULTY_TOLERANCE);

    // Marble count within the per-slot cap (climax slots are allowed 80, not 65).
    const cap = marbleCapFor(lvl.id);
    const { marbles } = analyzeDifficulty(lvl);
    expect(marbles, `level ${lvl.id} has ${marbles} marbles, cap ${cap}`).toBeLessThanOrEqual(cap);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('level %i solver order has valid playable routes', (_id, lvl) => {
    const solved = solveLevel(lvl);
    expect(solved.solvable).toBe(true);
    const engine = new BoardEngine(lvl);

    for (const cell of solved.order) {
      const preview = engine.previewTap(cell);
      expect(preview, `level ${lvl.id} expected route preview at ${cellKey(cell)}`).not.toBeNull();
      if (!preview) return;

      const mouth = gateMouthCell(preview.gate, engine.cols, engine.rows);
      expect(preview.path[0]).toEqual(cell);
      expect(preview.path.at(-1)).toEqual(mouth);

      for (let i = 1; i < preview.path.length; i += 1) {
        const previous = preview.path[i - 1]!;
        const current = preview.path[i]!;
        expect(
          manhattan(previous, current),
          `level ${lvl.id} route ${cellKey(cell)} has non-adjacent step ${cellKey(previous)} -> ${cellKey(current)}`,
        ).toBe(1);

        const content = engine.contentAt(current);
        expect(
          content.kind,
          `level ${lvl.id} route ${cellKey(cell)} crosses ${content.kind} at ${cellKey(current)}`,
        ).toBe('empty');
      }

      const change = engine.tap(cell);
      expect(change?.kind, `level ${lvl.id} tap at ${cellKey(cell)} should roll`).toBe('rolled');
    }

    expect(engine.remainingCount()).toBe(0);
    expect(engine.gameStatus()).toBe('won');
  });
});

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}
