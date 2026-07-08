// Run via tsx: imports the game's level registry, resolves every level's
// arrows (running the procedural solver for recipe packs), and prints a
// JSON map `{ "pack/indexInPack": arrows[][] }` to stdout. Called as a
// subprocess from api.ts on server startup.
import { getLevel, TOTAL_LEVELS } from "../../../../src/game/levels.js";

const out: Record<string, Array<Array<[number, number]>>> = {};
for (let i = 0; i < TOTAL_LEVELS; i++) {
  try {
    const spec = getLevel(i);
    if (!spec || !spec.pack || spec.indexInPack == null) continue;
    out[`${spec.pack}/${spec.indexInPack}`] = spec.paths.map(p => p.cells.map(c => [c.x, c.y] as [number, number]));
  } catch { /* skip unresolvable */ }
}
process.stdout.write(JSON.stringify(out));
