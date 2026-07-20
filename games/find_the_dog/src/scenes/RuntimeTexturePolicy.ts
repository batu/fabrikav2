export const FALLBACK_RUNTIME_TEXTURE_LONG_EDGE = 2560;

/** Use the renderer's real allocation limit; retain the shipped guard without WebGL capability. */
export function resolveRuntimeTextureLongEdge(maxTextureSize: number | null): number {
  if (!Number.isFinite(maxTextureSize) || (maxTextureSize ?? 0) <= 0) {
    return FALLBACK_RUNTIME_TEXTURE_LONG_EDGE;
  }
  return Math.floor(maxTextureSize!);
}

/** Prefer the bundled source-resolution tier only when it can add real detail. */
export function selectRuntimeColorImageUrl(
  fallbackUrl: string,
  sourceWidth: number,
  sourceHeight: number,
  runtimeTextureLongEdge: number,
): string {
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  if (runtimeTextureLongEdge <= FALLBACK_RUNTIME_TEXTURE_LONG_EDGE) return fallbackUrl;
  if (sourceLongEdge <= FALLBACK_RUNTIME_TEXTURE_LONG_EDGE) return fallbackUrl;
  if (sourceLongEdge > runtimeTextureLongEdge) return fallbackUrl;
  if (!/^levels\/[^/]+\/color\.webp$/.test(fallbackUrl)) return fallbackUrl;
  return fallbackUrl.replace(/color\.webp$/, 'color.png');
}
