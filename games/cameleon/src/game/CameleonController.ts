import { FlowStates } from "@fabrikav2/kernel";
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
  zoneForWorldX,
  type CameleonBodyMode,
  type CameleonDirection,
  type CameleonLevelDefinition,
  type CameleonPlayMode,
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
  readonly coins: number;
  readonly tourState: CameleonTourState;
  readonly hides: readonly HideObjectView[];
  readonly feedback: CameleonFeedback | null;
}

export interface CameleonControllerOptions {
  readonly level: CameleonLevelDefinition;
  readonly query?: Partial<CameleonQueryParams>;
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
  tapWorld(point: WorldPoint): CameleonTapResult;
  revealHide(id: string): boolean;
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
  private coins = 0;
  private feedback: CameleonFeedback | null = null;
  private feedbackSequence = 0;
  private tourState: CameleonTourState = "menu";
  private readonly listeners = new Set<() => void>();
  private readonly sink: RingBufferSink;
  private readonly analytics: Analytics<CameleonEvent>;

  constructor(options: CameleonControllerOptions) {
    this.level = options.level;
    const query = { ...DEFAULT_CAMELEON_QUERY, ...options.query };
    this.mode = query.mode;
    this.direction = query.dir;
    this.bodyMode = query.bodies;
    this.hideState = createHideStateMap(this.level);
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
    this.scene = FlowStates.Menu;
    this.status = "idle";
    this.inputReady = true;
    this.settingsOpen = false;
    this.tourState = "menu";
    this.feedback = null;
    this.notify();
  }

  startLevel(_id = 1): void {
    this.scene = FlowStates.Playing;
    this.status = "playing";
    this.inputReady = true;
    this.settingsOpen = false;
    this.hideState = createHideStateMap(this.level);
    this.ammo = ammoForMode(this.mode);
    this.feedback = null;
    this.scrollTo(0);
    this.analytics.levelStart({
      level_id: this.level.id,
      level_index: 0,
    });
    this.notify();
  }

  openSettings(): void {
    this.scene = FlowStates.Menu;
    this.status = "idle";
    this.inputReady = true;
    this.settingsOpen = true;
    this.tourState = "menu";
    this.notify();
  }

  pause(): void {
    if (this.scene !== FlowStates.Playing) return;
    this.scene = FlowStates.Paused;
    this.status = "paused";
    this.inputReady = false;
    this.notify();
  }

  resume(): void {
    if (this.scene !== FlowStates.Paused) return;
    this.scene = FlowStates.Playing;
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
    this.ammo = this.scene === FlowStates.Playing ? ammoForMode(mode) : this.ammo;
    this.analytics.track("mode_selected", { mode });
    this.feedback = this.nextFeedback("mode");
    this.notify();
  }

  scrollTo(x: number): void {
    this.scrollX = clampScrollX(this.level, x, this.viewport.width);
    this.tourState = `zone${zoneForWorldX(this.level.world, this.scrollX)}` as CameleonTourState;
    this.notify();
  }

  tapWorld(point: WorldPoint): CameleonTapResult {
    if (this.scene !== FlowStates.Playing || !this.inputReady) return "ignored";
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
    const zone = Number(zoneMatch[1]);
    this.scrollTo((zone - 1) * this.level.world.zoneWidth);
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
    this.scene = FlowStates.Failed;
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
    return {
      scene: this.scene,
      status: this.status,
      inputReady: this.inputReady,
      settingsOpen: this.settingsOpen,
      levelId: this.level.id,
      mode: this.mode,
      dir: this.direction,
      bodies: this.bodyMode,
      scrollX: this.scrollX,
      viewport: this.viewport,
      world: this.level.world,
      foundCount: hideFoundCount(this.hideState),
      winAt: this.level.winAt,
      ammo: this.ammo,
      coins: this.coins,
      tourState: this.tourState,
      hides: hideObjectViews(this.level, this.hideState, this.bodyMode, this.direction),
      feedback: this.feedback,
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
    this.revealHide(id);
    return "hit";
  }

  private applyDecoyHit(id: string, point: WorldPoint): CameleonTapResult {
    this.consumeAmmo(costForWrongTarget(this.mode));
    this.feedback = this.nextFeedback("decoy", id, point);
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
    this.scene = FlowStates.Complete;
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
    this.scene = FlowStates.Failed;
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

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createCameleonController(options: CameleonControllerOptions): CameleonController {
  return new CameleonStateController(options);
}

export function snapshotMatchesCameleonTourState(state: CameleonTourState, snapshot: unknown): boolean {
  if (snapshot === null || typeof snapshot !== "object") return false;
  const tourState = (snapshot as { readonly tourState?: unknown }).tourState;
  const scene = (snapshot as { readonly scene?: unknown }).scene;
  if (state === "win") return scene === FlowStates.Complete;
  if (state === "fail") return scene === FlowStates.Failed;
  return tourState === state;
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
