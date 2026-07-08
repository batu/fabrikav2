import { createFlowMachine, FlowStates, FlowTransitions, type FlowMachine } from "@fabrikav2/kernel";
import {
  createAnalytics,
  createRingBufferSink,
  type Analytics,
  type AnalyticsEnvironment,
  type AnalyticsEvent,
  type RingBufferSink,
} from "@fabrikav2/sdk/analytics";

import { hitTestLevel, type WorldPoint } from "./hitTest.ts";
import {
  createHideStateMap,
  hideFoundCount,
  hideObjectViews,
  isHideFound,
  revealHide as revealHideInState,
  type HideObjectView,
  type HideStateMap,
} from "./hideState.ts";
import {
  clampScrollX,
  rectCenter,
  worldXForZone,
  zoneForWorldX,
  type CameleonBodyMode,
  type CameleonDirection,
  type CameleonHideDefinition,
  type CameleonLevelDefinition,
  type CameleonPlayMode,
  type CameleonZone,
} from "./level.ts";
import { DEFAULT_CAMELEON_QUERY, type CameleonQueryParams } from "./query.ts";

export const CAMELEON_TOUR_STATES = [
  "menu",
  "zone1",
  "zone2",
  "zone3",
  "zone4",
  "zone5",
  "found-beat",
  "win",
  "fail",
] as const;

export type CameleonTourState = (typeof CAMELEON_TOUR_STATES)[number];

export type CameleonScene =
  | typeof FlowStates.Menu
  | typeof FlowStates.Playing
  | typeof FlowStates.Complete
  | typeof FlowStates.Failed
  | typeof FlowStates.Paused;

export type CameleonStatus = "idle" | "playing" | "won" | "lost" | "paused";
export type CameleonTapResult = "hit" | "decoy" | "miss" | "ignored";
export type CameleonEvent = "hide_found" | "decoy_hit" | "miss" | "level_win" | "mode_selected" | "dir_selected";
export type CameleonFoundBeatPhase = "hit-stop" | "stamp" | "peel" | "shock" | "ragdoll" | "collect" | "done";

export interface CameleonViewport {
  readonly width: number;
  readonly height: number;
}

export interface CameleonFeedback {
  readonly sequence: number;
  readonly kind: Exclude<CameleonTapResult, "ignored"> | "mode";
  readonly id?: string;
  readonly point?: WorldPoint;
}

export interface CameleonFoundBeat {
  readonly sequence: number;
  readonly hideId: string;
  readonly point: WorldPoint;
  readonly startedAtMs: number;
  readonly elapsedMs: number;
  readonly phase: CameleonFoundBeatPhase;
  readonly interruptible: boolean;
}

export interface CameleonAim {
  readonly point: WorldPoint;
  readonly armed: boolean;
}

export interface CameleonIdleShimmer {
  readonly sequence: number;
  readonly hideId: string;
  readonly point: WorldPoint;
  readonly startedAtMs: number;
}

export interface CameleonSnapshot {
  readonly scene: CameleonScene;
  readonly status: CameleonStatus;
  readonly inputReady: boolean;
  readonly settingsOpen: boolean;
  readonly levelId: string;
  readonly mode: CameleonPlayMode;
  readonly dir: CameleonDirection;
  readonly bodies: CameleonBodyMode;
  readonly scrollX: number;
  readonly viewport: CameleonViewport;
  readonly world: CameleonLevelDefinition["world"];
  readonly foundCount: number;
  readonly winAt: number;
  readonly ammo: number | null;
  readonly maxAmmo: number | null;
  readonly coins: number;
  readonly spotless: boolean;
  readonly tapMissMockery: boolean;
  readonly tourState: CameleonTourState;
  readonly hides: readonly HideObjectView[];
  readonly aim: CameleonAim | null;
  readonly feedback: CameleonFeedback | null;
  readonly foundBeat: CameleonFoundBeat | null;
  readonly idleShimmer: CameleonIdleShimmer | null;
}

export interface CameleonControllerOptions {
  readonly level: CameleonLevelDefinition;
  readonly query?: Partial<CameleonQueryParams>;
  readonly flowMachine?: FlowMachine;
  readonly env?: AnalyticsEnvironment;
  readonly sessionId?: string;
  readonly analyticsSink?: RingBufferSink;
  readonly now?: () => number;
}

