import type { LevelData } from '../data/levels';
import {
  resolveAnalyticsLevelAttributionFromServingAttempt,
  type AnalyticsLevelAttribution,
} from '../analytics/AnalyticsEventContract';

export interface DogFoundAnalyticsParams extends Partial<AnalyticsLevelAttribution> {
  level_id: string;
  dog_index: number;
  time_since_start: number;
}

export interface HintUsedAnalyticsParams extends Partial<AnalyticsLevelAttribution> {
  level_id: string;
  dogs_found: number;
}

export function buildDogFoundAnalyticsParams(
  level: LevelData,
  dogIndex: number,
  timeSinceStart: number,
): DogFoundAnalyticsParams {
  return {
    level_id: level.id,
    dog_index: dogIndex,
    time_since_start: timeSinceStart,
    ...resolveLevelAttribution(level),
  };
}

export function buildHintUsedAnalyticsParams(level: LevelData, dogsFound: number): HintUsedAnalyticsParams {
  return {
    level_id: level.id,
    dogs_found: dogsFound,
    ...resolveLevelAttribution(level),
  };
}

function resolveLevelAttribution(level: LevelData): AnalyticsLevelAttribution | undefined {
  const servingAttempt = level.servingAttempt;
  if (servingAttempt === undefined) return undefined;
  return resolveAnalyticsLevelAttributionFromServingAttempt(servingAttempt);
}
