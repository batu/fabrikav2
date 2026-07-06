/**
 * `@fabrikav2/services/remote-config` — game-agnostic typed remote-config.
 *
 * Wiring sketch (a game declares its own flags once):
 *
 *   const schema = {
 *     interstitialEveryNLevels: numberField(3, { remoteKey: 'interstitial_every_n_levels', validate: (v) => v >= 0 }),
 *     hintRwEnabled: booleanField(true, { remoteKey: 'hint_rw_enabled' }),
 *     noAdsProductId: stringField('com.example.noads', { validate: (v) => v.trim().length > 0 }),
 *   } satisfies ConfigSchema;
 *
 *   const config = createRemoteConfigService(schema, { provider: firebaseRemoteConfigProvider });
 *   await config.refresh();
 *   const n = config.value('interstitialEveryNLevels'); // number, typed
 *
 * Consumed by sdk/ads cadence (interstitial/rewarded gating) and ui offers
 * (product visibility + prices). The Firebase provider adapter is a game-side
 * seam — this package ships the service, the schema tooling, and the validation.
 */
export {
  booleanField,
  numberField,
  stringField,
  coerceConfigValue,
  defaultValues,
  remoteKeyFor,
  type ConfigFieldDefinition,
  type ConfigPrimitive,
  type ConfigSchema,
  type ConfigValues,
  type ConfigValueType,
  type CoerceResult,
} from './schema.ts';

export {
  createRemoteConfigService,
  type RemoteConfigProvider,
  type RemoteConfigService,
  type RemoteConfigServiceOptions,
  type RemoteConfigSnapshot,
  type RemoteConfigState,
  type ValueOrigin,
} from './service.ts';
