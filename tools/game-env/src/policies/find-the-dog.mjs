import { URL } from 'node:url';

export const FIND_THE_DOG_ENV_KEYS = Object.freeze([
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
  'VITE_FTD_DISABLE_REMOTE_CONFIG',
  'VITE_ENABLE_TEST_HARNESS',
  'VITE_INSITU_TOUR',
  'VITE_SDK_VERIFIER_AUTOMOUNT',
  'VITE_SDK_VERIFIER_AUTOCRASH',
  'VITE_GAMEANALYTICS_IOS_ENABLED',
  'VITE_GAMEANALYTICS_IOS_GAME_ID',
  'VITE_GAMEANALYTICS_IOS_GAME_KEY',
  'VITE_GAMEANALYTICS_IOS_SECRET_KEY',
  'VITE_GAMEANALYTICS_VERBOSE_LOGGING',
  'VITE_REVENUECAT_IOS_API_KEY',
  'VITE_REVENUECAT_ANDROID_API_KEY',
  'VITE_ATTRIBUTION_PROVIDER',
  'VITE_APPSFLYER_ENABLED',
  'VITE_APPSFLYER_DEV_KEY',
  'VITE_APPSFLYER_APPLE_APP_ID',
  'VITE_APPSFLYER_DEBUG_LOGGING',
  'VITE_APPSFLYER_SHARING_PARTNERS',
  'VITE_FIREBASE_CRASHLYTICS_ENABLED',
  'VITE_ADJUST_IOS_ENABLED',
  'VITE_ADJUST_IOS_APP_TOKEN',
  'VITE_ADJUST_IOS_ENVIRONMENT',
  'VITE_ADJUST_EVENT_APP_OPEN_TOKEN',
  'VITE_ADJUST_EVENT_LEVEL_START_TOKEN',
  'VITE_ADJUST_EVENT_LEVEL_COMPLETE_TOKEN',
  'VITE_ADJUST_EVENT_LEVEL_FAIL_TOKEN',
  'VITE_ADJUST_EVENT_REWARDED_WATCHED_TOKEN',
  'VITE_ADJUST_VERBOSE_LOGGING',
  'VITE_AD_PROVIDER',
  'VITE_APPLOVIN_ANDROID_ENABLED',
  'VITE_APPLOVIN_ANDROID_SDK_KEY',
  'VITE_APPLOVIN_ANDROID_GENERAL_AUDIENCE_ONLY',
  'VITE_APPLOVIN_HAS_USER_CONSENT',
  'VITE_APPLOVIN_DO_NOT_SELL',
  'VITE_APPLOVIN_CONSENT_FLOW_ENABLED',
  'VITE_APPLOVIN_GDPR_TERMS_ALERT_ENABLED',
  'VITE_APPLOVIN_VERBOSE_LOGGING',
  'VITE_APPLOVIN_ANDROID_BANNER_ID',
  'VITE_APPLOVIN_ANDROID_INTERSTITIAL_ID',
  'VITE_APPLOVIN_ANDROID_REWARDED_ID',
  'VITE_ADMOB_IOS_BANNER_ID',
  'VITE_ADMOB_IOS_INTERSTITIAL_ID',
  'VITE_ADMOB_IOS_REWARDED_ID',
  'VITE_ADMOB_IOS_ENABLED',
  'VITE_ADMOB_IOS_APP_ID',
  'VITE_ADMOB_IOS_TEST_MODE',
  'VITE_ADMOB_IOS_TEST_DEVICE_IDS',
  'VITE_ADMOB_ANDROID_BANNER_ID',
  'VITE_ADMOB_ANDROID_INTERSTITIAL_ID',
  'VITE_ADMOB_ANDROID_REWARDED_ID',
  'VITE_PRIVACY_POLICY_URL',
  'VITE_TERMS_URL',
  'VITE_FTD_PRIVACY_POLICY_URL',
  'VITE_FTD_TERMS_URL',
  'VITE_FTD_DATA_DELETION_URL',
  'VITE_FTD_SUPPORT_URL',
  'VITE_FTD_STORE_LINK',
  'VITE_CDN_ENABLED',
  'VITE_CDN_ORIGIN_DEV',
  'VITE_CDN_ORIGIN_PROD',
  'VITE_CDN_ORIGIN_ANDROID',
  'VITE_FTD_OWNED_ANALYTICS_MIRROR_URL',
  'VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY',
]);

const EXPECTED_FIREBASE_PROJECT_ID = 'find-the-dog-basegamelab';

function intentKeys(mode) {
  const keys = ['VITE_FTD_DISABLE_REMOTE_CONFIG', 'VITE_CDN_ENABLED'];
  if (mode === 'ios') {
    keys.push(
      'VITE_GAMEANALYTICS_IOS_ENABLED',
      'VITE_ADJUST_IOS_ENABLED',
      'VITE_ADMOB_IOS_ENABLED',
      'VITE_ADMOB_IOS_TEST_MODE',
    );
  } else {
    keys.push('VITE_APPLOVIN_ANDROID_ENABLED');
  }
  return keys;
}

