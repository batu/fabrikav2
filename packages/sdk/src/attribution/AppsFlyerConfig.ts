import { envString, parseBooleanEnv, requiredValue } from '../config-env.ts';

export interface AppsFlyerConfig {
  devKey: string;
  appleAppId: string | null;
  debugLogging: boolean;
  attWaitSeconds: number;
}

export type AppsFlyerConfigResult =
  | {
      enabled: true;
      config: AppsFlyerConfig;
    }
  | {
      enabled: false;
      reason: string;
      missingKeys: string[];
    };

export type AppsFlyerEnv = Record<string, string | boolean | undefined>;

interface AppsFlyerImportMetaEnv extends AppsFlyerEnv {
  PROD?: boolean;
}

const env = ((import.meta as unknown as { env?: AppsFlyerImportMetaEnv }).env ?? {}) as AppsFlyerImportMetaEnv;

/** iOS waits this long for ATT resolution before AppsFlyer starts (SDK default idiom). */
const DEFAULT_ATT_WAIT_SECONDS = 60;

export function readAppsFlyerConfig(
  platform: string,
  appsFlyerEnv: AppsFlyerEnv = env,
  isProductionBuild: boolean = productionDefault(appsFlyerEnv),
): AppsFlyerConfigResult {
  if (!parseBooleanEnv(appsFlyerEnv.VITE_APPSFLYER_ENABLED, false)) {
    return {
      enabled: false,
      reason: 'VITE_APPSFLYER_ENABLED is not true',
      missingKeys: [],
    };
  }

  if (platform !== 'ios' && platform !== 'android') {
    return {
      enabled: false,
      reason: `AppsFlyer disabled on ${platform || 'web'} platform`,
      missingKeys: [],
    };
  }

  const devKey = envString(appsFlyerEnv.VITE_APPSFLYER_DEV_KEY);
  const appleAppId = envString(appsFlyerEnv.VITE_APPSFLYER_APPLE_APP_ID);

  const missingKeys: string[] = [];
  if (devKey === null) missingKeys.push('VITE_APPSFLYER_DEV_KEY');
  if (platform === 'ios' && appleAppId === null) missingKeys.push('VITE_APPSFLYER_APPLE_APP_ID');

  if (missingKeys.length > 0) {
    return {
      enabled: false,
      reason: `missing AppsFlyer config: ${missingKeys.join(', ')}`,
      missingKeys,
    };
  }

  if (platform === 'ios' && !isNumericAppId(requiredValue(appleAppId))) {
    return {
      enabled: false,
      reason: 'VITE_APPSFLYER_APPLE_APP_ID must be the numeric App Store id',
      missingKeys: [],
    };
  }

  return {
    enabled: true,
    config: {
      devKey: requiredValue(devKey),
      appleAppId: platform === 'ios' ? appleAppId : null,
      debugLogging: !isProductionBuild && parseBooleanEnv(appsFlyerEnv.VITE_APPSFLYER_DEBUG_LOGGING, false),
      attWaitSeconds: platform === 'ios' ? DEFAULT_ATT_WAIT_SECONDS : 0,
    },
  };
}

export function redactAppsFlyerKey(value: string): string {
  if (value.length <= 6) return '<redacted>';
  return `<redacted:${value.slice(-4)}>`;
}

function productionDefault(appsFlyerEnv: AppsFlyerEnv): boolean {
  return typeof appsFlyerEnv.PROD === 'boolean' ? appsFlyerEnv.PROD : true;
}

function isNumericAppId(value: string): boolean {
  return /^\d+$/.test(value);
}
