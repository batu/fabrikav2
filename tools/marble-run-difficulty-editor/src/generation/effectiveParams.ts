import type { ExpandedDifficultyLevel } from '../../../../games/marble_run/src/levels/difficulty-expand.ts';
import type { Feature } from '../../../../games/marble_run/src/levels/funnel-schedule.ts';
import { bakeParamsFor, buildBakeGates, pickShapeKind, resolveBakeSymmetry } from '../../../../games/marble_run/src/levels/level-bake.ts';
import type { GenerateParams } from '../../../../games/marble_run/src/marble-board/generate.ts';
import { ALL_SHAPE_KINDS, buildShape, type ShapeKind } from '../../../../games/marble_run/src/marble-board/shapes.ts';
import { ALL_MARBLE_COLORS, type GateDef, type MarbleColor } from '../../../../games/marble_run/src/marble-board/types.ts';

const COLOR_FEATURES: Readonly<Record<MarbleColor, Feature | null>> = {
  red: null,
  blue: null,
  green: 'green',
  yellow: 'yellow',
  purple: 'purple',
  orange: 'orange',
};

export interface EffectiveGenerationInput {
  readonly shapeKind: ShapeKind;
  readonly params: Partial<Omit<GenerateParams, 'id' | 'seed'>>;
}

function dimensions(level: ExpandedDifficultyLevel, baseline: ExpandedDifficultyLevel, base: ReturnType<typeof bakeParamsFor>): { cols: number; rows: number } {
  const override = level.overrideValues.dimensions as { readonly cols: number; readonly rows: number } | undefined;
  if (override !== undefined) return override;
  if (level.resolvedMappings.boardArea === baseline.resolvedMappings.boardArea) return { cols: base.cols, rows: base.rows };
  const area = Math.max(16, Math.round(level.resolvedMappings.boardArea));
  const cols = Math.max(4, Math.min(20, Math.round(Math.sqrt(area * base.cols / base.rows))));
  return { cols, rows: Math.max(4, Math.min(20, Math.round(area / cols))) };
}

function palette(level: ExpandedDifficultyLevel, baseline: ExpandedDifficultyLevel, base: ReturnType<typeof bakeParamsFor>): readonly MarbleColor[] {
  const colorCap = (level.overrideValues.caps as { readonly colors?: number } | undefined)?.colors;
  const mechanicsChanged = level.availableMechanics.join() !== baseline.availableMechanics.join();
  if (colorCap === undefined && !mechanicsChanged && level.resolvedMappings.colorCount === baseline.resolvedMappings.colorCount) return base.colors;
  const available = ALL_MARBLE_COLORS.filter((color) => {
    const feature = COLOR_FEATURES[color];
    return feature === null || level.availableMechanics.includes(feature);
  });
  const count = Math.max(2, Math.min(available.length, Math.round(colorCap ?? level.resolvedMappings.colorCount)));
  const selected = available.slice(0, count);
  const spotlightColor = ALL_MARBLE_COLORS.find((color) => COLOR_FEATURES[color] === level.spotlightMechanic);
  if (spotlightColor !== undefined && !selected.includes(spotlightColor)) selected[selected.length - 1] = spotlightColor;
  return selected;
}

function supportsMechanics(kind: ShapeKind, cols: number, rows: number, level: ExpandedDifficultyLevel): boolean {
  const board = buildShape(kind, cols, rows).join('');
  return (!board.includes('X') || level.availableMechanics.includes('plugs'))
    && (!board.includes('#') || level.availableMechanics.includes('voids'))
    && (level.spotlightMechanic !== 'plugs' || board.includes('X'))
    && (level.spotlightMechanic !== 'voids' || board.includes('#'));
}

function shapeFor(level: ExpandedDifficultyLevel, baseline: ExpandedDifficultyLevel, previous: ShapeKind | null, cols: number, rows: number): ShapeKind {
  const preferred = pickShapeKind(level.id, previous);
  if (level.availableMechanics.join() === baseline.availableMechanics.join()
    && level.spotlightMechanic === baseline.spotlightMechanic) return preferred;
  if (supportsMechanics(preferred, cols, rows, level)) return preferred;
  return ALL_SHAPE_KINDS.find((kind) => supportsMechanics(kind, cols, rows, level)) ?? 'plain';
}

export function effectiveGenerationInput(level: ExpandedDifficultyLevel, baseline: ExpandedDifficultyLevel, previous: ShapeKind | null): EffectiveGenerationInput {
  const base = bakeParamsFor(level.id, pickShapeKind(level.id, previous));
  const resolvedDimensions = dimensions(level, baseline, base);
  const structuralSpotlight = level.spotlightMechanic === 'plugs' || level.spotlightMechanic === 'voids';
  const cols = structuralSpotlight ? Math.max(6, resolvedDimensions.cols) : resolvedDimensions.cols;
  const rows = structuralSpotlight ? Math.max(6, resolvedDimensions.rows) : resolvedDimensions.rows;
  const shapeKind = shapeFor(level, baseline, previous, cols, rows);
  const shape = buildShape(shapeKind, cols, rows);
  const colors = palette(level, baseline, base);
  const target = (level.targetRange.min + level.targetRange.max) / 2;
  const overrideGates = level.overrideValues.gatePlacement as readonly GateDef[] | undefined;
  const marbleCap = (level.overrideValues.caps as { readonly marbles?: number } | undefined)?.marbles;
  const marbleTarget = level.resolvedMappings.marbleCount === baseline.resolvedMappings.marbleCount
    ? base.marbleTarget
    : Math.max(colors.length, Math.round(level.resolvedMappings.marbleCount));
  const symmetryOverride = level.overrideValues.symmetryMode as GenerateParams['symmetryMode'] | undefined;
  return {
    shapeKind,
    params: {
      cols,
      rows,
      shape,
      colors,
      gates: overrideGates ?? buildBakeGates(shape, colors, target),
      marbleTarget,
      marbleCap: marbleCap ?? (marbleTarget === base.marbleTarget ? base.marbleCap : marbleTarget),
      minOpeners: level.resolvedMappings.openingGenerosity === baseline.resolvedMappings.openingGenerosity ? base.minOpeners : level.resolvedMappings.openingGenerosity,
      minWaves: level.resolvedMappings.solverWaveDepth === baseline.resolvedMappings.solverWaveDepth ? base.minWaves : Math.max(1, Math.round(level.resolvedMappings.solverWaveDepth)),
      symmetryMode: symmetryOverride ?? resolveBakeSymmetry(level.id, shape, marbleTarget, colors.length),
      openerSpread: level.roleRule.spreadOpeningRoutes === baseline.roleRule.spreadOpeningRoutes ? base.openerSpread : level.roleRule.spreadOpeningRoutes,
      lastWavePreference: level.roleRule.finish === baseline.roleRule.finish ? base.lastWavePreference : level.roleRule.finish,
    },
  };
}
