export const FALLBACK_RUNTIME_TEXTURE_LONG_EDGE = 2560;

/** Use the renderer's real allocation limit; retain the shipped guard without WebGL capability. */
export function resolveRuntimeTextureLongEdge(maxTextureSize: number | null): number {
  if (!Number.isFinite(maxTextureSize) || (maxTextureSize ?? 0) <= 0) {
    return FALLBACK_RUNTIME_TEXTURE_LONG_EDGE;
  }
  return Math.floor(maxTextureSize!);
}

/** The Capacitor shell serves the app from capacitor://localhost (iOS) or
 *  https://localhost (Android). The native web bundle contains ONLY the assets
 *  listed in bundled-manifest.json — color.webp, never color.png — so the
 *  png upgrade below must not fire there or the scene texture 404s and Phaser
 *  renders its green missing-texture checkerboard. */
export function isNativeShellOrigin(protocol: string | undefined, hostname: string | undefined): boolean {
  if (protocol === 'capacitor:') return true;
  return protocol === 'https:' && hostname === 'localhost';
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
  if (isNativeShellOrigin(globalThis.location?.protocol, globalThis.location?.hostname)) {
    return fallbackUrl;
  }
  return fallbackUrl.replace(/color\.webp$/, 'color.png');
}
