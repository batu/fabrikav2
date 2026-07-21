import { Capacitor } from '@capacitor/core';

export const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.basegamelab.marblerun';
export const DEFAULT_IOS_STORE_URL: string | null = null;

export type StorePlatform = 'android' | 'ios' | 'web';

export interface StoreMetadata {
  platform: StorePlatform;
  storeUrl: string | null;
}

export type StoreMetadataEnv = Record<string, string | undefined>;

export function getStoreMetadata(
  platform: string = Capacitor.getPlatform(),
  env: StoreMetadataEnv = import.meta.env,
): StoreMetadata {
  if (platform === 'ios') {
    return {
      platform: 'ios',
      storeUrl: envString(env, 'VITE_FTD_STORE_LINK') ?? DEFAULT_IOS_STORE_URL,
    };
  }

  if (platform === 'android') {
    return {
      platform: 'android',
      storeUrl: ANDROID_STORE_URL,
    };
  }

  return {
    platform: 'web',
    storeUrl: ANDROID_STORE_URL,
  };
}

function envString(env: StoreMetadataEnv, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
