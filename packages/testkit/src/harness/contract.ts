/**
 * `@fabrikav2/testkit/harness` — the IN-GAME test-harness contract.
 *
 * This is the OTHER side of the existing playwright bridge
 * (`../playwright/harness.ts`): that file is the test-RUNNER helper that reads
 * `window[key]`; THIS file is the shared TYPE a game's `harness()` must return.
 * marble_run built the shape organically and untyped
 * (`games/marble_run/src/shell/App.ts` `harness(): Record<string, unknown>`);
 * here it becomes a portfolio contract every game implements against.
 *
 * DELIBERATELY playwright-free. A game shell imports these types to shape its
 * `harness()` return; it must never pull `@playwright/test` into the game
 * bundle. The playwright layer imports FROM here, never the reverse.
 *
 * The verb design mirrors the analytics facade's generic extension point
 * (`@fabrikav2/sdk` `Analytics<GameEvent>`): the standard core is fixed, and a
 * game declares its EXTRA verbs through the `GameVerb` generic union — typed,
 * without forking the core.
 */

/** A point in CLIENT (viewport) coordinates — what a real pointer event carries. */
export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * One game verb, in BOTH flavors (the dead-menu-buttons lesson —
 * `docs/retros/insitu-testing-capability-notes.md`). A verb that represents
 * user input MUST offer the input-drive half so a test can dispatch a REAL
 * pointer event instead of forcing an engine call:
 *
 *  - `run` — STATE-DRIVE: a direct engine call, for setup (marble_run
 *    `tapCell(x,y)` → `App.ts` `this.controller.tapCell(...)`).
 *  - `clientPoint` — INPUT-DRIVE: returns the client coordinates of the target
 *    so the generic {@link driveInputAt} dispatches a real pointer event there
 *    (marble_run `cellClientPoint(x,y)`). Present ONLY on input-representing
 *    verbs; a pure state verb (a cheat, a jump-to-state) omits it.
 *
 * A game writes the coordinate ACCESSOR; it never writes input logic — the one
 * generic input-driver ({@link driveInputAt}) owns dispatch.
 */
export interface GameVerbHandler<Args extends readonly unknown[] = readonly unknown[]> {
  /** State-drive: perform the verb by a direct engine call (setup path). */
  run(...args: Args): unknown;
  /** Input-drive: the client point a real pointer event should be dispatched at. */
  clientPoint?(...args: Args): ClientPoint;
}

/**
 * A minimal structural mirror of the sdk `AnalyticsEvent` envelope, declared
 * locally so the harness contract stays decoupled from `@fabrikav2/sdk`. The
 * {@link RingBufferSink} in the sdk returns the real `AnalyticsEvent[]`, which
 * is assignable to this shape.
 */
export interface AnalyticsEventLike {
  readonly name: string;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly timestamp: number;
}

/**
 * The stamped envelope wrapping a game's inner `snapshot()` fingerprint. The
 * `packageId` + `buildVersion` stamps are the WRONG-PACKAGE guard
 * (`insitu-testing-capability-notes.md` 2026-07-06 incident): a capture can
 * never be silently attributed to the wrong installed variant. `ts` is
 * monotonic (see {@link wrapSnapshot}).
 */
export interface SnapshotEnvelope<Fingerprint = unknown> {
  /** The game-supplied inner snapshot (marble_run `snapshot()`). */
  readonly fingerprint: Fingerprint;
  /** Monotonic timestamp (ms) — ordering-safe across a run, not wall-clock. */
  readonly ts: number;
  /** Build version string, for cross-build reconciliation. */
  readonly buildVersion: string;
  /** Package / app id — the wrong-package guard. */
  readonly packageId: string;
}

/** A self-screenshot result: PNG bytes as base64, returned via the harness. */
export interface CaptureResult {
  /** PNG image, base64-encoded (no data-URL prefix). */
  readonly pngBase64: string;
  readonly width: number;
  readonly height: number;
}

/** One frame-rate bucket and how many frames landed in it. */
export interface PerfBucket {
  /** Human label, e.g. `">=60"`, `">=30"`, `">=20"`, `"<20"`. */
  readonly label: string;
  readonly count: number;
}

/** A perf sample: bucketed frame rates + the worst single frame. Precedent:
 *  FTD `recordRevealFrame` (v1, read-only, cited). */
export interface PerfSample {
  readonly buckets: readonly PerfBucket[];
  /** Longest single frame duration observed (ms). 0 when no frames recorded. */
  readonly worstFrameMs: number;
  readonly frameCount: number;
}

/**
 * Deterministic persisted-state seed used by capture tours before they drive
 * default or per-game manifest states. Every field is optional so a game can
 * consume only the parts its save model understands; the index signature leaves
 * room for game-specific seed data without forking the shared harness contract.
 */
export interface HarnessSaveProfile {
  /** Current/highest unlocked level for games where progression is level-gated. */
  readonly unlockedLevel?: number;
  /** Soft-currency balance visible in menus/HUDs. */
  readonly coins?: number;
  /** Durable no-ads entitlement or equivalent purchase flag. */
  readonly noAds?: boolean;
  /** Audio/haptics settings when visible or gameplay-affecting. */
  readonly sfx?: boolean;
  readonly music?: boolean;
  readonly haptics?: boolean;
  readonly [gameSpecific: string]: unknown;
}

