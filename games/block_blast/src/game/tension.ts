import type { FlowAlgorithmConfig } from "./types.ts";

export interface TensionTracker {
  recordPlacement(clearedLines: number): void;
  clearRate(): number;
  tension(fillRatio: number): number;
  reset(): void;
}

export function createTensionTracker(flow: FlowAlgorithmConfig): TensionTracker {
  const clearHistory: number[] = [];

  return {
    recordPlacement(clearedLines: number): void {
      clearHistory.push(clearedLines);
      while (clearHistory.length > flow.tensionCurve.windowSize) clearHistory.shift();
    },
    clearRate(): number {
      if (clearHistory.length === 0) return 0;
      return clearHistory.filter((cleared) => cleared > 0).length / clearHistory.length;
    },
    tension(fillRatio: number): number {
      return (
        fillRatio * flow.tensionCurve.fillWeight +
        (1 - this.clearRate()) * flow.tensionCurve.clearRateWeight
      );
    },
    reset(): void {
      clearHistory.length = 0;
    },
  };
}
