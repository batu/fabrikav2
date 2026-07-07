import { FlowStates } from "@fabrikav2/kernel";
import {
  createAnalytics,
  createRingBufferSink,
  type Analytics,
  type AnalyticsEnvironment,
  type AnalyticsEvent,
  type RingBufferSink,
} from "@fabrikav2/sdk/analytics";

export const TAP_TEN_GOAL = 10;
export const TAP_TEN_MAX_MISSES = 3;
export const TAP_TEN_TILE_COUNT = 4;

export type TapTenScene =
  | typeof FlowStates.Menu
  | typeof FlowStates.Playing
  | typeof FlowStates.Complete
  | typeof FlowStates.Failed
  | typeof FlowStates.Paused;

export type TapTenStatus = "idle" | "playing" | "won" | "lost" | "paused";
export type TapTenTapResult = "hit" | "miss" | "ignored";
export type TapTenEvent = "tap_hit" | "tap_miss";

export interface TapTenSnapshot {
  readonly scene: TapTenScene;
  readonly status: TapTenStatus;
  readonly inputReady: boolean;
  readonly settingsOpen: boolean;
  readonly levelId: number;
  readonly score: number;
  readonly misses: number;
  readonly litTile: number;
  readonly coins: number;
}

export interface TapTenControllerOptions {
  readonly env?: AnalyticsEnvironment;
  readonly sessionId?: string;
  readonly analyticsSink?: RingBufferSink;
  readonly now?: () => number;
}

export interface TapTenController {
  gotoMenu(): void;
  startLevel(id?: number): void;
  openSettings(): void;
  pause(): void;
  resume(): void;
  tapTile(index: number): TapTenTapResult;
  grantCoins(amount: number): void;
  snapshot(): TapTenSnapshot;
  subscribe(listener: () => void): () => void;
  drainEvents(): readonly AnalyticsEvent[];
}

class TapTenStateController implements TapTenController {
  private scene: TapTenScene = FlowStates.Menu;
  private status: TapTenStatus = "idle";
  private inputReady = true;
  private settingsOpen = false;
  private levelId = 1;
  private score = 0;
  private misses = 0;
  private litTile = 0;
  private coins = 0;
  private readonly listeners = new Set<() => void>();
  private readonly sink: RingBufferSink;
  private readonly analytics: Analytics<TapTenEvent>;

  constructor(options: TapTenControllerOptions = {}) {
    this.sink = options.analyticsSink ?? createRingBufferSink();
    this.analytics = createAnalytics<TapTenEvent>({
      env: options.env ?? "development",
      sessionId: options.sessionId ?? "tap-ten-session",
      sinks: [this.sink],
      now: options.now,
      globalParams: { game_id: "tap_ten" },
    });
    this.analytics.sessionStart({ first_open: false });
  }

  gotoMenu(): void {
    this.scene = FlowStates.Menu;
    this.status = "idle";
    this.inputReady = true;
    this.settingsOpen = false;
    this.score = 0;
    this.misses = 0;
    this.litTile = 0;
    this.notify();
  }

  startLevel(id = 1): void {
    this.levelId = id;
    this.scene = FlowStates.Playing;
    this.status = "playing";
    this.inputReady = true;
    this.settingsOpen = false;
    this.score = 0;
    this.misses = 0;
    this.litTile = 0;
    this.analytics.levelStart({ level_id: this.levelKey(), level_index: id - 1 });
    this.notify();
  }

  openSettings(): void {
    this.scene = FlowStates.Menu;
    this.status = "idle";
    this.inputReady = true;
    this.settingsOpen = true;
    this.notify();
  }

  pause(): void {
    if (this.scene !== FlowStates.Playing) return;
    this.scene = FlowStates.Paused;
    this.status = "paused";
    this.inputReady = false;
    this.settingsOpen = false;
    this.notify();
  }

  resume(): void {
    if (this.scene !== FlowStates.Paused) return;
    this.scene = FlowStates.Playing;
    this.status = "playing";
    this.inputReady = true;
    this.settingsOpen = false;
    this.notify();
  }

  tapTile(index: number): TapTenTapResult {
    if (this.scene !== FlowStates.Playing || !this.inputReady) return "ignored";
    const tile = normalizeTile(index);
    if (tile === this.litTile) {
      this.score += 1;
      this.analytics.track("tap_hit", {
        level_id: this.levelKey(),
        tile_index: tile,
        score: this.score,
      });
      if (this.score >= TAP_TEN_GOAL) {
        this.scene = FlowStates.Complete;
        this.status = "won";
        this.inputReady = false;
        this.coins += 1;
        this.analytics.levelComplete({
          level_id: this.levelKey(),
          level_index: this.levelId - 1,
        });
      } else {
        this.litTile = (this.litTile + 1) % TAP_TEN_TILE_COUNT;
      }
      this.notify();
      return "hit";
    }

    this.misses += 1;
    this.analytics.track("tap_miss", {
      level_id: this.levelKey(),
      tile_index: tile,
      lit_tile: this.litTile,
      misses: this.misses,
    });
    if (this.misses >= TAP_TEN_MAX_MISSES) {
      this.scene = FlowStates.Failed;
      this.status = "lost";
      this.inputReady = false;
      this.analytics.levelFail({
        level_id: this.levelKey(),
        level_index: this.levelId - 1,
        reason: "wrong_tile_limit",
      });
    }
    this.notify();
    return "miss";
  }

  grantCoins(amount: number): void {
    this.coins = Math.max(0, this.coins + Math.trunc(amount));
    this.notify();
  }

  snapshot(): TapTenSnapshot {
    return {
      scene: this.scene,
      status: this.status,
      inputReady: this.inputReady,
      settingsOpen: this.settingsOpen,
      levelId: this.levelId,
      score: this.score,
      misses: this.misses,
      litTile: this.litTile,
      coins: this.coins,
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

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private levelKey(): string {
    return `tap-ten-${this.levelId}`;
  }
}

function normalizeTile(index: number): number {
  return Math.max(0, Math.min(TAP_TEN_TILE_COUNT - 1, Math.trunc(index)));
}

export function createTapTenController(options: TapTenControllerOptions = {}): TapTenController {
  return new TapTenStateController(options);
}
