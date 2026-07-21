/**
 * Constructive level generator. Places marbles one at a time onto a
 * board shape, keeping the level solvable after every placement (greedy
 * peel is exact, see solver.ts). Deterministic via a seeded PRNG so a
 * (seed, params) pair always regenerates the same level.
 */
import { mulberry32 } from '@fabrikav2/kernel';
import { solveLevel } from './solver';
import type { GateDef, LevelDef, MarbleColor } from './types';
import { COLOR_TO_CHAR } from './types';

export interface GenerateParams {
  readonly id: number;
  readonly cols: number;
  readonly rows: number;
  /** Board shape rows using '.' playable and '#' void. Optional plugs 'X'. */
  readonly shape?: readonly string[];
  readonly gates: readonly GateDef[];
  readonly colors: readonly MarbleColor[];
  /** How many marbles to place (generator stops early if board jams). */
  readonly marbleTarget: number;
  readonly seed: number;
  readonly hearts?: number;
  /**
   * Difficulty shaping: minimum waves the final level must have.
   * The generator retries placement orders until met (or attempts run out).
   */
  readonly minWaves?: number;
  /**
   * Onboarding shaping: minimum fraction of marbles movable at the
   * start (first wave / total). High = generous opening, low = tight.
   */
  readonly minOpeners?: number;
  /**
   * Visual shaping, BIMODAL by design. 'mirror' accepts only candidates
   * whose board is a perfect left-right mirror (`mirrorDistance` 0);
   * 'asymmetric' accepts only candidates that are clearly asymmetric
   * (`mirrorDistance` >= MIN_ASYMMETRIC_DISTANCE).
   *
   * The old probabilistic `symmetryRate` knob is deliberately gone: a
   * per-placement probability produces "symmetric except one piece"
   * boards, which read as a mistake rather than as either an authored
   * mirror or an honest scatter.
   */
  readonly symmetryMode?: 'mirror' | 'asymmetric';
  /**
   * Ending shaping: 'cascade' prefers a big final wave (satisfying
   * chain finish), 'thin' prefers a small one (tense last taps).
   */
  readonly lastWavePreference?: 'cascade' | 'thin';
  /** Require wave-1 marbles to exit through several distinct gates. */
  readonly openerSpread?: boolean;
  /** Hard ceiling on placements, regardless of marbleTarget. */
  readonly marbleCap?: number;
}

/** Extra attempts spent looking for a better ending once one candidate is valid. */
const PREFERENCE_WINDOW = 1;

/**
 * How far from a perfect mirror an 'asymmetric' level must sit. 1-2 cells
 * off reads as a broken mirror rather than a deliberate scatter, which is
 * the exact "barely symmetric" outcome this generator must not emit.
 */
export const MIN_ASYMMETRIC_DISTANCE = 3;

/**
 * Cells that differ from their left-right mirror image. 0 means a perfect
 * mirror across the vertical centre line — of the board AND the marble
 * colors, not just the playable mask.
 *
 * The centre column of an odd-width board mirrors onto itself, so it is
 * self-mirrored and contributes 0 by construction.
 */
export function mirrorDistance(cells: readonly string[], cols: number): number {
  let distance = 0;
  for (const row of cells) {
    for (let x = 0; x < Math.floor(cols / 2); x += 1) {
      if (row[x] !== row[cols - 1 - x]) distance += 1;
    }
  }
  return distance;
}

/** Does every gate color appear as at least one marble on the board? */
export function gateColorsCovered(level: LevelDef): boolean {
  const present = new Set<string>();
  for (const row of level.cells) {
    for (const ch of row) present.add(ch);
  }
  return level.gates.every((gate) => present.has(COLOR_TO_CHAR[gate.color]));
}

/** Gate colors with no marble of that color on the board yet. */
function uncoveredGateColors(
  gates: readonly GateDef[],
  cells: readonly string[],
): MarbleColor[] {
  const present = new Set<string>();
  for (const row of cells) {
    for (const ch of row) present.add(ch);
  }
  const seen = new Set<MarbleColor>();
  const missing: MarbleColor[] = [];
  for (const gate of gates) {
    if (seen.has(gate.color)) continue;
    seen.add(gate.color);
    if (!present.has(COLOR_TO_CHAR[gate.color])) missing.push(gate.color);
  }
  return missing;
}

