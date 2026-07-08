import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseLevelDefinition, type CameleonLevelDefinition } from "../../src/game/level.ts";

const here = dirname(fileURLToPath(import.meta.url));
const levelPath = resolve(here, "../../public/levels/lido/level.json");

export function loadLidoFixture(): CameleonLevelDefinition {
  return parseLevelDefinition(JSON.parse(readFileSync(levelPath, "utf8")));
}