export interface CameleonController {
  readonly level: CameleonLevelDefinition;
  gotoMenu(): void;
  startLevel(id?: number): void;
  openSettings(): void;
  pause(): void;
  resume(): void;
  setViewport(viewport: CameleonViewport): void;
  setBodyMode(mode: CameleonBodyMode): void;
  setDirection(direction: CameleonDirection): void;
  setPlayMode(mode: CameleonPlayMode): void;
  scrollTo(x: number): void;
  aimAtWorld(point: WorldPoint): boolean;
  confirmAim(): CameleonTapResult;
  tapWorld(point: WorldPoint): CameleonTapResult;
  revealHide(id: string): boolean;
  tick(): void;
  driveToTourState(state: CameleonTourState): Promise<boolean>;
  winLevel(): Promise<boolean>;
  failLevel(): Promise<boolean>;
  grantCoins(amount: number): void;
  resetSave(): void;
  seedSave(profile: { readonly coins?: number }): void;
  snapshot(): CameleonSnapshot;
  subscribe(listener: () => void): () => void;
  drainEvents(): readonly AnalyticsEvent[];
}

const DEFAULT_VIEWPORT: CameleonViewport = { width: 390, height: 844 };
const SHOOT_AMMO = 14;
const CONFIRM_AMMO = 16;
const FOUND_BEAT_INTERRUPTIBLE_MS = 900;
const FOUND_BEAT_TOTAL_MS = 1400;
const IDLE_SHIMMER_AFTER_MS = 60_000;
const IDLE_SHIMMER_REPEAT_MS = 45_000;
const TAP_MOCKERY_WINDOW_MS = 10_000;
const TAP_MOCKERY_WRONG_TAPS = 3;

class CameleonStateController implements CameleonController {
  readonly level: CameleonLevelDefinition;

  private scene: CameleonScene = FlowStates.Menu;
  private status: CameleonStatus = "idle";
  private inputReady = true;
  private settingsOpen = false;
  private mode: CameleonPlayMode;
  private direction: CameleonDirection;
  private bodyMode: CameleonBodyMode;
  private viewport = DEFAULT_VIEWPORT;
  private scrollX = 0;
  private hideState: HideStateMap;
  private ammo: number | null = null;
  private maxAmmo: number | null = null;
  private coins = 0;
  private feedback: CameleonFeedback | null = null;
  private feedbackSequence = 0;
  private foundBeat: Omit<CameleonFoundBeat, "elapsedMs" | "phase" | "interruptible"> | null = null;
  private aim: CameleonAim | null = null;
  private idleShimmer: CameleonIdleShimmer | null = null;
  private idleShimmerSequence = 0;
  private lastFindAtMs: number;
  private lastIdleShimmerAtMs = Number.NEGATIVE_INFINITY;
  private readonly shimmeredAtByHide = new Map<string, number>();
  private tapWrongTimestamps: number[] = [];
  private tourState: CameleonTourState = "menu";
  private readonly listeners = new Set<() => void>();
  private readonly flowMachine: FlowMachine;
  private readonly sink: RingBufferSink;
  private readonly analytics: Analytics<CameleonEvent>;
  private readonly now: () => number;

  constructor(options: CameleonControllerOptions) {
    this.level = options.level;
    const query = { ...DEFAULT_CAMELEON_QUERY, ...options.query };
    this.now = options.now ?? (() => Date.now());
    this.mode = query.mode;
    this.direction = query.dir;
    this.bodyMode = query.bodies;
    this.hideState = createHideStateMap(this.level);
    this.flowMachine = options.flowMachine ?? createFlowMachine({ optionalStates: [FlowStates.Paused] });
    this.enterMenuFlow();
    this.lastFindAtMs = this.now();
    this.sink = options.analyticsSink ?? createRingBufferSink();
    this.analytics = createAnalytics<CameleonEvent>({
      env: options.env ?? "development",
      sessionId: options.sessionId ?? "cameleon-session",
      sinks: [this.sink],
      now: options.now,
      globalParams: { game_id: "cameleon" },
    });
    this.analytics.sessionStart({ first_open: false });
  }

  gotoMenu(): void {
    this.enterMenuFlow({ source: "goto-menu" });
    this.status = "idle";
    this.inputReady = true;
    this.settingsOpen = false;
    this.tourState = "menu";
    this.feedback = null;
    this.foundBeat = null;
    this.aim = null;
    this.idleShimmer = null;
    this.tapWrongTimestamps = [];
    this.notify();
  }

