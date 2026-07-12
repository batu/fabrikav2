/**
 * The v2 game manifest contract. One typed shape every `games/*` workspace
 * declares in its own `game.config.ts`; the DOM shell consumes it (which
 * @fabrikav2/ui screens to mount, the saga size, the economy currency, ad
 * placements, product catalog, analytics events) and the game never reaches
 * into shell internals. It is also the read-only input the design-sheets
 * ingester parses (`id`/`title`/`screens` drive the structural page cards) —
 * so the field shape here matches the design-sheets `fabrikav2-game` fixture
 * byte-format.
 *
 * Kernel is the contract home (pure types, no DOM) so both the game that
 * authors a config and the games/_template that scaffolds one import the SAME
 * type rather than forking parallel definitions.
 *
 * Pilot scope (marble_run): kept intentionally minimal — no per-screen static
 * config, no rich economy ledger, empty product catalog. A later game that
 * needs more extends this; it is not speculatively widened here.
 */

/** A screen key the shell may mount (matches an @fabrikav2/ui surface family). */
export type GameScreenName =
  | 'HomeMenu'
  | 'SagaMap'
  | 'Shop'
  | 'Settings'
  | 'ResultCard'
  | 'PauseOverlay'
  | 'Toast'
  | 'ConnectivityIndicator';

export interface GameSagaConfig {
  /** Total committed level count (the saga read-model clamp ceiling). */
  readonly levels: number;
}

export interface GameEconomyConfig {
  /** The soft-currency id shown in the HUD / awarded on win (marble: 'coins'). */
  readonly softCurrency: string;
}

export interface GameConfig {
  /** Stable workspace id (also the design-sheets sheet slug source). */
  readonly id: string;
  /** Human-facing game title. */
  readonly title: string;
  /** The @fabrikav2/ui screens this game's shell mounts. */
  readonly screens: readonly GameScreenName[];
  readonly saga: GameSagaConfig;
  readonly economy: GameEconomyConfig;
  /** Ad placement ids the game uses (marble: fail-run rewarded save only). */
  readonly adPlacements: readonly string[];
  /** IAP product ids (marble ships none in the pilot). */
  readonly productCatalog: readonly string[];
  /** Canonical analytics event names the game emits. */
  readonly analyticsEvents: readonly string[];
}
