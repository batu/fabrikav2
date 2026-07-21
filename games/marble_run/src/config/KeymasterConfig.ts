export type KeymasterRuntimePlatform = 'ios' | 'android';
export type KeymasterSourceOs = 'iOS' | 'DRD';

export interface KeymasterAppLovinAdUnitIds {
  banner: string;
  interstitial: string;
  rewarded: string;
}

export interface KeymasterPublicRow {
  gameName: string;
  sourceOs: KeymasterSourceOs;
  storeAccountName: string | null;
  storeLink: string | null;
  /** Exact bundle/package value recorded in the source Keymaster row. */
  keymasterBundleId: string;
  /** Bundle/package identity this checkout actually builds for the platform. */
  runtimeBundleId: string;
  appleStoreId: string | null;
  appLovinAdUnitIds: KeymasterAppLovinAdUnitIds;
}

export interface KeymasterCredentialEnvVars {
  adjustAppToken: string | null;
  gameAnalyticsGameKey: string | null;
  gameAnalyticsSecretKey: string | null;
  appLovinSdkKey: string;
}

/**
 * Local/raw publisher TSV used to derive the committed non-secret config below.
 * The TSV itself is intentionally ignored because it contains credential-like
 * values such as SDK keys, app tokens, and analytics keys.
 */
export const KEYMASTER_SOURCE_PATH = 'designs/requirements/Copy of Base (Test) - Keymaster - Games(1).tsv';

/**
 * Non-secret AppLovin runtime IDs and provenance from the current Keymaster rows.
 *
 * Deliberately excluded from this object:
 * - Adjust app token
 * - GameAnalytics game key and secret key
 * - AppLovin SDK key
 * - unrelated provider rows that are not consumed by the runtime
 *
 * Android note: the Keymaster source rows below still record the publisher
 * bundle `com.baseardahan.hiddenobj`, while this checkout ships as
 * `com.basegamelab.marblerun`. Keep both values explicit so future code cannot
 * confuse source-row provenance with the app package identity.
 *
 * SCAFFOLD CAVEAT (MRV2-1): Marble Run has no Keymaster row yet, so the
 * `gameName` and `appLovinAdUnitIds` below are still the inherited Hidden
 * Object / find_the_dog values. They must be replaced with Marble Run's own
 * row before any ad or monetization build ships.
 */
export const KEYMASTER_PUBLIC_ROWS: Readonly<Record<KeymasterRuntimePlatform, KeymasterPublicRow>> = {
  ios: {
    gameName: 'Hidden Object',
    sourceOs: 'iOS',
    storeAccountName: null,
    storeLink: null,
    keymasterBundleId: 'com.baseardahan.hiddenobj',
    runtimeBundleId: 'com.basegamelab.marblerun',
    appleStoreId: null,
    appLovinAdUnitIds: {
      banner: 'fbe1e8b56ac8914b',
      interstitial: '8349000fa4fc8331',
      rewarded: 'dc95d767c13e4cb2',
    },
  },
  android: {
    gameName: 'Hidden Object',
    sourceOs: 'DRD',
    storeAccountName: null,
    storeLink: null,
    keymasterBundleId: 'com.baseardahan.hiddenobj',
    runtimeBundleId: 'com.basegamelab.marblerun',
    appleStoreId: null,
    appLovinAdUnitIds: {
      banner: '57d4eccf1b621f76',
      interstitial: 'dcc972675bed23dd',
      rewarded: '39be44b3b8a1ae3d',
    },
  },
};

export const KEYMASTER_CREDENTIAL_ENV_VARS: Readonly<Record<KeymasterRuntimePlatform, KeymasterCredentialEnvVars>> = {
  ios: {
    adjustAppToken: 'VITE_ADJUST_IOS_APP_TOKEN',
    gameAnalyticsGameKey: 'VITE_GAMEANALYTICS_IOS_GAME_KEY',
    gameAnalyticsSecretKey: 'VITE_GAMEANALYTICS_IOS_SECRET_KEY',
    appLovinSdkKey: 'VITE_APPLOVIN_IOS_SDK_KEY',
  },
  android: {
    adjustAppToken: null,
    gameAnalyticsGameKey: null,
    gameAnalyticsSecretKey: null,
    appLovinSdkKey: 'VITE_APPLOVIN_ANDROID_SDK_KEY',
  },
};

export const KEYMASTER_APPLOVIN_AD_UNIT_IDS: Readonly<Record<KeymasterRuntimePlatform, KeymasterAppLovinAdUnitIds>> = {
  ios: KEYMASTER_PUBLIC_ROWS.ios.appLovinAdUnitIds,
  android: KEYMASTER_PUBLIC_ROWS.android.appLovinAdUnitIds,
};
