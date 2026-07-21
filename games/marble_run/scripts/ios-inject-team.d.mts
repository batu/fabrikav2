export const DEVELOPMENT_TEAM: string;
export const DEFAULT_PBXPROJ_PATH: string;

export function injectDevelopmentTeam(
  source: string,
  team?: string,
): { text: string; occurrences: number; injected: number };