/**
 * Hard acceptance predicate. A candidate failing this is discarded and the
 * next attempt is tried — never repaired, and never thrown from, so a bake
 * driver's own reseed loop stays in control of failure.
 */
function accepts(params: GenerateParams, level: LevelDef): boolean {
  // A deliberately empty board (marbleTarget or marbleCap 0) has no marbles
  // to cover its gates with. That is a degenerate caller request, not an
  // orphan gate, so coverage only binds when marbles were actually asked for.
  const budget = Math.min(params.marbleTarget, params.marbleCap ?? Infinity);
  if (budget > 0 && !gateColorsCovered(level)) return false;
  if (params.symmetryMode === undefined) return true;
  const distance = mirrorDistance(level.cells, params.cols);
  return params.symmetryMode === 'mirror'
    ? distance === 0
    : distance >= MIN_ASYMMETRIC_DISTANCE;
}

function gateKey(gate: GateDef): string {
  return `${gate.side}:${gate.index}`;
}

/** How many distinct gates wave 1 must cover for `openerSpread`. */
function spreadTarget(gates: readonly GateDef[]): number {
  const colors = new Set(gates.map((g) => g.color));
  return Math.min(gates.length, colors.size);
}

function emptyShape(cols: number, rows: number): string[] {
  return Array.from({ length: rows }, () => '.'.repeat(cols));
}

function setChar(rows: string[], x: number, y: number, ch: string): void {
  rows[y] = rows[y]!.slice(0, x) + ch + rows[y]!.slice(x + 1);
}

export function generateLevel(params: GenerateParams): LevelDef {
  const attempts = 80;
  let best: LevelDef | null = null;
  let bestScore = -1;
  // Ending-preference bookkeeping (only used when the knob is set).
  let bestValid: LevelDef | null = null;
  let bestValidScore = -Infinity;
  let windowEnd = -1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Stop at the deadline even when the last candidate was invalid/null.
    if (bestValid && attempt > windowEnd) return bestValid;
    const rand = mulberry32(params.seed + attempt * 7919);
    const cells = params.shape ? [...params.shape] : emptyShape(params.cols, params.rows);
    const level = tryFill(params, cells, rand);
    if (!level) continue;
    const solved = solveLevel(level);
    if (!solved.solvable) continue; // paranoia — tryFill guarantees solvable
    // Hard invariants (orphan gates, bimodal symmetry). Unlike the soft
    // knobs below these never fall through to the best-effort fallback:
    // a violating candidate is discarded outright.
    if (!accepts(params, level)) continue;
    const waves = solved.waves.length;
    const marbles = solved.order.length;
    const openers = marbles === 0 ? 1 : solved.waves[0]! / marbles;

    const wavesOk = params.minWaves === undefined || waves >= params.minWaves;
    const openersOk = params.minOpeners === undefined || openers >= params.minOpeners;
    const distinctGates = new Set(solved.firstWaveGates.map(gateKey)).size;
    const spreadOk =
      params.openerSpread !== true || distinctGates >= spreadTarget(params.gates);

    // Signed final-wave size: cascade wants it big, thin wants it small.
    const lastWave = solved.waves[solved.waves.length - 1] ?? 0;
    const endingScore =
      params.lastWavePreference === 'cascade'
        ? lastWave
        : params.lastWavePreference === 'thin'
          ? -lastWave
          : 0;

    if (wavesOk && openersOk && spreadOk) {
      // Legacy behaviour when no ending preference: first valid wins.
      if (params.lastWavePreference === undefined) return level;
      // Otherwise keep looking for a better ending for a bounded window.
      if (endingScore > bestValidScore) {
        bestValid = level;
        bestValidScore = endingScore;
      }
      if (windowEnd < 0) windowEnd = attempt + PREFERENCE_WINDOW;
      continue;
    }

    // Best-effort fallback: openers constraint dominates (onboarding
    // feel beats dependency depth), then gate spread, then deeper waves.
    const score =
      (openersOk ? 1000 : openers * 500) +
      (spreadOk ? 200 : 0) +
      waves +
      endingScore * 0.25;
    if (score > bestScore) {
      best = level;
      bestScore = score;
    }
  }
  if (bestValid) return bestValid;
  if (!best) {
    throw new Error(`generateLevel(${params.id}): could not build a solvable level`);
  }
  return best;
}