/**
 * The standard in-game harness contract. `GameVerb` is the per-game extension
 * point — a union of that game's extra verb-name literals, defaulting to
 * `never` (a game needing only the core writes `GameHarness` with no argument),
 * exactly like `Analytics<GameEvent>`.
 *
 * The observation methods (`capture`/`perf`/`drainEvents`) are OPTIONAL: a game
 * implements the witnesses it can. The runner-side collectors degrade when a
 * witness is absent.
 *
 * The REQUIRED debug-harness surface (`reference-fidelity-harness.md`) is the
 * STATE half — {@link snapshot} (scene+status+inputReady) — plus the ACTION half:
 * primitive semantic {@link verbs} AND solver-bound goal verbs
 * ({@link winLevel}/{@link failLevel}, and ideally {@link driveTo}). The goal verbs
 * are typed optional here purely to accommodate marble_run's pre-rename
 * `autoWin`/`autoFail`; the tools/audit harness check is what enforces their
 * presence per game.
 */
export interface GameHarness<GameVerb extends string = never> {
  // ── standard core ────────────────────────────────────────────────
  /** Jump the flow machine to a named state. Keyed to `gameConfig.screens`
   *  (see {@link seedStatesFromConfig} for the single source of truth). */
  gotoState(state: string): void;
  /** Start a level by id (marble_run `startLevel`). */
  startLevel(id: number): void;
  /**
   * The game's inner state fingerprint (wrapped by {@link wrapSnapshot}). REQUIRED
   * state-query half of the debug harness (`reference-fidelity-harness.md` 'REQUIRED
   * debug harness per game'). It MUST include at least `scene` (the flow-machine
   * state), `status` (the in-level outcome, e.g. `playing`/`won`/`lost`), and
   * `inputReady` (whether the game is accepting player input) so a driver GATES every
   * transition on queryable state instead of eyeballing a screenshot; games add their
   * own fields (`hearts`/`lives`, `score`/`coins`, `board?`…). marble_run's
   * `snapshot()` is the reference shape.
   */
  snapshot(): unknown;
  /** The currently reachable saga node ids (marble_run `sagaNodes`). */
  sagaNodes(): readonly (string | number)[];

  // ── cheats (setup shortcuts) ─────────────────────────────────────
  /** Unlock all levels/content (marble_run `unlockAll`). */
  unlockAll(): void;
  /** Grant soft currency (marble_run `grantCoins`). */
  grantCoins(amount: number): void;
  /**
   * Optional persistence reset for deterministic capture tours. Games with no
   * durable save state omit this and the tour continues unchanged.
   */
  resetSave?(): void | Promise<void>;
  /**
   * Optional deterministic save seed applied before capture-state driving.
   * Implementations should make the seeded values observable via snapshot()
   * and the visible surfaces the capture tour will visit.
   */
  seedSave?(profile: HarnessSaveProfile): void | Promise<void>;

  // ── typed game-verb extension point ──────────────────────────────
  /** The game's extra verbs, keyed by the `GameVerb` union. Empty (`never`
   *  key) when a game declares none. Each verb carries both flavors. */
  readonly verbs: Record<GameVerb, GameVerbHandler>;

  // ── goal verbs (solver-bound; the ACTION half's terminal tier) ────
  /**
   * Play the current level to a WIN, resolving true iff the win was reached and
   * confirmed via {@link snapshot}. This is a GOAL verb: it MUST be bound to an
   * in-game DETERMINISTIC AI (an A-star/search/solver replaying its solution) —
   * NEVER an llm or a random policy — so a driven run reproduces byte-for-byte
   * (`harness-ledger.md`: "playing-to-win is a deterministic search problem").
   * A game WITHOUT a solver supplies a scripted deterministic move list instead.
   *
   * Declared OPTIONAL here only because the reference impl (marble_run) predates
   * the portfolio rename and exposes the same capability as `autoWin()`/`autoFail()`;
   * the tools/audit harness check enforces PRESENCE of a solver-bound win/fail goal
   * verb under either the canonical (`winLevel`/`failLevel`) or the legacy
   * (`autoWin`/`autoFail`) name. New games implement the canonical names.
   */
  winLevel?(): Promise<boolean>;
  /**
   * Play the current level to a LOSS (deterministic, solver-bound — see
   * {@link winLevel}); resolves true iff the fail state was reached and confirmed
   * via {@link snapshot}. marble_run's `autoFail` is the reference impl.
   */
  failLevel?(): Promise<boolean>;

  // ── navigation (optional-but-recommended) ────────────────────────
  /**
   * OPTIONAL-but-recommended: deterministically navigate to a named canonical
   * state for capture, CONFIRMING arrival via {@link snapshot} before resolving
   * (fidelity-diff ledger C5). Resolves true iff the state was reached and
   * confirmed; false on an unknown state or a confirmation timeout — an honest
   * "did not reach", never an unverified success. State names are per-game (a
   * game documents its own set, e.g. marble_run `menu`/`level`/`win`/`fail`/
   * `settings`/`pause`); a game that cannot deterministically drive its states
   * omits this and the capture tooling falls back to `gotoState` + polling.
   */
  driveTo?(state: string): Promise<boolean>;

  // ── observation (witness side; all optional) ─────────────────────
  /** Self-screenshot → PNG (browser path via {@link captureCanvasPng}). */
  capture?(): CaptureResult | Promise<CaptureResult>;
  /** Frame-rate sample (see {@link createPerfRecorder}). */
  perf?(): PerfSample;
  /** Drain the buffered analytics events (the sdk `RingBufferSink`). */
  drainEvents?(): readonly AnalyticsEventLike[];
}

/**
 * Derive the `GameVerb` union of a concrete harness type — the mirror of the
 * sdk's per-game event union. Lets a runner type verb names against a game's
 * declared harness without re-listing them.
 */
export type VerbNamesOf<H> = H extends GameHarness<infer V> ? V : never;