  startLevel(_id = 1): void {
    this.startFlow();
    this.status = "playing";
    this.inputReady = true;
    this.settingsOpen = false;
    this.hideState = createHideStateMap(this.level);
    this.maxAmmo = ammoForMode(this.mode);
    this.ammo = this.maxAmmo;
    this.feedback = null;
    this.foundBeat = null;
    this.aim = defaultAimFor(this.level, this.viewport);
    this.idleShimmer = null;
    this.lastFindAtMs = this.now();
    this.lastIdleShimmerAtMs = Number.NEGATIVE_INFINITY;
    this.shimmeredAtByHide.clear();
    this.tapWrongTimestamps = [];
    this.scrollTo(0);
    this.analytics.levelStart({
      level_id: this.level.id,
      level_index: 0,
    });
    this.notify();
  }

  openSettings(): void {
    this.enterMenuFlow({ source: "settings" });
    this.status = "idle";
    this.inputReady = true;
    this.settingsOpen = true;
    this.tourState = "menu";
    this.notify();
  }

  pause(): void {
    if (this.scene !== FlowStates.Playing) return;
    if (!this.flowMachine.can(FlowTransitions.Pause)) return;
    this.flowMachine.pause();
    this.syncSceneFromFlow();
    this.status = "paused";
    this.inputReady = false;
    this.notify();
  }

  resume(): void {
    if (this.scene !== FlowStates.Paused) return;
    if (!this.flowMachine.can(FlowTransitions.Resume)) return;
    this.flowMachine.resume();
    this.syncSceneFromFlow();
    this.status = "playing";
    this.inputReady = true;
    this.notify();
  }

  setViewport(viewport: CameleonViewport): void {
    this.viewport = {
      width: Math.max(1, Math.round(viewport.width)),
      height: Math.max(1, Math.round(viewport.height)),
    };
    this.scrollX = clampScrollX(this.level, this.scrollX, this.viewport.width);
    this.notify();
  }

  setBodyMode(mode: CameleonBodyMode): void {
    this.bodyMode = mode;
    this.feedback = this.nextFeedback("mode");
    this.notify();
  }

  setDirection(direction: CameleonDirection): void {
    if (this.direction === direction) return;
    this.direction = direction;
    this.analytics.track("dir_selected", { dir: direction });
    this.feedback = this.nextFeedback("mode");
    this.notify();
  }

  setPlayMode(mode: CameleonPlayMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const nextMaxAmmo = ammoForMode(mode);
    this.maxAmmo = this.scene === FlowStates.Playing ? nextMaxAmmo : this.maxAmmo;
    this.ammo = this.scene === FlowStates.Playing ? nextMaxAmmo : this.ammo;
    this.aim = mode === "confirm" ? this.aim ?? defaultAimFor(this.level, this.viewport) : null;
    this.analytics.track("mode_selected", { mode });
    this.feedback = this.nextFeedback("mode");
    this.notify();
  }

  scrollTo(x: number): void {
    this.scrollX = clampScrollX(this.level, x, this.viewport.width);
    this.tourState = `zone${zoneForWorldX(this.level.world, this.scrollX)}` as CameleonTourState;
    this.notify();
  }

  aimAtWorld(point: WorldPoint): boolean {
    if (this.scene !== FlowStates.Playing || this.mode !== "confirm") return false;
    this.aim = { point: clampWorldPoint(this.level, point), armed: true };
    this.notify();
    return true;
  }

  confirmAim(): CameleonTapResult {
    if (this.mode !== "confirm" || !this.aim) return "ignored";
    return this.tapWorld(this.aim.point);
  }

  tapWorld(point: WorldPoint): CameleonTapResult {
    if (this.scene !== FlowStates.Playing || !this.canAcceptInput()) return "ignored";
    const result = hitTestLevel(this.level, point, this.hideState);
    switch (result.kind) {
      case "hide":
        return this.applyHideHit(result.hide.id, point);
      case "decoy":
        return this.applyDecoyHit(result.decoy.id, point);
      case "miss":
        return this.applyMiss(point);
    }
  }

  revealHide(id: string): boolean {
    if (isHideFound(this.hideState, id)) return false;
    this.hideState = revealHideInState(this.hideState, id);
    this.lastFindAtMs = this.now();
    this.tapWrongTimestamps = [];
    this.analytics.track("hide_found", {
      level_id: this.level.id,
      hide_id: id,
      found_count: hideFoundCount(this.hideState),
      mode: this.mode,
      dir: this.direction,
    });
    if (hideFoundCount(this.hideState) >= this.level.winAt) this.completeLevel();
    this.notify();
    return true;
  }

