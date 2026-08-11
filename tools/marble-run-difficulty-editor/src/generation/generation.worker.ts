/// <reference lib="webworker" />

import { canonicalDifficultyJson, createDefaultDifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-contract.ts';
import { expandDifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-expand.ts';
import { slotFor } from '../../../../games/marble_run/src/levels/funnel-schedule.ts';
import { bakeLevel, type PriorBakeEvidence } from '../../../../games/marble_run/src/levels/level-bake.ts';
import { LEVELS } from '../../../../games/marble_run/src/levels/levels.generated.ts';
import { LEVEL_MANIFEST } from '../../../../games/marble_run/src/levels/levels.manifest.generated.ts';
import type { ShapeKind } from '../../../../games/marble_run/src/marble-board/shapes.ts';
import { scoreLevel } from '../../../../games/marble_run/src/marble-board/score.ts';

import type { GenerationRequest, GenerationResponse } from './protocol.ts';
import { effectiveGenerationInput } from './effectiveParams.ts';

const worker = self as DedicatedWorkerGlobalScope;
const baselineExpanded = expandDifficultyDraft(createDefaultDifficultyDraft());

function publish(message: GenerationResponse): void { worker.postMessage(message); }

worker.onmessage = ({ data }: MessageEvent<GenerationRequest>): void => {
  if (data.type !== 'generate') return;
  const startedAt = performance.now();
  publish({ type: 'started', revision: data.revision });
  const expanded = expandDifficultyDraft(data.draft);
  const accepted = new Map(data.accepted.map((result) => [result.level.id, result]));
  const ids = [...new Set(data.levelIds)].sort((a, b) => a - b);

  for (const levelId of ids) {
    const effective = expanded[levelId - 1];
    if (effective === undefined || effective.overrideState === 'locked') continue;
    const previous = accepted.get(levelId - 1)?.evidence.shapeKind ?? LEVEL_MANIFEST[levelId - 2]?.shapeKind ?? null;
    const generation = effectiveGenerationInput(effective, baselineExpanded[levelId - 1]!, previous);
    const shapeKind: ShapeKind = generation.shapeKind;
    const priorEvidence: PriorBakeEvidence[] = [...accepted.values()].map(({ evidence }) => evidence);
    if (effective.role === 'climax') {
      for (let priorId = Math.max(1, levelId - 18); priorId < levelId; priorId += 1) {
        if (slotFor(priorId) !== 'spike' || accepted.has(priorId)) continue;
        priorEvidence.push({ levelId: priorId, slot: 'spike', measuredDifficulty: scoreLevel(LEVELS[priorId - 1]!) });
      }
    }
    const seed = effective.seed.provenance === 'unknown' ? undefined : effective.seed.seed;
    const baked = bakeLevel({
      id: levelId,
      shapeKind,
      priorEvidence,
      targetRange: effective.targetRange,
      seed,
      overrideState: effective.overrideState,
      params: generation.params,
      requiredShapeMarker: effective.spotlightMechanic === 'plugs' ? 'X' : effective.spotlightMechanic === 'voids' ? '#' : null,
    });
    if (!baked.ok) {
      publish({ type: 'failed', revision: data.revision, levelId, failure: baked.failure });
      continue;
    }
    const result = {
      level: baked.level,
      evidence: baked.evidence,
      effectiveInputFingerprint: canonicalDifficultyJson(effective),
      seed: baked.evidence.seed.provenance === 'unknown' ? 0 : baked.evidence.seed.seed,
    };
    accepted.set(levelId, result);
    publish({ type: 'accepted', revision: data.revision, result });
  }
  publish({ type: 'complete', revision: data.revision, computeMs: performance.now() - startedAt });
};
