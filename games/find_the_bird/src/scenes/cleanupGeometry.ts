/**
 * Restoration cleanup geometry — pure, scene-free, therefore testable.
 *
 * Extracted from GameScene on 2026-08-07 after a level shipped unplayable:
 * the pickup carve had been moved to a Voronoi split while the pre-flight
 * assert still used whole-rect subtraction, and nothing in the suite could
 * see the disagreement because the geometry only existed inside a Phaser
 * scene. Both callers now share these functions, and the catalog is swept
 * against them in tests/unit/restoration-cleanup-geometry.test.ts.
 *
 * The contract: a picked bird clears its own padded area, minus any part of
 * that area which is nearer to a still-unfound neighbour (a two-site Voronoi
 * split per contesting neighbour). The bird's own centre is at distance 0
 * from itself, so it always survives every bisector — a cleanup can never
 * lose the bird it exists to clear.
 */

export { pointInPolygon as pointInPolygonGeo } from '../utils/voronoi';

export interface GeoPoint {
  readonly x: number;
  readonly y: number;
}

export interface GeoRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Minimum shape this module needs from a level dog. */
export interface CleanupSite {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly cleanup: GeoRect | null;
}

/** Padded-area multiplier applied to the picked bird's own cleanup box. */
export const CLEANUP_FOOTPRINT_SCALE = 2;

export function rectsOverlap(a: GeoRect, b: GeoRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function scaleRect(rect: GeoRect, scale: number): GeoRect {
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.top + rect.bottom) / 2;
  const halfWidth = ((rect.right - rect.left) * scale) / 2;
  const halfHeight = ((rect.bottom - rect.top) * scale) / 2;
  return {
    left: centerX - halfWidth,
    top: centerY - halfHeight,
    right: centerX + halfWidth,
    bottom: centerY + halfHeight,
  };
}

export function clipRectToLevel(rect: GeoRect, width: number, height: number): GeoRect | null {
  const clipped = {
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    right: Math.min(width, rect.right),
    bottom: Math.min(height, rect.bottom),
  };
  return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null;
}

export function polygonForRect(rect: GeoRect): GeoPoint[] {
  return [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
}

/**
 * Sutherland-Hodgman clip to the half-plane of points nearer to `site` than
 * to `other` — the site's cell in the two-site Voronoi diagram.
 */
export function clipPolygonNearerToSite(
  polygon: readonly GeoPoint[],
  site: GeoPoint,
  other: GeoPoint,
): GeoPoint[] {
  const dx = other.x - site.x;
  const dy = other.y - site.y;
  if (dx === 0 && dy === 0) return [...polygon];
  const mx = (site.x + other.x) / 2;
  const my = (site.y + other.y) / 2;
  const signed = (p: GeoPoint): number => dx * (mx - p.x) + dy * (my - p.y);

  const out: GeoPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const dCurrent = signed(current);
    const dNext = signed(next);
    if (dCurrent >= 0) out.push(current);
    if ((dCurrent >= 0) !== (dNext >= 0)) {
      const t = dCurrent / (dCurrent - dNext);
      out.push({ x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t });
    }
  }
  return out;
}

/**
 * The polygons a pickup actually clears. Both the carve and its pre-flight
 * assert call this — that shared call is the point of the module.
 */
export function cleanupPolygonsForSite(
  site: CleanupSite,
  allSites: readonly CleanupSite[],
  levelWidth: number,
  levelHeight: number,
  isProtected: (other: CleanupSite) => boolean,
): GeoPoint[][] {
  if (site.cleanup === null) return [];
  const expanded = clipRectToLevel(scaleRect(site.cleanup, CLEANUP_FOOTPRINT_SCALE), levelWidth, levelHeight);
  if (expanded === null) return [];

  let polygons: GeoPoint[][] = [polygonForRect(expanded)];
  for (const other of allSites) {
    if (other.id === site.id || other.cleanup === null) continue;
    if (!isProtected(other)) continue;
    const protectedRect = clipRectToLevel(other.cleanup, levelWidth, levelHeight);
    if (protectedRect === null) continue;
    // Gate on real overlap: without it a distant neighbour's bisector would
    // slice away padding that was never contested.
    if (!rectsOverlap(expanded, protectedRect)) continue;
    polygons = polygons
      .map((polygon) => clipPolygonNearerToSite(polygon, site, other))
      .filter((polygon) => polygon.length >= 3);
    if (polygons.length === 0) break;
  }
  return polygons;
}