function validateConditional(
  { values, mode, booleanValue, requireValue, invalidKeys },
  identityPolicy,
) {
  validateChoice(values, 'VITE_AD_PROVIDER', ['auto', 'admob', 'applovin-max', 'disabled'], invalidKeys);
  validateChoice(values, 'VITE_ATTRIBUTION_PROVIDER', ['auto', 'appsflyer', 'adjust', 'disabled'], invalidKeys);

  const firebaseProjectId = values.get('VITE_FIREBASE_PROJECT_ID');
  if (firebaseProjectId && firebaseProjectId.trim() !== EXPECTED_FIREBASE_PROJECT_ID) {
    invalidKeys.push('VITE_FIREBASE_PROJECT_ID');
  }

  if (mode === 'ios') {
    const key = 'VITE_REVENUECAT_IOS_API_KEY';
    requireValue(key);
    const value = values.get(key);
    if (typeof value === 'string' && value.trim() !== '' && !/^appl_[A-Za-z0-9]{27}$/.test(value)) {
      invalidKeys.push(key);
    }
  }

  if (booleanValue(values.get('VITE_APPSFLYER_ENABLED')) === true) {
    requireValue('VITE_APPSFLYER_DEV_KEY');
    const devKey = values.get('VITE_APPSFLYER_DEV_KEY');
    if (devKey && !/^[A-Za-z0-9]{20,32}$/.test(devKey.trim())) {
      invalidKeys.push('VITE_APPSFLYER_DEV_KEY');
    }
    if (mode === 'ios') {
      requireValue('VITE_APPSFLYER_APPLE_APP_ID');
      const appId = values.get('VITE_APPSFLYER_APPLE_APP_ID');
      if (appId && appId.trim() !== '6772100729') invalidKeys.push('VITE_APPSFLYER_APPLE_APP_ID');
    }
  }

  // Capture-tour flags are build-time shell env set by verify-device, never a
  // persisted env value: a committed/local VITE_INSITU_TOUR would silently ship
  // the allstates tour in any build that also enables the test harness.
  const insituTour = values.get('VITE_INSITU_TOUR');
  if (insituTour !== undefined && insituTour !== '' && !/^__[-A-Z0-9_]+__$/.test(insituTour.trim())) {
    invalidKeys.push('VITE_INSITU_TOUR');
  }

  if (mode === 'ios' && booleanValue(values.get('VITE_GAMEANALYTICS_IOS_ENABLED')) === true) {
    if (values.get('VITE_GAMEANALYTICS_IOS_GAME_ID')?.trim() !== 'find_the_dog') {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_GAME_ID');
    }
    requireValue('VITE_GAMEANALYTICS_IOS_GAME_KEY');
    requireValue('VITE_GAMEANALYTICS_IOS_SECRET_KEY');
    const gameKey = values.get('VITE_GAMEANALYTICS_IOS_GAME_KEY')?.trim();
    const secretKey = values.get('VITE_GAMEANALYTICS_IOS_SECRET_KEY')?.trim();
    if (gameKey && !/^[a-f0-9]{32}$/i.test(gameKey)) {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_GAME_KEY');
    } else if (gameKey && !identityPolicy.approvedGameAnalyticsGameKeys.includes(gameKey)) {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_GAME_KEY');
    }
    if (secretKey && !/^[a-f0-9]{40}$/i.test(secretKey)) {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_SECRET_KEY');
    }
  }

  if (mode === 'ios') {
    if (values.get('VITE_ATTRIBUTION_PROVIDER')?.trim().toLowerCase() !== 'appsflyer') {
      invalidKeys.push('VITE_ATTRIBUTION_PROVIDER');
    }
    if (booleanValue(values.get('VITE_APPSFLYER_ENABLED')) !== true) {
      invalidKeys.push('VITE_APPSFLYER_ENABLED');
    }
    const gameAnalyticsEnabled = booleanValue(values.get('VITE_GAMEANALYTICS_IOS_ENABLED')) === true;
    const mirrorUrl = values.get('VITE_FTD_OWNED_ANALYTICS_MIRROR_URL')?.trim();
    const mirrorKey = values.get('VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY')?.trim();
    const mirrorUrlValid = mirrorUrl
      ? isValidMirrorEndpoint(mirrorUrl)
        && identityPolicy.approvedOwnedMirrorEndpointUrls.includes(mirrorUrl)
      : false;
    const mirrorKeyValid = mirrorKey ? mirrorKey.length >= 16 : false;
    if (mirrorUrl && !mirrorUrlValid) invalidKeys.push('VITE_FTD_OWNED_ANALYTICS_MIRROR_URL');
    if (mirrorKey && !mirrorKeyValid) invalidKeys.push('VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY');
    const ownedMirrorEnabled = mirrorUrlValid && mirrorKeyValid;
    if (!gameAnalyticsEnabled && !ownedMirrorEnabled) {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_ENABLED');
    }
  }

  if (mode === 'ios' && booleanValue(values.get('VITE_ADJUST_IOS_ENABLED')) === true) {
    requireValue('VITE_ADJUST_IOS_APP_TOKEN');
    requireValue('VITE_ADJUST_IOS_ENVIRONMENT');
    const environment = values.get('VITE_ADJUST_IOS_ENVIRONMENT');
    if (environment && !['sandbox', 'production'].includes(environment.trim().toLowerCase())) {
      invalidKeys.push('VITE_ADJUST_IOS_ENVIRONMENT');
    }
  }

  if (mode === 'ios' && booleanValue(values.get('VITE_ADMOB_IOS_ENABLED')) === true) {
    for (const key of [
      'VITE_ADMOB_IOS_APP_ID',
      'VITE_ADMOB_IOS_BANNER_ID',
      'VITE_ADMOB_IOS_INTERSTITIAL_ID',
      'VITE_ADMOB_IOS_REWARDED_ID',
    ]) requireValue(key);
    if (booleanValue(values.get('VITE_ADMOB_IOS_TEST_MODE')) === true) {
      requireValue('VITE_ADMOB_IOS_TEST_DEVICE_IDS');
    }
  }

  const prefix = 'VITE_APPLOVIN_ANDROID';
  if (mode === 'android' && booleanValue(values.get(`${prefix}_ENABLED`)) === true) {
    requireValue(`${prefix}_SDK_KEY`);
    if (booleanValue(values.get(`${prefix}_GENERAL_AUDIENCE_ONLY`)) !== true) {
      invalidKeys.push(`${prefix}_GENERAL_AUDIENCE_ONLY`);
    }
  }
}

function isValidMirrorEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username.length === 0
      && url.password.length === 0
      && url.search.length === 0;
  } catch {
    return false;
  }
}

function validateChoice(values, key, allowed, invalidKeys) {
  const value = values.get(key);
  if (value === undefined || value.trim() === '') return;
  if (!allowed.includes(value.trim().toLowerCase())) invalidKeys.push(key);
}

function configureSyntheticFixture(values, mode) {
  values.set('VITE_FIREBASE_PROJECT_ID', EXPECTED_FIREBASE_PROJECT_ID);
  if (mode === 'ios') {
    values.set('VITE_GAMEANALYTICS_IOS_ENABLED', 'true');
    values.set('VITE_GAMEANALYTICS_IOS_GAME_ID', 'find_the_dog');
    values.set('VITE_GAMEANALYTICS_IOS_GAME_KEY', 'a'.repeat(32));
    values.set('VITE_GAMEANALYTICS_IOS_SECRET_KEY', 'b'.repeat(40));
    values.set('VITE_ATTRIBUTION_PROVIDER', 'appsflyer');
    values.set('VITE_APPSFLYER_ENABLED', 'true');
    values.set('VITE_APPSFLYER_DEV_KEY', 'A1b2C3d4E5f6G7h8I9j0');
    values.set('VITE_APPSFLYER_APPLE_APP_ID', '6772100729');
    values.set('VITE_FTD_OWNED_ANALYTICS_MIRROR_URL', 'https://example.invalid/analytics');
    values.set('VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY', 'synthetic-public-client-key');
  }
}

function configureMissingDryRunCase(values, mode) {
  if (mode === 'ios') {
    values.set('VITE_ADMOB_IOS_ENABLED', 'true');
    values.set('VITE_ADMOB_IOS_TEST_MODE', 'false');
    return 'VITE_ADMOB_IOS_APP_ID';
  }
  values.set('VITE_APPLOVIN_ANDROID_ENABLED', 'true');
  values.set('VITE_APPLOVIN_ANDROID_GENERAL_AUDIENCE_ONLY', 'true');
  return 'VITE_APPLOVIN_ANDROID_SDK_KEY';
}

export function createFindTheDogPolicy({
  approvedGameAnalyticsGameKeys = [],
  approvedOwnedMirrorEndpointUrls = [],
} = {}) {
  const identityPolicy = Object.freeze({
    approvedGameAnalyticsGameKeys: Object.freeze([...approvedGameAnalyticsGameKeys]),
    approvedOwnedMirrorEndpointUrls: Object.freeze([...approvedOwnedMirrorEndpointUrls]),
  });
  return Object.freeze({
    canonicalKeys: FIND_THE_DOG_ENV_KEYS,
    intentKeys,
    validateConditional: (context) => validateConditional(context, identityPolicy),
    configureSyntheticFixture,
    configureMissingDryRunCase,
    forSyntheticValidation: () => createFindTheDogPolicy({
      approvedGameAnalyticsGameKeys: ['a'.repeat(32)],
      approvedOwnedMirrorEndpointUrls: ['https://example.invalid/analytics'],
    }),
  });
}

// No external FTD GameAnalytics project or owned mirror endpoint is provisioned
// yet. Production therefore fails closed until reviewed public identities land.
export const FIND_THE_DOG_POLICY = createFindTheDogPolicy();
