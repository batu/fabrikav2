import type { FlowStates } from "@fabrikav2/kernel";

export type PieceTier = "simple" | "mid" | "awkward";

export interface CellOffset {
  readonly x: number;
  readonly y: number;
}

export interface PieceDefinition {
  readonly id: string;
  readonly tier: PieceTier;
  readonly colorIndex: number;
  readonly cells: readonly CellOffset[];
}

export type GridCell = number | null;
export type GridBoard = readonly (readonly GridCell[])[];

export type MutableGridBoard = Array<Array<GridCell>>;

export interface ClearedLines {
  readonly rows: readonly number[];
  readonly cols: readonly number[];
}

export interface NearMissInfo {
  readonly type: "row" | "col";
  readonly index: number;
  readonly emptyCells: readonly CellOffset[];
}

export interface ProgressionConfig {
  readonly earlyRoundMax: number;
  readonly midRoundMax: number;
  readonly safetyNetFillThreshold: number;
}

export interface FlowAlgorithmConfig {
  readonly placementAware: {
    readonly enabled: boolean;
    readonly activationFillThreshold: number;
    readonly maxRerolls: number;
  };
  readonly tensionCurve: {
    readonly enabled: boolean;
    readonly targetMin: number;
    readonly targetMax: number;
    readonly fillWeight: number;
    readonly clearRateWeight: number;
    readonly windowSize: number;
    readonly boostFactor: number;
  };
  readonly nearMissSeeding: {
    readonly enabled: boolean;
    readonly completerBoost: number;
    readonly doubleLineBoost: number;
    readonly maxCompleterRatio: number;
    readonly maxEmptyCells: number;
  };
}

export interface GenerationContext {
  readonly placementCount: number;
  readonly board: GridBoard;
  readonly fillRatio: number;
  readonly tension: number;
  readonly nearMissLines: readonly NearMissInfo[];
  readonly flow: FlowAlgorithmConfig;
  readonly progression: ProgressionConfig;
  readonly random: () => number;
}

export type StageObjective =
  | { readonly kind: "score"; readonly target: number }
  | { readonly kind: "placements"; readonly target: number }
  | { readonly kind: "endless" };

export interface StagePreset {
  readonly id: number;
  readonly title: string;
  readonly seed: number;
  readonly objective: StageObjective;
  readonly flow: FlowAlgorithmConfig;
  readonly progression: ProgressionConfig;
}

export type BlockBlastScene =
  | typeof FlowStates.Menu
  | typeof FlowStates.Playing
  | typeof FlowStates.Complete
  | typeof FlowStates.Failed
  | typeof FlowStates.Paused;

export type BlockBlastStatus = "idle" | "playing" | "won" | "lost" | "paused";
export type BlockBlastMode = "saga" | "endless";

export interface ValidPlacement {
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface PlacementCommand {
  readonly slotIndex: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface PlacementResult {
  readonly ok: boolean;
  readonly reason?: "missing-slot" | "invalid-placement" | "not-playing";
  readonly points: number;
  readonly clearedRows: readonly number[];
  readonly clearedCols: readonly number[];
  readonly completed: boolean;
}

export interface BlockBlastSnapshot {
  readonly scene: BlockBlastScene;
  readonly status: BlockBlastStatus;
  readonly inputReady: boolean;
  readonly settingsOpen: boolean;
  readonly mode: BlockBlastMode;
  readonly stageId: number;
  readonly stageTitle: string;
  readonly objective: StageObjective;
  readonly score: number;
  readonly bestScore: number;
  readonly placements: number;
  readonly comboMultiplier: number;
  readonly boardFillRatio: number;
  readonly unlockedStage: number;
  readonly completedStages: readonly number[];
  readonly coins: number;
  readonly board: GridBoard;
  readonly handPieceIds: readonly (string | null)[];
  readonly activeSlot: number | null;
}
