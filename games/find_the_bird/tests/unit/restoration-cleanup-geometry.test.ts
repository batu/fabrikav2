import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  cleanupPolygonsForSite,
  clipPolygonNearerToSite,
  pointInPolygonGeo,
  type CleanupSite,
} from '../../src/scenes/cleanupGeometry';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const levelsRoot = join(gameRoot, 'public', 'levels');

interface LevelDogJson {
  id: string;
  x: number;
  y: number;
  sprite?: { cleanup?: { x: number; y: number; width: number; height: number } };
}
interface LevelJson { width: number; height: number; dogs: LevelDogJson[] }

function siteFor(dog: LevelDogJson): CleanupSite {
  const c = dog.sprite?.cleanup;
  return {
    id: dog.id,
    x: dog.x,
    y: dog.y,
    cleanup: c === undefined ? null
      : { left: c.x, top: c.y, right: c.x + c.width, bottom: c.y + c.height },
  };
}

function shippedLevels(): Array<{ id: string; level: LevelJson }> {
  const order = readFileSync(
    join(gameRoot, '..', '..', 'tools', 'level-editor', 'scripts', 'wave1_order.txt'), 'utf8',
  ).split(/\s+/).filter(Boolean);
  const present = new Set(readdirSync(levelsRoot));
  return order
    .filter((id) => present.has(id))
    .map((id) => ({ id, level: JSON.parse(readFileSync(join(levelsRoot, id, 'level.json'), 'utf8')) as LevelJson }));
}

describe('restoration cleanup geometry', () => {
  it('keeps the picked site inside its own cleared area when a neighbour contests it', () => {
    // Two birds 100px apart with heavily overlapping padded areas: the old
    // whole-rect subtraction surrendered the entire overlap and could clear
    // nothing, which threw mid-level. The split must leave each bird its half.
    const a: CleanupSite = { id: 'a', x: 500, y: 500, cleanup: { left: 420, top: 420, right: 580, bottom: 580 } };
    const b: CleanupSite = { id: 'b', x: 600, y: 500, cleanup: { left: 520, top: 420, right: 680, bottom: 580 } };
    for (const site of [a, b]) {
      const polygons = cleanupPolygonsForSite(site, [a, b], 2688, 2688, () => true);
      expect(polygons.length).toBeGreaterThan(0);
      expect(polygons.some((p) => pointInPolygonGeo({ x: site.x, y: site.y }, p))).toBe(true);
    }
  });

  it('never clips a site out of its own half-plane', () => {
    const polygon = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const clipped = clipPolygonNearerToSite(polygon, { x: 10, y: 50 }, { x: 90, y: 50 });
    expect(pointInPolygonGeo({ x: 10, y: 50 }, clipped)).toBe(true);
    expect(pointInPolygonGeo({ x: 90, y: 50 }, clipped)).toBe(false);
  });

  it('leaves an uncontested site its full padded area', () => {
    const lone: CleanupSite = { id: 'a', x: 500, y: 500, cleanup: { left: 450, top: 450, right: 550, bottom: 550 } };
    const far: CleanupSite = { id: 'b', x: 2000, y: 2000, cleanup: { left: 1950, top: 1950, right: 2050, bottom: 2050 } };
    const polygons = cleanupPolygonsForSite(lone, [lone, far], 2688, 2688, () => true);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(4);
  });

  // The regression that shipped: per-bird checks all passed while a level was
  // unplayable, because the failure lives BETWEEN two birds. Sweep the real
  // catalog — every bird must be able to clear an area containing itself,
  // with every other bird still unfound (the worst case, level start).
  it('every bird in every shipped level can clear its own area', () => {
    const levels = shippedLevels();
    expect(levels.length).toBeGreaterThan(0);

    const blocked: string[] = [];
    for (const { id, level } of levels) {
      const sites = level.dogs.map(siteFor);
      for (const site of sites) {
        if (site.cleanup === null) continue;
        const polygons = cleanupPolygonsForSite(site, sites, level.width, level.height, () => true);
        const ok = polygons.some((polygon) => pointInPolygonGeo({ x: site.x, y: site.y }, polygon));
        if (!ok) blocked.push(`${id}/${site.id}`);
      }
    }
    expect(blocked, `birds whose cleanup is blocked by a neighbour: ${blocked.join(', ')}`).toEqual([]);
  });

  it('every bird in every shipped level has sprite cleanup metadata', () => {
    const missing: string[] = [];
    for (const { id, level } of shippedLevels()) {
      for (const dog of level.dogs) {
        if (dog.sprite?.cleanup === undefined) missing.push(`${id}/${dog.id}`);
      }
    }
    expect(missing, `dogs missing sprite cleanup: ${missing.join(', ')}`).toEqual([]);
  });
});
