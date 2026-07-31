import type { ConfigResponse, ModelOption } from '../types';

export function getInpaintModels(config: ConfigResponse | null | undefined): ModelOption[] {
  return config?.inpaintModels ?? config?.models ?? [];
}

export function findModelLabel(models: ModelOption[], modelId: string): string {
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}
