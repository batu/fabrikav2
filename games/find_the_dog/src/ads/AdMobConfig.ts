type Env = Record<string, string | boolean | undefined>;

export type AdMobIosConfigResult = {
  enabled: false;
  reason: string;
  missingKeys: string[];
  invalidKeys: string[];
};

/** Find the Dog's production iOS shell is intentionally ad-free. Keep this
 * decision deterministic even when stale or copied AdMob env values are present. */
export function readAdMobIosConfig(_env: Env): AdMobIosConfigResult {
  return {
    enabled: false,
    reason: 'iOS ads are disabled by release policy',
    missingKeys: [],
    invalidKeys: [],
  };
}

export function adMobIosConfigPresent(_env: Env): boolean {
  return false;
}
