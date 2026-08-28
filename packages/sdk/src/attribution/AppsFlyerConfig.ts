import { envString, parseBooleanEnv, requiredValue } from '../config-env.ts';

export interface AppsFlyerConfig {
  devKey: string;
  appleAppId: string | null;
  debugLogging: boolean;
  /** Explicit partner allowlist. Empty is the fail-closed deny-all policy. */
  sharingPartners: readonly string[];
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

  if (platform !== 'ios') {
    return {
      enabled: false,
      reason: `AppsFlyer iOS bridge unavailable on ${platform || 'web'} platform`,
      missingKeys: [],
    };
  }

  const devKey = envString(appsFlyerEnv.VITE_APPSFLYER_DEV_KEY);
  const appleAppId = envString(appsFlyerEnv.VITE_APPSFLYER_APPLE_APP_ID);
  const sharingPartners = readSharingPartners(appsFlyerEnv.VITE_APPSFLYER_SHARING_PARTNERS);
  if (sharingPartners.length > 0) {
    return {
      enabled: false,
      reason: 'partner allowlisting is unsupported by the AppsFlyer iOS SDK; keep deny-all and activate reviewed partners in the dashboard',
      missingKeys: [],
    };
  }

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
      sharingPartners: [],
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

function readSharingPartners(value: string | boolean | undefined): readonly string[] {
  const raw = envString(value);
  if (raw === null) return [];
  return [...new Set(raw.split(',').map((partner) => partner.trim()).filter(Boolean))];
}

function isNumericAppId(value: string): boolean {
  return /^\d+$/.test(value);
}
