import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { birdType, isSparrow, type BirdTypeIndex } from '../../src/data/birdTypes';

const publicDir = join(process.cwd(), 'public');

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(join(publicDir, relative), 'utf8')) as T;
}

interface BundledManifest { levels: Array<{ id: string }> }
interface LevelFile { dogs: Array<{ id: string }> }
interface BirdTypesFile {
  version: number;
  coverage: { levels: number; birds: number; tagged: number; untagged: number };
  levels: Record<string, Record<string, string>>;
}

const manifest = readJson<BundledManifest>('levels/bundled-manifest.json');
const birdTypes = readJson<BirdTypesFile>('levels/bird-types.json');

describe('bird-types.json', () => {
  it('has an entry for every bundled level', () => {
    const missing = manifest.levels
      .map((level) => level.id)
      .filter((id) => birdTypes.levels[id] === undefined);
    expect(missing).toEqual([]);
  });

  it('only tags bird ids that exist in that level', () => {
    const unknown: string[] = [];
    for (const [levelId, dogs] of Object.entries(birdTypes.levels)) {
      const level = readJson<LevelFile>(`levels/${levelId}/level.json`);
      const ids = new Set(level.dogs.map((dog) => dog.id));
      for (const dogId of Object.keys(dogs)) {
        if (!ids.has(dogId)) unknown.push(`${levelId}/${dogId}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('uses lowercase hyphenated type names', () => {
    const odd = Object.values(birdTypes.levels)
      .flatMap((dogs) => Object.values(dogs))
      .filter((type) => !/^[a-z][a-z-]*$/.test(type));
    expect([...new Set(odd)]).toEqual([]);
  });

  it('reports coverage that matches its own contents', () => {
    const tagged = Object.values(birdTypes.levels)
      .reduce((sum, dogs) => sum + Object.keys(dogs).length, 0);
    expect(birdTypes.coverage.tagged).toBe(tagged);
    expect(birdTypes.coverage.levels).toBe(Object.keys(birdTypes.levels).length);
  });

  it('tags at least one sparrow, otherwise the collection can never progress', () => {
    const sparrows = Object.values(birdTypes.levels)
      .flatMap((dogs) => Object.values(dogs))
      .filter((type) => type === 'sparrow');
    expect(sparrows.length).toBeGreaterThan(0);
  });
});

describe('birdType lookup', () => {
  const index: BirdTypeIndex = {
    version: 1,
    levels: { lvl_a: { dog_00: 'sparrow', dog_01: 'robin' }, lvl_empty: {} },
  };

  it('returns the tagged type', () => {
    expect(birdType(index, 'lvl_a', 'dog_00')).toBe('sparrow');
    expect(birdType(index, 'lvl_a', 'dog_01')).toBe('robin');
  });

  it('returns null for an untagged bird, an untagged level, or a null index', () => {
    expect(birdType(index, 'lvl_a', 'dog_99')).toBeNull();
    expect(birdType(index, 'lvl_empty', 'dog_00')).toBeNull();
    expect(birdType(index, 'lvl_missing', 'dog_00')).toBeNull();
    expect(birdType(null, 'lvl_a', 'dog_00')).toBeNull();
  });

  it('treats anything but an explicit sparrow tag as not a sparrow', () => {
    expect(isSparrow(index, 'lvl_a', 'dog_00')).toBe(true);
    expect(isSparrow(index, 'lvl_a', 'dog_01')).toBe(false);
    expect(isSparrow(index, 'lvl_missing', 'dog_00')).toBe(false);
    expect(isSparrow(null, 'lvl_a', 'dog_00')).toBe(false);
  });
});
