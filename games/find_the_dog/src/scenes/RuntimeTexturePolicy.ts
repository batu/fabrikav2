export const FALLBACK_RUNTIME_TEXTURE_LONG_EDGE = 2560;

/** Use the renderer's real allocation limit; retain the shipped guard without WebGL capability. */
export function resolveRuntimeTextureLongEdge(maxTextureSize: number | null): number {
  if (!Number.isFinite(maxTextureSize) || (maxTextureSize ?? 0) <= 0) {
    return FALLBACK_RUNTIME_TEXTURE_LONG_EDGE;
  }
  return Math.floor(maxTextureSize!);
}