  tick(): void {
    if (this.scene !== FlowStates.Playing) return;
    const now = this.now();
    if (now - this.lastFindAtMs < IDLE_SHIMMER_AFTER_MS) return;
    if (now - this.lastIdleShimmerAtMs < IDLE_SHIMMER_REPEAT_MS) return;
    const candidate = nearestUnfoundHide(this.level, this.hideState, {
      x: this.scrollX + this.viewport.width / 2,
      y: this.viewport.height / 2,
    }, this.shimmeredAtByHide, now);
    if (!candidate) return;
    this.idleShimmerSequence += 1;
    this.idleShimmer = {
      sequence: this.idleShimmerSequence,
      hideId: candidate.id,
      point: rectCenter(candidate.rect),
      startedAtMs: now,
    };
    this.lastIdleShimmerAtMs = now;
    this.shimmeredAtByHide.set(candidate.id, now);
    this.notify();
  }

  async driveToTourState(state: CameleonTourState): Promise<boolean> {
    if (state === "menu") {
      this.gotoMenu();
      return this.snapshot().tourState === "menu";
    }
    if (state === "win") return this.winLevel();
    if (state === "fail") return this.failLevel();
    if (state === "found-beat") {
      this.startLevel(1);
      const first = this.level.hides[0];
      if (!first) return false;
      this.tapWorld(rectCenter(first.rect));
      this.tourState = "found-beat";
      this.notify();
      return this.snapshot().feedback?.kind === "hit";
    }
    const zoneMatch = /^zone([1-5])$/.exec(state);
    if (!zoneMatch) return false;
    this.startLevel(1);
    const zone = Number(zoneMatch[1]) as CameleonZone;
    this.scrollTo(worldXForZone(this.level.world, zone));
    this.tourState = state;
    this.notify();
    return this.snapshot().tourState === state;
  }

  async winLevel(): Promise<boolean> {
    if (this.scene !== FlowStates.Playing) this.startLevel(1);
    for (const hide of this.level.hides.slice(0, this.level.winAt)) {
      if (this.scene !== FlowStates.Playing) break;
      this.revealHide(hide.id);
    }
    return this.snapshot().scene === FlowStates.Complete;
  }

  async failLevel(): Promise<boolean> {
    if (this.scene !== FlowStates.Playing) this.startLevel(1);
    this.ammo = 0;
    if (this.flowMachine.can(FlowTransitions.Fail)) this.flowMachine.fail({ reason: "testkit-fail-level" });
    this.syncSceneFromFlow();
    this.status = "lost";
    this.inputReady = false;
    this.tourState = "fail";
    this.feedback = this.nextFeedback("miss");
    this.notify();
    return this.snapshot().scene === FlowStates.Failed;
  }

  grantCoins(amount: number): void {
    this.coins = Math.max(0, this.coins + Math.trunc(amount));
    this.notify();
  }

  resetSave(): void {
    this.coins = 0;
    this.notify();
  }

  seedSave(profile: { readonly coins?: number }): void {
    this.coins = Math.max(0, Math.trunc(profile.coins ?? this.coins));
    this.notify();
  }

