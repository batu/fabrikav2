import type { FlowAlgorithmConfig, ProgressionConfig, StagePreset } from "../src/game/types.ts";

const defaultProgression = {
  earlyRoundMax: 3,
  midRoundMax: 20,
  safetyNetFillThreshold: 0.6,
} as const satisfies ProgressionConfig;

const defaultFlow = {
  placementAware: {
    enabled: true,
    activationFillThreshold: 0.5,
    maxRerolls: 3,
  },
  tensionCurve: {
    enabled: true,
    targetMin: 0.35,
    targetMax: 0.55,
    fillWeight: 0.6,
    clearRateWeight: 0.4,
    windowSize: 8,
    boostFactor: 2,
  },
  nearMissSeeding: {
    enabled: true,
    completerBoost: 2.5,
    doubleLineBoost: 1.5,
    maxCompleterRatio: 0.5,
    maxEmptyCells: 2,
  },
} as const satisfies FlowAlgorithmConfig;

function flowFor(index: number): FlowAlgorithmConfig {
  const ramp = index / 19;
  return {
    placementAware: {
      enabled: true,
      activationFillThreshold: Math.max(0.42, defaultFlow.placementAware.activationFillThreshold - ramp * 0.08),
      maxRerolls: index < 6 ? 5 : index < 14 ? 4 : 3,
    },
    tensionCurve: {
      enabled: true,
      targetMin: Number((0.28 + ramp * 0.1).toFixed(2)),
      targetMax: Number((0.5 + ramp * 0.14).toFixed(2)),
      fillWeight: Number((0.56 + ramp * 0.12).toFixed(2)),
      clearRateWeight: Number((0.44 - ramp * 0.12).toFixed(2)),
      windowSize: index < 8 ? 10 : index < 15 ? 8 : 6,
      boostFactor: Number((1.7 + ramp * 0.9).toFixed(2)),
    },
    nearMissSeeding: {
      enabled: true,
      completerBoost: Number((3 - ramp * 0.9).toFixed(2)),
      doubleLineBoost: Number((1.65 - ramp * 0.35).toFixed(2)),
      maxCompleterRatio: Number((0.58 - ramp * 0.18).toFixed(2)),
      maxEmptyCells: index < 10 ? 2 : 1,
    },
  };
}

function progressionFor(index: number): ProgressionConfig {
  return {
    earlyRoundMax: Math.max(1, defaultProgression.earlyRoundMax - Math.floor(index / 8)),
    midRoundMax: Math.max(9, defaultProgression.midRoundMax - Math.floor(index * 0.55)),
    safetyNetFillThreshold: Number((defaultProgression.safetyNetFillThreshold + index * 0.008).toFixed(2)),
  };
}

function objectiveFor(index: number): StagePreset["objective"] {
  if (index % 4 === 0) return { kind: "placements", target: 8 + index };
  return { kind: "score", target: 26 + index * 14 };
}

export const BLOCK_BLAST_STAGE_PRESETS = Array.from({ length: 20 }, (_, i): StagePreset => {
  const id = i + 1;
  return {
    id,
    title: `Stage ${id}`,
    seed: 0x5eed1000 + id * 7919,
    objective: objectiveFor(id),
    flow: flowFor(i),
    progression: progressionFor(i),
  };
});

export const ENDLESS_PRESET = {
  id: 0,
  title: "Endless",
  seed: 0x5eedf00d,
  objective: { kind: "endless" },
  flow: defaultFlow,
  progression: defaultProgression,
} as const satisfies StagePreset;

export const BLOCK_BLAST_STAGE_COUNT = BLOCK_BLAST_STAGE_PRESETS.length;

export function getStagePreset(id: number): StagePreset {
  return BLOCK_BLAST_STAGE_PRESETS[Math.max(1, Math.min(BLOCK_BLAST_STAGE_COUNT, Math.trunc(id))) - 1]!;
}
