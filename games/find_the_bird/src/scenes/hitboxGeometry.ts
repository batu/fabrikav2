import { GAMEPLAY } from '../core/Constants';

export interface HitTargetGeometry {
  id: string;
  x: number;
  y: number;
  r: number;
}

// 2.0 (2026-08-05): painted birds regularly render larger than their hitbox
// disc, so taps on visible bird pixels were landing outside the accepted
// radius. Neighbor-overlap clamping below still prevents shared hit areas.
const SQUARE_TOLERANCE_MULTIPLIER = 2.0;
const NEIGHBOR_GAP_LEVEL_PX = 4;
// Minimum BASE radius in level pixels at the canonical 2688 canvas, scaled to
// the level's actual size. Close bird pairs make the recentre/VLM pass emit
// tiny discs near the pair's midpoint; without a floor those become
// untappable slivers (2026-08-06 review). Lenient by design: the floor wins
// even over the neighbor-overlap clamp — a slightly shared hit area beats an
// untappable bird.
const MIN_BASE_RADIUS_AT_2688 = 38;
const REFERENCE_LEVEL_DIM = 2688;

/** Keep square-level taps forgiving without letting adjacent birds share a hit area. */
export function resolveRuntimeHitRadius(
  target: HitTargetGeometry,
  targets: readonly HitTargetGeometry[],
  isSquareLevel: boolean,
  levelDim: number = REFERENCE_LEVEL_DIM,
): number {
  if (!isSquareLevel) return target.r * GAMEPLAY.TOLERANCE_MULTIPLIER;

  const minBaseRadius = MIN_BASE_RADIUS_AT_2688 * (levelDim / REFERENCE_LEVEL_DIM);
  const baseRadius = Math.max(target.r, minBaseRadius);

  let nearestCenterDistance = Number.POSITIVE_INFINITY;
  for (const candidate of targets) {
    if (candidate.id === target.id) continue;
    nearestCenterDistance = Math.min(
      nearestCenterDistance,
      Math.hypot(target.x - candidate.x, target.y - candidate.y),
    );
  }

  const forgivingRadius = baseRadius * SQUARE_TOLERANCE_MULTIPLIER;
  const nonOverlappingRadius = (nearestCenterDistance - NEIGHBOR_GAP_LEVEL_PX) / 2;
  return Math.max(Math.min(forgivingRadius, nonOverlappingRadius), minBaseRadius);
}