  snapshot(): CameleonSnapshot {
    const foundCount = hideFoundCount(this.hideState);
    const now = this.now();
    const foundBeat = this.snapshotFoundBeat(now);
    return {
      scene: this.scene,
      status: this.status,
      inputReady: this.inputReady && !isFoundBeatBlocking(foundBeat),
      settingsOpen: this.settingsOpen,
      levelId: this.level.id,
      mode: this.mode,
      dir: this.direction,
      bodies: this.bodyMode,
      scrollX: this.scrollX,
      viewport: this.viewport,
      world: this.level.world,
      foundCount,
      winAt: this.level.winAt,
      ammo: this.ammo,
      maxAmmo: this.maxAmmo,
      coins: this.coins,
      spotless: foundCount === this.level.hides.length,
      tapMissMockery: this.tapWrongTimestamps.length >= TAP_MOCKERY_WRONG_TAPS,
      tourState: this.tourState,
      hides: hideObjectViews(this.level, this.hideState, this.bodyMode, this.direction),
      aim: this.mode === "confirm" ? this.aim : null,
      feedback: this.feedback,
      foundBeat,
      idleShimmer: this.idleShimmer,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  drainEvents(): readonly AnalyticsEvent[] {
    return this.sink.drain();
  }

  private applyHideHit(id: string, point: WorldPoint): CameleonTapResult {
    this.feedback = this.nextFeedback("hit", id, point);
    this.foundBeat = {
      sequence: this.feedback.sequence,
      hideId: id,
      point,
      startedAtMs: this.now(),
    };
    this.revealHide(id);
    return "hit";
  }

  private applyDecoyHit(id: string, point: WorldPoint): CameleonTapResult {
    this.consumeAmmo(costForWrongTarget(this.mode));
    this.feedback = this.nextFeedback("decoy", id, point);
    this.recordWrongTap();
    this.analytics.track("decoy_hit", {
      level_id: this.level.id,
      decoy_id: id,
      found_count: hideFoundCount(this.hideState),
      mode: this.mode,
      dir: this.direction,
    });
    this.failIfOutOfAmmo();
    this.notify();
    return "decoy";
  }

  private applyMiss(point: WorldPoint): CameleonTapResult {
    this.consumeAmmo(costForMiss(this.mode));
    this.feedback = this.nextFeedback("miss", undefined, point);
    this.recordWrongTap();
    this.analytics.track("miss", {
      level_id: this.level.id,
      found_count: hideFoundCount(this.hideState),
      mode: this.mode,
      dir: this.direction,
    });
    this.failIfOutOfAmmo();
    this.notify();
    return "miss";
  }

  private completeLevel(): void {
    if (this.scene === FlowStates.Complete) return;
    if (this.flowMachine.can(FlowTransitions.Complete)) this.flowMachine.complete({ found: hideFoundCount(this.hideState) });
    this.syncSceneFromFlow();
    this.status = "won";
    this.inputReady = false;
    this.tourState = "win";
    this.coins += 1;
    this.analytics.track("level_win", {
      level_id: this.level.id,
      found_count: hideFoundCount(this.hideState),
      mode: this.mode,
      dir: this.direction,
    });
  }

  private failIfOutOfAmmo(): void {
    if (this.ammo === null || this.ammo > 0 || hideFoundCount(this.hideState) >= this.level.winAt) return;
    if (this.flowMachine.can(FlowTransitions.Fail)) this.flowMachine.fail({ reason: "out-of-ammo" });
    this.syncSceneFromFlow();
    this.status = "lost";
    this.inputReady = false;
    this.tourState = "fail";
  }

  private consumeAmmo(cost: number): void {
    if (this.ammo === null) return;
    this.ammo = Math.max(0, this.ammo - cost);
  }

  private nextFeedback(kind: CameleonFeedback["kind"], id?: string, point?: WorldPoint): CameleonFeedback {
    this.feedbackSequence += 1;
    return { sequence: this.feedbackSequence, kind, id, point };
  }

  private canAcceptInput(): boolean {
    return this.inputReady && !isFoundBeatBlocking(this.snapshotFoundBeat(this.now()));
  }

  private snapshotFoundBeat(now: number): CameleonFoundBeat | null {
    if (!this.foundBeat) return null;
    const elapsedMs = Math.max(0, now - this.foundBeat.startedAtMs);
    return {
      ...this.foundBeat,
      elapsedMs,
      phase: foundBeatPhaseForElapsed(elapsedMs),
      interruptible: elapsedMs >= FOUND_BEAT_INTERRUPTIBLE_MS,
    };
  }

  private recordWrongTap(): void {
    if (this.mode !== "tap") return;
    const now = this.now();
    this.tapWrongTimestamps = [...this.tapWrongTimestamps, now].filter((timestamp) =>
      now - timestamp <= TAP_MOCKERY_WINDOW_MS
    );
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private startFlow(): void {
    if (this.flowMachine.state !== FlowStates.Boot && this.flowMachine.state !== FlowStates.Menu) {
      this.enterMenuFlow({ source: "restart" });
    }
    if (this.flowMachine.can(FlowTransitions.Start)) {
      this.flowMachine.start(this.level.id, { source: "cameleon" });
    }
    this.syncSceneFromFlow();
  }

  private enterMenuFlow(meta?: Record<string, string>): void {
    if (this.flowMachine.state === FlowStates.Menu) {
      this.syncSceneFromFlow();
      return;
    }
    if (this.flowMachine.can(FlowTransitions.ToMenu)) {
      this.flowMachine.toMenu(meta);
    }
    this.syncSceneFromFlow();
  }

  private syncSceneFromFlow(): void {
    const state = this.flowMachine.state;
    if (!isCameleonScene(state)) {
      throw new Error(`Cameleon flow reached unsupported state: ${state}`);
    }
    this.scene = state;
  }
}

export function createCameleonController(options: CameleonControllerOptions): CameleonController {
  return new CameleonStateController(options);
}

export function snapshotMatchesCameleonTourState(state: CameleonTourState, snapshot: unknown): boolean {
  if (snapshot === null || typeof snapshot !== "object") return false;
  const tourState = (snapshot as { readonly tourState?: unknown }).tourState;
  const scene = (snapshot as { readonly scene?: unknown }).scene;
  const status = (snapshot as { readonly status?: unknown }).status;
  const inputReady = (snapshot as { readonly inputReady?: unknown }).inputReady;
  const feedback = (snapshot as { readonly feedback?: unknown }).feedback;
  if (state === "menu") return scene === FlowStates.Menu && tourState === "menu";
  if (state === "win") return scene === FlowStates.Complete;
  if (state === "fail") return scene === FlowStates.Failed;
  if (state === "found-beat") {
    // input is deliberately blocked during the beat's first 900ms (DESIGN §7),
    // so found-beat does NOT require inputReady.
    return (
      scene === FlowStates.Playing &&
      status === "playing" &&
      tourState === "found-beat" &&
      feedback !== null &&
      typeof feedback === "object" &&
      (feedback as { readonly kind?: unknown }).kind === "hit"
    );
  }
  return scene === FlowStates.Playing && status === "playing" && inputReady === true && tourState === state;
}

function isCameleonScene(state: string): state is CameleonScene {
  return (
    state === FlowStates.Menu ||
    state === FlowStates.Playing ||
    state === FlowStates.Complete ||
    state === FlowStates.Failed ||
    state === FlowStates.Paused
  );
}

function ammoForMode(mode: CameleonPlayMode): number | null {
  switch (mode) {
    case "tap":
      return null;
    case "shoot":
      return SHOOT_AMMO;
    case "confirm":
      return CONFIRM_AMMO;
  }
}

function costForWrongTarget(mode: CameleonPlayMode): number {
  return mode === "tap" ? 0 : 1;
}

function costForMiss(mode: CameleonPlayMode): number {
  return mode === "confirm" ? 2 : costForWrongTarget(mode);
}

function defaultAimFor(level: CameleonLevelDefinition, viewport: CameleonViewport): CameleonAim {
  return {
    point: clampWorldPoint(level, { x: viewport.width / 2, y: viewport.height / 2 }),
    armed: false,
  };
}

function clampWorldPoint(level: CameleonLevelDefinition, point: WorldPoint): WorldPoint {
  return {
    x: clampNumber(point.x, 0, level.world.width),
    y: clampNumber(point.y, 0, level.world.height),
  };
}

function foundBeatPhaseForElapsed(elapsedMs: number): CameleonFoundBeatPhase {
  if (elapsedMs < 80) return "hit-stop";
  if (elapsedMs < 200) return "stamp";
  if (elapsedMs < 450) return "peel";
  if (elapsedMs < 650) return "shock";
  if (elapsedMs < 1_150) return "ragdoll";
  if (elapsedMs < FOUND_BEAT_TOTAL_MS) return "collect";
  return "done";
}

function isFoundBeatBlocking(foundBeat: CameleonFoundBeat | null): boolean {
  return foundBeat !== null && !foundBeat.interruptible;
}

function nearestUnfoundHide(
  level: CameleonLevelDefinition,
  hideState: HideStateMap,
  point: WorldPoint,
  shimmeredAtByHide: ReadonlyMap<string, number>,
  now: number,
): CameleonHideDefinition | null {
  let best: { hide: CameleonHideDefinition; distance: number } | null = null;
  for (const hide of level.hides) {
    if (isHideFound(hideState, hide.id)) continue;
    const lastShimmeredAt = shimmeredAtByHide.get(hide.id) ?? Number.NEGATIVE_INFINITY;
    if (now - lastShimmeredAt < IDLE_SHIMMER_REPEAT_MS) continue;
    const center = rectCenter(hide.rect);
    const distance = Math.hypot(center.x - point.x, center.y - point.y);
    if (best === null || distance < best.distance) best = { hide, distance };
  }
  return best?.hide ?? null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
