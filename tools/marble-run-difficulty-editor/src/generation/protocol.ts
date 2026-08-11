import type { DifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-contract.ts';
import type { BakeEvidence, BakeFailure } from '../../../../games/marble_run/src/levels/level-bake.ts';
import type { LevelDef } from '../../../../games/marble_run/src/marble-board/types.ts';

export const GENERATION_ENGINE_VERSION = 'marble-run-bake-v1' as const;

export interface AcceptedLevel {
  readonly level: LevelDef;
  readonly evidence: BakeEvidence;
  readonly effectiveInputFingerprint: string;
  readonly seed: number;
}

export interface GenerationRequest {
  readonly type: 'generate';
  readonly revision: number;
  readonly draft: DifficultyDraft;
  readonly levelIds: readonly number[];
  readonly accepted: readonly AcceptedLevel[];
}

export type GenerationResponse =
  | { readonly type: 'started'; readonly revision: number }
  | { readonly type: 'accepted'; readonly revision: number; readonly result: AcceptedLevel }
  | { readonly type: 'failed'; readonly revision: number; readonly levelId: number; readonly failure: BakeFailure }
  | { readonly type: 'complete'; readonly revision: number; readonly computeMs: number };

export function isGenerationResponse(value: unknown): value is GenerationResponse {
  if (value === null || typeof value !== 'object') return false;
  const message = value as Partial<GenerationResponse>;
  return Number.isInteger(message.revision)
    && (message.type === 'started' || message.type === 'accepted' || message.type === 'failed' || message.type === 'complete');
}
