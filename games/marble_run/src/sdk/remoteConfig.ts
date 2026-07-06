/**
 * Marble Run remote-config schema. Declares the game's ad-cadence + offer flags
 * once; the composition root feeds these into the interstitial cadence decision
 * (`shouldShowInterstitial`) and the rewarded-hint gate. On web/CI the service
 * is built with NO provider — every `value()` returns the schema default
 * (deterministic tests). A native Firebase Remote Config adapter is a later,
 * game-supplied `RemoteConfigProvider` (Blocked-on-Batu).
 */
import {
  booleanField,
  numberField,
  type ConfigSchema,
} from '@fabrikav2/services/remote-config';

export const marbleRemoteConfigSchema = {
  /** Show an interstitial every N completed levels (0 disables level cadence). */
  interstitialEveryNLevels: numberField(3, {
    remoteKey: 'interstitial_every_n_levels',
    validate: (v) => v >= 0,
  }),
  /** Never show interstitials before the player reaches this level. */
  interstitialMinLevel: numberField(2, {
    remoteKey: 'interstitial_min_level',
    validate: (v) => v >= 0,
  }),
  /** Minimum seconds between interstitials (the provider time-cap). */
  interstitialMinIntervalS: numberField(60, {
    remoteKey: 'interstitial_min_interval_s',
    validate: (v) => v >= 0,
  }),
  /** When true, tapping Hint offers a rewarded ad instead of the coin cost. */
  hintRewardedEnabled: booleanField(true, {
    remoteKey: 'hint_rewarded_enabled',
  }),
} satisfies ConfigSchema;

export type MarbleRemoteConfigSchema = typeof marbleRemoteConfigSchema;