function tryFill(
  params: GenerateParams,
  cells: string[],
  rand: () => number,
): LevelDef | null {
  const open: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < params.rows; y += 1) {
    for (let x = 0; x < params.cols; x += 1) {
      if (cells[y]![x] === '.') open.push({ x, y });
    }
  }

  const target = Math.max(
    0,
    Math.min(params.marbleTarget, params.marbleCap ?? Infinity),
  );
  const snapshot = (): LevelDef => ({
    id: params.id,
    cols: params.cols,
    rows: params.rows,
    cells: [...cells],
    gates: params.gates,
    hearts: params.hearts,
  });
  if (target === 0) return snapshot();

  let placed = 0;
  let stall = 0;
  while (placed < target && open.length > 0 && stall < 250) {
    const idx = Math.floor(rand() * open.length);
    const cell = open[idx]!;
    // Gate coverage is satisfied constructively: while any gate color is
    // still missing from the board we only place those colors. The
    // acceptance predicate in generateLevel is the guarantee; this is what
    // makes satisfying it the common case rather than a lottery.
    const missing = uncoveredGateColors(params.gates, cells);
    const pool = missing.length > 0 ? missing : params.colors;
    const color = pool[Math.floor(rand() * pool.length)]!;
    // On an odd-width board the centre column mirrors onto ITSELF, so a lone
    // marble there is still a perfect mirror. Treating it as unpairable and
    // skipping it would strand a whole column of playable cells — enough
    // marble capacity that mirrored levels could not reach their difficulty
    // target at all (measured: L20 topped out at 11.92 against a target 14).
    const onCentreColumn = params.cols % 2 === 1 && cell.x === (params.cols - 1) / 2;
    const wantPair = params.symmetryMode === 'mirror' && !onCentreColumn;

    if (wantPair && placed + 2 <= target) {
      const mx = params.cols - 1 - cell.x;
      const mirrorIdx = open.findIndex((c) => c.x === mx && c.y === cell.y);
      // Mirror must be a distinct, still-open cell (fails on the centre
      // column of an odd-width board, and on void/plug/occupied cells).
      if (mirrorIdx >= 0 && mirrorIdx !== idx) {
        const mirror = open[mirrorIdx]!;
        setChar(cells, cell.x, cell.y, COLOR_TO_CHAR[color]);
        setChar(cells, mirror.x, mirror.y, COLOR_TO_CHAR[color]);
        if (solveLevel(snapshot()).solvable) {
          // Splice the higher index first so the lower stays valid.
          const [hi, lo] = idx > mirrorIdx ? [idx, mirrorIdx] : [mirrorIdx, idx];
          open.splice(hi, 1);
          open.splice(lo, 1);
          placed += 2;
          stall = 0;
          continue;
        }
        // Pair broke solvability — revert both.
        setChar(cells, cell.x, cell.y, '.');
        setChar(cells, mirror.x, mirror.y, '.');
      }
    }

    if (wantPair) {
      // Mirror mode never falls back to a single placement: one unpaired
      // marble is exactly the "symmetric except one piece" board we are
      // eliminating. Skip this cell and let another attempt find a pair.
      // (The centre column of an odd-width board is self-mirrored and so
      // simply stays empty — still mirrorDistance 0.)
      stall += 1;
      continue;
    }

    setChar(cells, cell.x, cell.y, COLOR_TO_CHAR[color]);
    if (solveLevel(snapshot()).solvable) {
      open.splice(idx, 1);
      placed += 1;
      stall = 0;
    } else {
      setChar(cells, cell.x, cell.y, '.');
      stall += 1;
    }
  }

  if (placed === 0) return null;
  return {
    id: params.id,
    cols: params.cols,
    rows: params.rows,
    cells,
    gates: params.gates,
    hearts: params.hearts,
  };
}
