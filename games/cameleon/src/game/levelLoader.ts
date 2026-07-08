import { parseLevelDefinition, type CameleonLevelDefinition } from "./level.ts";

export type LevelFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const LIDO_LEVEL_URL = "/levels/lido/level.json";

export async function loadLevelDefinition(
  url: string = LIDO_LEVEL_URL,
  fetcher: LevelFetch = fetch,
): Promise<CameleonLevelDefinition> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Unable to load level JSON from ${url}: ${response.status}`);
  }
  return parseLevelDefinition(await response.json());
}
