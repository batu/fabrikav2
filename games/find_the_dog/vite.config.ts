import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';
import { baseViteConfig } from '../../configs/vite.base.ts';
import { readEnvFile } from '../../tools/game-env/src/env.mjs';
import { FIND_THE_DOG_ENV_KEYS } from '../../tools/game-env/src/policies/find-the-dog.mjs';

const gameRoot = path.dirname(fileURLToPath(import.meta.url));
const injectedEnvironment = new Map<string, string | undefined>();
const canonicalEnvironmentKeys = new Set(FIND_THE_DOG_ENV_KEYS);

// Web/CI builds resolve the optional AdMob Capacitor plugin to a local no-op
// shim so the shared ads barrel stays importable without the native package
// (same pattern as vitest.config.ts).
const admobStub = fileURLToPath(new URL('./src/sdk/shims/capacitor-community-admob.ts', import.meta.url));

function keyAppliesToMode(key: string, mode: string): boolean {
  const iosOnly = [
    'VITE_GAMEANALYTICS_',
    'VITE_REVENUECAT_IOS_',
    'VITE_ADJUST_IOS_',
    'VITE_ADJUST_EVENT_',
    'VITE_APPLOVIN_IOS_',
    'VITE_ADMOB_IOS_',
  ];
  const androidOnly = [
    'VITE_REVENUECAT_ANDROID_',
    'VITE_APPLOVIN_ANDROID_',
    'VITE_ADMOB_ANDROID_',
    'VITE_CDN_ORIGIN_ANDROID',
  ];

  if (iosOnly.some((prefix) => key.startsWith(prefix))) return mode === 'ios';
  if (androidOnly.some((prefix) => key.startsWith(prefix))) return mode === 'android';
  return true;
}

function restoreInjectedEnvironment(): void {
  for (const [key, previousValue] of injectedEnvironment) {
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
  }
  injectedEnvironment.clear();
}

function injectIosEnvironment(root: string): void {
  for (const [key, value] of readEnvFile(path.join(root, '.env.ios.local')).values) {
    if (!canonicalEnvironmentKeys.has(key) || !keyAppliesToMode(key, 'ios')) continue;
    injectedEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  }
}

function envPrefixesForMode(mode: string): string[] {
  return FIND_THE_DOG_ENV_KEYS.filter((key) => keyAppliesToMode(key, mode));
}

export function resolveFindTheDogViteConfig(mode: string, root = gameRoot): UserConfig {
  restoreInjectedEnvironment();
  if (mode === 'ios') {
    injectIosEnvironment(root);
  }

  return baseViteConfig({
    envPrefix: envPrefixesForMode(mode),
    server: { port: 5199 },
    resolve: { alias: { '@capacitor-community/admob': admobStub } },
  });
}

// Keep all shared build defaults and the build-info plugin by composing through
// the base helper exactly once for each resolved mode.
export default defineConfig(({ mode }) => resolveFindTheDogViteConfig(mode));
