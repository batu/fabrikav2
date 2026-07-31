import { GAMEPLAY } from '../core/Constants';

export interface HitTargetGeometry {
  id: string;
  x: number;
  y: number;
  r: number;
}

const SQUARE_TOLERANCE_MULTIPLIER = 1.35;
const NEIGHBOR_GAP_LEVEL_PX = 4;

/** Keep square-level taps forgiving without letting adjacent birds share a hit area. */
export function resolveRuntimeHitRadius(
  target: HitTargetGeometry,
  targets: readonly HitTargetGeometry[],
  isSquareLevel: boolean,
): number {
  if (!isSquareLevel) return target.r * GAMEPLAY.TOLERANCE_MULTIPLIER;

  let nearestCenterDistance = Number.POSITIVE_INFINITY;
  for (const candidate of targets) {
    if (candidate.id === target.id) continue;
    nearestCenterDistance = Math.min(
      nearestCenterDistance,
      Math.hypot(target.x - candidate.x, target.y - candidate.y),
    );
  }

  const forgivingRadius = target.r * SQUARE_TOLERANCE_MULTIPLIER;
  const nonOverlappingRadius = (nearestCenterDistance - NEIGHBOR_GAP_LEVEL_PX) / 2;
  return Math.min(forgivingRadius, nonOverlappingRadius);
}
