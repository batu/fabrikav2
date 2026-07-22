// Wizard feature adapters for the already-durable FTD starts (R23).
//
// Every start is a durable POST with a caller-chosen Request ID, observed
// through the one polling observer; there is no per-feature transport,
// timer, or shadow storage. Repeating a lost start with the same Request ID
// reattaches to the same Job (AE4).

import type { JobResource } from '../../api/generated.ts';
import type { JobsTransport } from '../../api/http.ts';
import type { FtdDogIntent, FtdSceneIntent } from '../prompts/intents.ts';
import { type JobObserver, observeJob } from '../../jobs/observeJob.ts';

export interface DurableStartContext {
  transport: JobsTransport;
  sessionId: string;
  revision: string;
  requestId: string;
}

export interface DurableStart {
  job: JobResource;
  observer: JobObserver;
}

export async function startDurable(
  context: DurableStartContext,
  kind: string,
  inputs: Record<string, unknown>,
): Promise<DurableStart> {
  const job = await context.transport.startAction(kind, {
    requestId: context.requestId,
    sessionId: context.sessionId,
    revision: context.revision,
    inputs,
  });
  const observer = observeJob({
    transport: context.transport,
    requestId: context.requestId,
    sessionId: context.sessionId,
    jobId: job.jobId,
  });
  return { job, observer };
}

export function startBackgroundGeneration(
  context: DurableStartContext,
  inputs: { sceneIntent: FtdSceneIntent },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.background_generate', inputs);
}

export function startCropInpaint(
  context: DurableStartContext,
  inputs: { dogId: string; hitbox: Record<string, number>; dogIntent: FtdDogIntent },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.crop_inpaint', inputs);
}

export function startRetryFailedDogs(
  context: DurableStartContext,
  inputs: {
    dogs: { dogId: string; hitbox: Record<string, number>; dogIntent: FtdDogIntent }[];
  },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.retry_failed_dogs', inputs);
}

export function startBandGeneration(
  context: DurableStartContext,
  inputs: { bandIndex: number },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.band_generate', inputs);
}

export function startMagentaInpaint(
  context: DurableStartContext,
  inputs: { dogIntent: FtdDogIntent; hitboxes: Record<string, number>[] },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.magenta_inpaint', inputs);
}

export function startDogRegeneration(
  context: DurableStartContext,
  inputs: { dogId: string; hitbox: Record<string, number>; dogIntent: FtdDogIntent },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.dog_regenerate', inputs);
}

export function startDogVariantUpscale(
  context: DurableStartContext,
  inputs: { target: 'dog_variant' | 'background'; dogId?: string; hitbox?: Record<string, number>; model: string },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.dog_variant_upscale', inputs);
}

export function startMultiSceneGeneration(
  context: DurableStartContext,
  inputs: { sceneCount: number },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.multi_scene_generate', inputs);
}
