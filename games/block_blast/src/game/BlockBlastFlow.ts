import { FlowStates, loadPersistedJson, mulberry32, savePersistedJson } from "@fabrikav2/kernel";
import {
  createAnalytics,
  createRingBufferSink,
  type Analytics,
  type AnalyticsEnvironment,
  type AnalyticsEvent,
  type RingBufferSink,
} from "@fabrikav2/sdk/analytics";

import {
  BLOCK_BLAST_STAGE_COUNT,
  BLOCK_BLAST_STAGE_PRESETS,
  ENDLESS_PRESET,
  getStagePreset,
} from "../../content/stages.ts";
import { applyPiece, canAnyPieceFit, canPlacePiece, clearLines, cloneBoard, createEmptyBoard, detectClearedLines, getBoardFillRatio, validPlacements } from "./grid.ts";
import { generateHand, generatePiece } from "./generator.ts";
import { scanNearMisses } from "./nearMiss.ts";
import { getPieceById } from "./pieces.ts";
import { HAND_SLOTS, SCORE_RULES } from "./rules.ts";
import { createTensionTracker, type TensionTracker } from "./tension.ts";
import type {
  BlockBlastMode,
  BlockBlastScene,
  BlockBlastSnapshot,
  BlockBlastStatus,
  GridBoard,
  MutableGridBoard,
  PieceDefinition,
  PlacementCommand,
  PlacementResult,
  StagePreset,
  ValidPlacement,
} from "./types.ts";

const SAVE_KEY = "@fabrikav2/block_blast/save/v1";
const FAIL_FIXTURE_PIECES = ["square3", "plus5", "big_l5"] as const;

interface SaveData {
  readonly bestScore: number;
  readonly unlockedStage: number;
  readonly completedStages: readonly number[];
  readonly coins: number;
}

interface MutableSaveData {
  bestScore: number;
  unlockedStage: number;
  completedStages: number[];
  coins: number;
}

export type BlockBlastEvent = "block_place" | "line_clear";

export interface BlockBlastControllerOptions {
  readonly env?: AnalyticsEnvironment;
  readonly sessionId?: string;
  readonly analyticsSink?: RingBufferSink;
  readonly now?: () => number;
}

export interface BlockBlastController {
  gotoMenu(): void;
  startStage(id: number): void;
  startEndless(): void;
  openSettings(): void;
  closeSettings(): void;
  pause(): void;
  resume(): void;
  selectSlot(slotIndex: number): boolean;
  tapCell(anchorX: number, anchorY: number): PlacementResult;
  placePiece(command: PlacementCommand): PlacementResult;
  getValidPlacements(slotIndex: number): ValidPlacement[];
  getPieceCells(slotIndex: number): readonly { x: number; y: number }[];
  setBoard(board: GridBoard): void;
  setHand(pieceIds: readonly string[]): void;
  winLevel(): Promise<boolean>;
  failLevel(): Promise<boolean>;
  unlockAll(): void;
  grantCoins(amount: number): void;
  resetSave(): void;
  seedSave(profile: { readonly unlockedLevel?: number; readonly coins?: number }): void;
  snapshot(): BlockBlastSnapshot;
  subscribe(listener: () => void): () => void;
  drainEvents(): readonly AnalyticsEvent[];
}

class BlockBlastFlowController implements BlockBlastController {
  private scene: BlockBlastScene = FlowStates.Menu;
  private status: BlockBlastStatus = "idle";
  private inputReady = true;
  private settingsOpen = false;
  private mode: BlockBlastMode = "saga";
  private preset: StagePreset = getStagePreset(1);
  private board: MutableGridBoard = createEmptyBoard();
  private hand: Array<PieceDefinition | null> = [];
  private score = 0;
  private placements = 0;
  private comboMultiplier = 1;
  private activeSlot: number | null = null;
  private random = mulberry32(this.preset.seed);
  private tension: TensionTracker = createTensionTracker(this.preset.flow);
  private save: MutableSaveData;
  private readonly listeners = new Set<() => void>();
  private readonly sink: RingBufferSink;
  private readonly analytics: Analytics<BlockBlastEvent>;

  constructor(options: BlockBlastControllerOptions = {}) {
    const loaded = loadPersistedJson<SaveData>(SAVE_KEY, defaultSave, isSaveData);
    this.save = {
      bestScore: loaded.bestScore,
      unlockedStage: loaded.unlockedStage,
      completedStages: [...loaded.completedStages],
      coins: loaded.coins,
    };
    this.sink = options.analyticsSink ?? createRingBufferSink();
    this.analytics = createAnalytics<BlockBlastEvent>({
      env: options.env ?? "development",
      sessionId: options.sessionId ?? "block-blast-session",
      sinks: [this.sink],
      now: options.now,
      globalParams: { game_id: "block_blast" },
    });
    this.analytics.sessionStart({ first_open: false });
    this.gotoMenu();
  }

