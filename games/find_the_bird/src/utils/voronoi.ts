export interface Point {
  x: number;
  y: number;
}

/**
 * Compute the Voronoi cell for a target point among a set of sites,
 * clipped to a bounding polygon. Uses Sutherland-Hodgman clipping
 * against each perpendicular bisector.
 */
export function computeVoronoiCell(
  target: Point,
  otherSites: Point[],
  bounds: Point[],
): Point[] {
  let polygon = [...bounds];

  for (const site of otherSites) {
    if (polygon.length === 0) break;
    polygon = clipByBisector(polygon, target, site);
  }

  return polygon;
}

/**
 * Clip a polygon to the half-plane closer to `a` than `b`.
 * The bisector is the perpendicular line equidistant from a and b.
 */
function clipByBisector(polygon: Point[], a: Point, b: Point): Point[] {
  if (polygon.length === 0) return [];

  // Midpoint of a and b
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  // Normal direction from a to b
  const nx = b.x - a.x;
  const ny = b.y - a.y;

  // A point is on the "a side" if dot product with normal is <= 0
  // i.e., closer to a than to b
  const inside = (p: Point): boolean => {
    return (p.x - mx) * nx + (p.y - my) * ny <= 0;
  };

  const result: Point[] = [];

  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const currentInside = inside(current);
    const nextInside = inside(next);

    if (currentInside) {
      result.push(current);
    }

    if (currentInside !== nextInside) {
      const intersection = lineIntersectBisector(current, next, mx, my, nx, ny);
      if (intersection) {
        result.push(intersection);
      }
    }
  }

  return result;
}

/**
 * Find the intersection of segment (p1→p2) with the bisector line
 * defined by midpoint (mx, my) and normal (nx, ny).
 */
function lineIntersectBisector(
  p1: Point,
  p2: Point,
  mx: number,
  my: number,
  nx: number,
  ny: number,
): Point | null {
  const d1 = (p1.x - mx) * nx + (p1.y - my) * ny;
  const d2 = (p2.x - mx) * nx + (p2.y - my) * ny;
  const denom = d1 - d2;

  if (Math.abs(denom) < 1e-10) return null;

  const t = d1 / denom;
  return {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y),
  };
}

/**
 * Ray-casting point-in-polygon test.
 */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Compute the maximum distance from a center point to any vertex of a polygon.
 */
export function maxDistToPolygon(center: Point, polygon: Point[]): number {
  let maxDist = 0;
  for (const p of polygon) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) maxDist = dist;
  }
  return maxDist;
}
