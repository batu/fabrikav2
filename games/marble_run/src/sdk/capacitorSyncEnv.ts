import { loadEnv } from 'vite';

type EnvLike = Record<string, string | undefined>;
type EnvLoader = (mode: string, cwd: string, prefix: string) => Record<string, string>;

/** Capacitor evaluates its config outside Vite, so load the same production
 * env file used by `vite build` before deciding which native plugins to bridge.
 * Explicit shell values win, preserving CI/release overrides. */
export function loadCapacitorSyncEnv(
  processEnv: EnvLike,
  cwd: string,
  loader: EnvLoader = loadEnv,
): EnvLike {
  const mode = processEnv.NODE_ENV === 'development' ? 'development' : 'production';
  return { ...loader(mode, cwd, ''), ...processEnv };
}