  gotoMenu(): void {
    this.scene = FlowStates.Menu;
    this.status = "idle";
    this.inputReady = true;
    this.settingsOpen = false;
    this.activeSlot = null;
    this.notify();
  }

  startStage(id: number): void {
    const safeId = Math.max(1, Math.min(BLOCK_BLAST_STAGE_COUNT, Math.trunc(id)));
    this.mode = "saga";
    this.preset = getStagePreset(safeId);
    this.startRun();
  }

  startEndless(): void {
    this.mode = "endless";
    this.preset = ENDLESS_PRESET;
    this.startRun();
  }

  openSettings(): void {
    this.settingsOpen = true;
    this.inputReady = this.scene === FlowStates.Playing ? false : this.inputReady;
    this.notify();
  }

  closeSettings(): void {
    this.settingsOpen = false;
    if (this.scene === FlowStates.Playing) this.inputReady = true;
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
    this.notify();
  }

  selectSlot(slotIndex: number): boolean {
    if (this.scene !== FlowStates.Playing || !this.inputReady) return false;
    const index = normalizeSlot(slotIndex);
    if (!this.hand[index]) return false;
    this.activeSlot = index;
    this.notify();
    return true;
  }

  tapCell(anchorX: number, anchorY: number): PlacementResult {
    if (this.activeSlot === null) {
      return this.emptyPlacement("missing-slot");
    }
    return this.placePiece({ slotIndex: this.activeSlot, anchorX, anchorY });
  }

  placePiece(command: PlacementCommand): PlacementResult {
    if (this.scene !== FlowStates.Playing || !this.inputReady) {
      return this.emptyPlacement("not-playing");
    }
    const slotIndex = normalizeSlot(command.slotIndex);
    const handPiece = this.hand[slotIndex];
    if (!handPiece) return this.emptyPlacement("missing-slot");
    if (!canPlacePiece(this.board, handPiece, command.anchorX, command.anchorY)) {
      return this.emptyPlacement("invalid-placement");
    }

    this.board = applyPiece(this.board, handPiece, command.anchorX, command.anchorY);
    const lines = detectClearedLines(this.board);
    const clearCount = lines.rows.length + lines.cols.length;
    if (clearCount > 0) this.board = clearLines(this.board, lines);
    this.tension.recordPlacement(clearCount);
    this.updateComboMultiplier(clearCount);

    const points =
      (handPiece.cells.length * SCORE_RULES.basePerCell + clearCount * SCORE_RULES.perLineClear) *
      Math.max(this.comboMultiplier, 1);
    this.score += points;
    this.placements += 1;
    if (this.score > this.save.bestScore) {
      this.save.bestScore = this.score;
      this.persist();
    }
    this.analytics.track("block_place", {
      level_id: this.levelKey(),
      stage_id: this.preset.id,
      slot_index: slotIndex,
      score: this.score,
      lines_cleared: clearCount,
    });
    if (clearCount > 0) {
      this.analytics.track("line_clear", {
        level_id: this.levelKey(),
        lines_cleared: clearCount,
        combo_multiplier: this.comboMultiplier,
      });
    }

    this.hand[slotIndex] = this.generateReplacement();
    this.activeSlot = null;
    const completed = this.isObjectiveComplete();
    if (completed) {
      this.markComplete();
    } else {
      this.evaluateNoMoves();
    }
    this.notify();

    return {
      ok: true,
      points,
      clearedRows: [...lines.rows],
      clearedCols: [...lines.cols],
      completed,
    };
  }

  getValidPlacements(slotIndex: number): ValidPlacement[] {
    const handPiece = this.hand[normalizeSlot(slotIndex)];
    return handPiece ? validPlacements(this.board, handPiece) : [];
  }

  getPieceCells(slotIndex: number): readonly { x: number; y: number }[] {
    return this.hand[normalizeSlot(slotIndex)]?.cells ?? [];
  }

  setBoard(board: GridBoard): void {
    this.board = cloneBoard(board);
    this.evaluateNoMoves();
    this.notify();
  }

  setHand(pieceIds: readonly string[]): void {
    this.hand = Array.from({ length: HAND_SLOTS }, (_, index) => {
      const pieceId = pieceIds[index];
      return pieceId ? getPieceById(pieceId) : null;
    });
    this.evaluateNoMoves();
    this.notify();
  }

