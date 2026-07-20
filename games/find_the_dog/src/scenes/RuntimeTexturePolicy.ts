export const FALLBACK_RUNTIME_TEXTURE_LONG_EDGE = 2560;
// The two shipped portrait classes land at ~2.21x and ~1.52x minification.
// Only the former benefited from a zoom-1 prefilter in the locked fast tier.
const MIN_PREFILTER_DOWNSAMPLE_RATIO = 1.6;

type DisplaySizedTexture = {
  displayWidth: number;
  displayHeight: number;
  setTexture(textureKey: string): unknown;
  setDisplaySize(width: number, height: number): unknown;
};

/** Phaser resets frame-derived display dimensions when a different-sized texture is installed. */
export function setTexturePreservingDisplaySize(image: DisplaySizedTexture, textureKey: string): void {
  const { displayWidth, displayHeight } = image;
  image.setTexture(textureKey);
  image.setDisplaySize(displayWidth, displayHeight);
}

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

/** Size one high-quality prefiltered tier to the zoom-1 screen footprint. */
export function resolvePrefilteredTextureSize(
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
  runtimeTextureLongEdge: number,
): { width: number; height: number } | null {
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  const displayLongEdge = Math.max(displayWidth, displayHeight);
  if (sourceLongEdge / displayLongEdge < MIN_PREFILTER_DOWNSAMPLE_RATIO) return null;
  if (displayLongEdge > runtimeTextureLongEdge) return null;
  return {
    width: Math.max(1, Math.ceil(displayWidth)),
    height: Math.max(1, Math.ceil(displayHeight)),
  };
}

/** Balance sampling error between the prefiltered tier and its full source. */
export function resolvePrefilterSwitchZoom(sourceLongEdge: number, prefilteredLongEdge: number): number {
  if (prefilteredLongEdge <= 0 || sourceLongEdge <= prefilteredLongEdge) return 1;
  return Math.sqrt(sourceLongEdge / prefilteredLongEdge);
}
