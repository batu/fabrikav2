import { Capacitor } from '@capacitor/core';

/**
 * CDN + experiment configuration for Find the Dog.
 *
 * Phase 2 of the CDN level-streaming rollout only activates cohort
 * tagging; the base URL is consumed once Phase 3 wires levels.ts
 * through ManifestClient + AssetCache. Keeping the constants here
 * so the wiring order is documented and the Phase 3 swap is a
 * localized change.
 *
 * See docs/plans/2026-04-14-003-feat-cdn-level-streaming-plan.md.
 */

/** The AB experiment that the cohort_bucket user property refers to. */
export const EXPERIMENT_ID = 'ftd_levelset_v1';

/** Number of cohort buckets. 100 gives percentage-point granularity. */
export const COHORT_BUCKET_COUNT = 100;

export type CdnRuntimeEnv = Record<string, string | boolean | undefined>;

const DEFAULT_CDN_ORIGIN = 'https://ftd-level-origin.batuaytemiz.workers.dev';

function envString(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveCdnOriginForRuntime(
  env: CdnRuntimeEnv,
  platform: string,
  mode: string,
): string | null {
  if (isCdnDisabledByEnv(env)) return null;

  if (platform === 'android') {
    return envString(env.VITE_CDN_ORIGIN_ANDROID) ?? envString(env.VITE_CDN_ORIGIN_PROD) ?? DEFAULT_CDN_ORIGIN;
  }

  return mode === 'production'
    ? envString(env.VITE_CDN_ORIGIN_PROD) ?? DEFAULT_CDN_ORIGIN
    : envString(env.VITE_CDN_ORIGIN_DEV) ?? DEFAULT_CDN_ORIGIN;
}

export function isCdnDisabledByEnv(env: CdnRuntimeEnv): boolean {
  return env.VITE_CDN_ENABLED === 'false';
}

export function isCdnExplicitlyDisabled(): boolean {
  return isCdnDisabledByEnv(import.meta.env as unknown as CdnRuntimeEnv);
}

/**
 * Origin the CDN manifest + assets are served from. Gated on Vite's
 * `MODE` (not `DEV`) because dev-built APKs have DEV=false — the
 * MODE gate reliably distinguishes development from production.
 * See docs/solutions/2026-04-14-vite-env-mode-vs-dev.md.
 *
 * Returns `null` when the CDN origin is unset. In that case the game
 * continues to serve levels from the bundled `public/levels/` path.
 */
export function getCdnOrigin(): string | null {
  return resolveCdnOriginForRuntime(
    import.meta.env as unknown as CdnRuntimeEnv,
    Capacitor.getPlatform(),
    import.meta.env.MODE,
  );
}
