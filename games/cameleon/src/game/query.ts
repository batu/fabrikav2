import {
  CAMELEON_BODY_MODES,
  CAMELEON_DIRECTIONS,
  CAMELEON_PLAY_MODES,
  type CameleonBodyMode,
  type CameleonDirection,
  type CameleonPlayMode,
} from "./level.ts";

export interface CameleonQueryParams {
  readonly bodies: CameleonBodyMode;
  readonly dir: CameleonDirection;
  readonly mode: CameleonPlayMode;
}

export const DEFAULT_CAMELEON_QUERY: CameleonQueryParams = {
  bodies: "painted",
  dir: "screenprint",
  mode: "tap",
};

export function parseCameleonQuery(search: string | URLSearchParams): CameleonQueryParams {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    bodies: oneOf(params.get("bodies"), CAMELEON_BODY_MODES, DEFAULT_CAMELEON_QUERY.bodies),
    dir: oneOf(params.get("dir"), CAMELEON_DIRECTIONS, DEFAULT_CAMELEON_QUERY.dir),
    mode: oneOf(params.get("mode"), CAMELEON_PLAY_MODES, DEFAULT_CAMELEON_QUERY.mode),
  };
}

function oneOf<const T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]): T[number] {
  return value !== null && (allowed as readonly string[]).includes(value) ? value as T[number] : fallback;
}
