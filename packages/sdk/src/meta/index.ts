export {
  MetaEvents,
  type CapacitorMetaPlugin,
  type MetaBooleanResult,
  type MetaInitializeOptions,
  type MetaLogEventOptions,
  type MetaLogEventResult,
  type MetaSetAdvertiserTrackingOptions,
  type MetaStatusResult,
} from './CapacitorMetaPlugin.ts';
export {
  CapacitorMetaProvider,
  type CapacitorMetaProviderOptions,
} from './CapacitorMetaProvider.ts';
export {
  createMetaProvider,
  DisabledMetaProvider,
  type MetaProviderFactories,
} from './DisabledMetaProvider.ts';
export {
  readMetaConfig,
  redactMetaToken,
  type MetaConfig,
  type MetaConfigResult,
  type MetaEnv,
} from './MetaConfig.ts';
export {
  type MetaEventParams,
  type MetaEventPrimitive,
  type MetaProvider,
  type MetaProviderStatus,
} from './MetaProvider.ts';