  async winLevel(): Promise<boolean> {
    if (this.scene !== FlowStates.Playing) this.startStage(this.currentPlayableStage());
    for (let i = 0; i < 160 && this.scene === FlowStates.Playing; i += 1) {
      const move = this.bestMove("win");
      if (!move) {
        this.evaluateNoMoves();
        break;
      }
      this.placePiece(move);
    }
    return this.scene === FlowStates.Complete;
  }

  async failLevel(): Promise<boolean> {
    if (this.scene !== FlowStates.Playing) this.startStage(this.currentPlayableStage());
    this.board = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
    this.hand = FAIL_FIXTURE_PIECES.map((pieceId) => getPieceById(pieceId));
    this.activeSlot = null;
    this.evaluateNoMoves();
    this.notify();
    return this.scene === FlowStates.Failed;
  }

  unlockAll(): void {
    this.save.unlockedStage = BLOCK_BLAST_STAGE_COUNT;
    this.save.completedStages = BLOCK_BLAST_STAGE_PRESETS.map((stage) => stage.id);
    this.persist();
    this.notify();
  }

  grantCoins(amount: number): void {
    this.save.coins = Math.max(0, this.save.coins + Math.trunc(amount));
    this.persist();
    this.notify();
  }

  resetSave(): void {
    this.save = defaultMutableSave();
    this.persist();
    this.notify();
  }

  seedSave(profile: { readonly unlockedLevel?: number; readonly coins?: number }): void {
    if (typeof profile.unlockedLevel === "number") {
      this.save.unlockedStage = Math.max(1, Math.min(BLOCK_BLAST_STAGE_COUNT, Math.trunc(profile.unlockedLevel)));
      this.save.completedStages = BLOCK_BLAST_STAGE_PRESETS
        .filter((stage) => stage.id < this.save.unlockedStage)
        .map((stage) => stage.id);
    }
    if (typeof profile.coins === "number") this.save.coins = Math.max(0, Math.trunc(profile.coins));
    this.persist();
    this.notify();
  }

