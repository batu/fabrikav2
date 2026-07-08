import { canPlacePiece } from "./grid.ts";
import { findCompleters } from "./nearMiss.ts";
import { PIECE_LIBRARY } from "./pieces.ts";
import { GRID_SIZE } from "./rules.ts";
import type { GenerationContext, GridBoard, PieceDefinition } from "./types.ts";

interface TierWeights {
  readonly simple: number;
  readonly mid: number;
  readonly awkward: number;
}

function getTierWeights(placementCount: number, context: GenerationContext): TierWeights {
  const roundNumber = placementCount + 1;
  if (roundNumber <= context.progression.earlyRoundMax) return { simple: 1, mid: 0, awkward: 0 };
  if (roundNumber <= context.progression.midRoundMax) return { simple: 1.6, mid: 1, awkward: 0 };
  return { simple: 1, mid: 1, awkward: 1 };
}

function pieceArea(piece: PieceDefinition): number {
  return piece.cells.length;
}

function sampleWeighted(pieces: readonly PieceDefinition[], weights: readonly number[], random: () => number): PieceDefinition {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let pick = random() * totalWeight;
  for (let i = 0; i < pieces.length; i += 1) {
    pick -= weights[i]!;
    if (pick <= 0) return pieces[i]!;
  }
  return pieces[pieces.length - 1]!;
}

function canPieceFitAnywhere(piece: PieceDefinition, board: GridBoard): boolean {
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (canPlacePiece(board, piece, x, y)) return true;
    }
  }
  return false;
}

export function generatePiece(context: GenerationContext): PieceDefinition {
  const tierWeights = getTierWeights(context.placementCount, context);
  const candidates = PIECE_LIBRARY.filter((piece) => tierWeights[piece.tier] > 0);
  const weights = candidates.map((piece) => {
    let weight = tierWeights[piece.tier];
    if (context.fillRatio >= context.progression.safetyNetFillThreshold) {
      if (pieceArea(piece) <= 3) weight *= 2.8;
      else if (pieceArea(piece) <= 4) weight *= 1.8;
      else weight *= 0.7;
      if (piece.tier === "awkward") weight *= 0.6;
    }
    return weight;
  });

  if (context.flow.nearMissSeeding.enabled && context.nearMissLines.length > 0) {
    const cfg = context.flow.nearMissSeeding;
    let boostCount = 0;
    const maxBoosted = Math.floor(candidates.length * cfg.maxCompleterRatio);
    for (let i = 0; i < candidates.length && boostCount < maxBoosted; i += 1) {
      const completions = findCompleters(candidates[i]!, context.nearMissLines, context.board);
      if (completions > 0) {
        weights[i] =
          weights[i]! *
          (completions >= 2 ? cfg.completerBoost * cfg.doubleLineBoost : cfg.completerBoost);
        boostCount += 1;
      }
    }
  }

  if (context.flow.tensionCurve.enabled) {
    const cfg = context.flow.tensionCurve;
    if (context.tension > cfg.targetMax) {
      for (let i = 0; i < candidates.length; i += 1) {
        if (candidates[i]!.tier === "simple") weights[i] = weights[i]! * cfg.boostFactor;
        else if (candidates[i]!.tier === "awkward") weights[i] = weights[i]! / cfg.boostFactor;
      }
    } else if (context.tension < cfg.targetMin) {
      for (let i = 0; i < candidates.length; i += 1) {
        if (candidates[i]!.tier === "awkward") weights[i] = weights[i]! * cfg.boostFactor;
        else if (candidates[i]!.tier === "simple") weights[i] = weights[i]! / cfg.boostFactor;
      }
    }
  }

  return sampleWeighted(candidates, weights, context.random);
}

export function generateHand(slots: number, context: GenerationContext): PieceDefinition[] {
  const hand: PieceDefinition[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < slots; i += 1) {
    let piece: PieceDefinition;
    let attempts = 0;
    do {
      piece = generatePiece(context);
      attempts += 1;
    } while (usedIds.has(piece.id) && attempts < 20);
    usedIds.add(piece.id);
    hand.push(piece);
  }

  const flow = context.flow;
  if (
    flow.placementAware.enabled &&
    context.fillRatio >= flow.placementAware.activationFillThreshold &&
    !hand.some((piece) => canPieceFitAnywhere(piece, context.board))
  ) {
    for (let reroll = 0; reroll < flow.placementAware.maxRerolls; reroll += 1) {
      let worstIndex = 0;
      for (let i = 1; i < hand.length; i += 1) {
        if (pieceArea(hand[i]!) > pieceArea(hand[worstIndex]!)) worstIndex = i;
      }
      let candidate: PieceDefinition;
      let attempts = 0;
      do {
        candidate = generatePiece(context);
        attempts += 1;
      } while (usedIds.has(candidate.id) && attempts < 20);
      usedIds.delete(hand[worstIndex]!.id);
      usedIds.add(candidate.id);
      hand[worstIndex] = candidate;
      if (canPieceFitAnywhere(candidate, context.board)) break;
    }
  }

  return hand;
}
