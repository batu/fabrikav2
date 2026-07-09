import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAMELEON_LEVEL_IDS,
  parseLevelDefinition,
  type CameleonLevelDefinition,
  type CameleonLevelId,
} from "../../src/game/level.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function loadLidoFixture(): CameleonLevelDefinition {
  return loadCameleonLevelFixture("lido");
}

export function loadCameleonLevelFixture(levelId: CameleonLevelId): CameleonLevelDefinition {
  const levelPath = resolve(here, `../../public/levels/${levelId}/level.json`);
  return parseLevelDefinition(JSON.parse(readFileSync(levelPath, "utf8")));
}

export function loadAllCameleonLevelFixtures(): readonly CameleonLevelDefinition[] {
  return CAMELEON_LEVEL_IDS.map((levelId) => loadCameleonLevelFixture(levelId));
}
