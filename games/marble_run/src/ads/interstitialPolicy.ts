/**
 * Interstitial eligibility policy (publisher spec, 2026-07-24).
 *
 *   level < firstLevel                    → no ads at all
 *   firstLevel <= level < failOnlyUntil   → only after a FAIL, fail cooldown
 *   level >= failOnlyUntil                → any level end, per-trigger cooldown
 *
 * The two cooldowns are separate values on purpose: the publisher wants to tune
 * post-fail and post-win frequency independently. Both are expressed as a
 * minimum interval since the LAST interstitial (whatever triggered it), which is
 * the interval the ad provider already enforces — this module decides whether to
 * ask and with which interval, and never tracks impression state itself.
 *
 * Pure by design: no imports, no clock, no remote-config coupling. The caller
 * reads the values and passes them in, which is what makes the table-driven
 * unit tests possible.
 */

export type InterstitialTrigger = 'level_complete' | 'level_fail';

export interface InterstitialPolicyConfig {
  enabled: boolean;
  firstLevel: number;
  failOnlyUntilLevel: number;
  failCooldownS: number;
  levelEndCooldownS: number;
}

export type InterstitialDecision =
  | { allowed: true; minIntervalMs: number }
  | { allowed: false; reason: 'disabled' | 'below-first-level' | 'fail-only-window' };

export interface InterstitialPolicyInput {
  /** 1-based level number the player just finished. */
  levelNumber: number;
  trigger: InterstitialTrigger;
  config: InterstitialPolicyConfig;
}

export function decideInterstitial({
  levelNumber,
  trigger,
  config,
}: InterstitialPolicyInput): InterstitialDecision {
  if (!config.enabled) {
    return { allowed: false, reason: 'disabled' };
  }
  if (levelNumber < config.firstLevel) {
    return { allowed: false, reason: 'below-first-level' };
  }
  if (trigger === 'level_complete' && levelNumber < config.failOnlyUntilLevel) {
    return { allowed: false, reason: 'fail-only-window' };
  }
  const cooldownS = trigger === 'level_fail' ? config.failCooldownS : config.levelEndCooldownS;
  return { allowed: true, minIntervalMs: Math.max(0, cooldownS) * 1000 };
}