  snapshot(): BlockBlastSnapshot {
    return {
      scene: this.scene,
      status: this.status,
      inputReady: this.inputReady,
      settingsOpen: this.settingsOpen,
      mode: this.mode,
      stageId: this.preset.id,
      stageTitle: this.preset.title,
      objective: this.preset.objective,
      score: this.score,
      bestScore: this.save.bestScore,
      placements: this.placements,
      comboMultiplier: this.comboMultiplier,
      boardFillRatio: getBoardFillRatio(this.board),
      unlockedStage: this.save.unlockedStage,
      completedStages: [...this.save.completedStages],
      coins: this.save.coins,
      board: cloneBoard(this.board),
      handPieceIds: this.hand.map((piece) => piece?.id ?? null),
      activeSlot: this.activeSlot,
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

  private startRun(): void {
    this.scene = FlowStates.Playing;
    this.status = "playing";
    this.inputReady = true;
    this.settingsOpen = false;
    this.board = createEmptyBoard();
    this.score = 0;
    this.placements = 0;
    this.comboMultiplier = 1;
    this.activeSlot = null;
    this.random = mulberry32(this.preset.seed);
    this.tension = createTensionTracker(this.preset.flow);
    this.hand = generateHand(HAND_SLOTS, this.generationContext());
    this.analytics.levelStart({ level_id: this.levelKey(), level_index: Math.max(0, this.preset.id - 1) });
    this.notify();
  }

  private generationContext() {
    const fillRatio = getBoardFillRatio(this.board);
    return {
      placementCount: this.placements,
      board: this.board,
      fillRatio,
      tension: this.tension.tension(fillRatio),
      nearMissLines: scanNearMisses(this.board, this.preset.flow.nearMissSeeding.maxEmptyCells),
      flow: this.preset.flow,
      progression: this.preset.progression,
      random: this.random,
    };
  }

  private generateReplacement(): PieceDefinition {
    const usedIds = new Set(this.hand.flatMap((piece) => (piece ? [piece.id] : [])));
    let candidate = generatePiece(this.generationContext());
    for (let attempt = 0; attempt < 20 && usedIds.has(candidate.id); attempt += 1) {
      candidate = generatePiece(this.generationContext());
    }
    return candidate;
  }

  private updateComboMultiplier(clearCount: number): void {
    if (clearCount <= 0) this.comboMultiplier = Math.max(1, this.comboMultiplier - 1);
    else this.comboMultiplier += clearCount;
  }

  private isObjectiveComplete(): boolean {
    if (this.preset.objective.kind === "endless") return false;
    if (this.preset.objective.kind === "score") return this.score >= this.preset.objective.target;
    return this.placements >= this.preset.objective.target;
  }

  private markComplete(): void {
    this.scene = FlowStates.Complete;
    this.status = "won";
    this.inputReady = false;
    this.settingsOpen = false;
    if (this.mode === "saga" && this.preset.id > 0) {
      if (!this.save.completedStages.includes(this.preset.id)) {
        this.save.completedStages.push(this.preset.id);
        this.save.completedStages.sort((a, b) => a - b);
        this.save.coins += 1;
      }
      this.save.unlockedStage = Math.max(this.save.unlockedStage, Math.min(BLOCK_BLAST_STAGE_COUNT, this.preset.id + 1));
      this.persist();
      this.analytics.levelComplete({ level_id: this.levelKey(), level_index: this.preset.id - 1 });
    }
  }

  private markFailed(): void {
    this.scene = FlowStates.Failed;
    this.status = "lost";
    this.inputReady = false;
    this.settingsOpen = false;
    this.analytics.levelFail({
      level_id: this.levelKey(),
      level_index: Math.max(0, this.preset.id - 1),
      reason: "no_fit",
    });
  }

  private evaluateNoMoves(): void {
    if (this.scene !== FlowStates.Playing) return;
    const pieces = this.hand.filter((piece): piece is PieceDefinition => piece !== null);
    if (!canAnyPieceFit(this.board, pieces)) this.markFailed();
  }

  private bestMove(mode: "win" | "fail"): PlacementCommand | null {
    let best: { readonly move: PlacementCommand; readonly score: number } | null = null;
    for (let slotIndex = 0; slotIndex < this.hand.length; slotIndex += 1) {
      const piece = this.hand[slotIndex];
      if (!piece) continue;
      for (const placement of validPlacements(this.board, piece)) {
        const scored = this.scoreMove(piece, placement.anchorX, placement.anchorY, mode);
        if (!best || scored > best.score) {
          best = { move: { slotIndex, ...placement }, score: scored };
        }
      }
    }
    return best?.move ?? null;
  }

  private scoreMove(piece: PieceDefinition, anchorX: number, anchorY: number, mode: "win" | "fail"): number {
    const placed = applyPiece(this.board, piece, anchorX, anchorY);
    const lines = detectClearedLines(placed);
    const linesCleared = lines.rows.length + lines.cols.length;
    const afterBoard = linesCleared > 0 ? clearLines(placed, lines) : placed;
    const fill = getBoardFillRatio(afterBoard);
    const points = piece.cells.length * SCORE_RULES.basePerCell + linesCleared * SCORE_RULES.perLineClear;
    const rowHeight = afterBoard.reduce((sum, row) => sum + row.filter((cell) => cell !== null).length, 0);
    const winScore = linesCleared * 220 + points * 8 - fill * 90 - rowHeight;
    if (mode === "win") return winScore;
    return fill * 260 + piece.cells.length * 20 - linesCleared * 420 - points;
  }

  private currentPlayableStage(): number {
    return Math.max(1, Math.min(this.save.unlockedStage, BLOCK_BLAST_STAGE_COUNT));
  }

  private emptyPlacement(reason: PlacementResult["reason"]): PlacementResult {
    return {
      ok: false,
      reason,
      points: 0,
      clearedRows: [],
      clearedCols: [],
      completed: false,
    };
  }

  private levelKey(): string {
    return this.mode === "endless" ? "endless" : `stage-${this.preset.id}`;
  }

  private persist(): void {
    savePersistedJson(SAVE_KEY, {
      bestScore: this.save.bestScore,
      unlockedStage: this.save.unlockedStage,
      completedStages: [...this.save.completedStages],
      coins: this.save.coins,
    } satisfies SaveData);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function normalizeSlot(slotIndex: number): number {
  return Math.max(0, Math.min(HAND_SLOTS - 1, Math.trunc(slotIndex)));
}

function defaultSave(): SaveData {
  return {
    bestScore: 0,
    unlockedStage: 1,
    completedStages: [],
    coins: 0,
  };
}

function defaultMutableSave(): MutableSaveData {
  const save = defaultSave();
  return { ...save, completedStages: [...save.completedStages] };
}

function isSaveData(parsed: Partial<SaveData>): boolean {
  return (
    typeof parsed.bestScore === "number" &&
    typeof parsed.unlockedStage === "number" &&
    Array.isArray(parsed.completedStages) &&
    parsed.completedStages.every((stage) => typeof stage === "number") &&
    typeof parsed.coins === "number"
  );
}

export function createBlockBlastController(options: BlockBlastControllerOptions = {}): BlockBlastController {
  return new BlockBlastFlowController(options);
}
