import {
  CAMELEON_LEVEL_IDS,
  isCameleonLevelId,
  parseLevelDefinition,
  type CameleonLevelDefinition,
  type CameleonLevelId,
} from "./level.ts";

export type LevelFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const DEFAULT_CAMELEON_LEVEL_ID = CAMELEON_LEVEL_IDS[0];

export function levelUrlForId(levelId: CameleonLevelId): string {
  return `/levels/${levelId}/level.json`;
}

export async function loadLevelDefinition(
  levelIdOrUrl: CameleonLevelId | string = DEFAULT_CAMELEON_LEVEL_ID,
  fetcher: LevelFetch = fetch,
): Promise<CameleonLevelDefinition> {
  const url = isCameleonLevelId(levelIdOrUrl) ? levelUrlForId(levelIdOrUrl) : levelIdOrUrl;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Unable to load level JSON from ${url}: ${response.status}`);
  }
  return parseLevelDefinition(await response.json());
}
