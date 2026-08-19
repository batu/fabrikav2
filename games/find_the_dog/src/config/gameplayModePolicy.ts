import type { GameMode } from '../core/GameState';

export const GAMEPLAY_MODE_POLICIES = ['classic', 'restoration', 'player'] as const;
export type GameplayModePolicy = (typeof GAMEPLAY_MODE_POLICIES)[number];

export function isGameplayModePolicy(value: string): value is GameplayModePolicy {
  return GAMEPLAY_MODE_POLICIES.includes(value as GameplayModePolicy);
}

export function resolveGameplayMode(policy: GameplayModePolicy, playerSetting: GameMode): GameMode {
  return policy === 'player' ? playerSetting : policy;
}
