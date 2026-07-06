/**
 * Seed-from-config — derive the harness's state list from ONE source of truth:
 * the game's declared `gameConfig.screens` (CONDUCTOR comment (5);
 * `docs/architecture/reference-fidelity-harness.md` Birth bullet).
 *
 * "What states exist" must not be re-typed in a refs manifest AND in
 * `game.config.ts` — they drift. A harness / refs generator calls this over the
 * config so `gotoState(state)` and the manifest share the config's screen list.
 */

/** The minimal shape this helper reads off a game config. `gameConfig` in a
 *  game is `as const`, so `screens` is a readonly string-literal tuple. */
export interface ScreensConfigLike {
  readonly screens: readonly string[];
}

/** The screen-name union of a concrete `as const` game config. */
export type ScreensOf<Config extends ScreensConfigLike> = Config['screens'][number];

/**
 * The ordered, de-duplicated list of states a game declares. A refs/manifest
 * generator uses this as the authoritative set of `gotoState` targets.
 */
export function seedStatesFromConfig<Config extends ScreensConfigLike>(
  config: Config,
): ReadonlyArray<ScreensOf<Config>> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const screen of config.screens) {
    if (seen.has(screen)) continue;
    seen.add(screen);
    out.push(screen);
  }
  return out as ReadonlyArray<ScreensOf<Config>>;
}
