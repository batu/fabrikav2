import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { FIND_THE_DOG_ADMOB_IDENTITY } from '../admob-identities.mjs';

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
  'VITE_ADMOB_ANDROID_ENABLED',
  'VITE_ADMOB_ANDROID_APP_ID',
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

const FIND_THE_DOG_RELEASE_IDENTITY = Object.freeze({
  firebaseProjectId: 'find-the-dog-basegamelab',
  gameAnalyticsGameId: 'find_the_dog',
  appsFlyerAppleAppId: '6772100729',
  admobIos: FIND_THE_DOG_ADMOB_IDENTITY,
  legal: Object.freeze({
    VITE_FTD_PRIVACY_POLICY_URL: 'https://basegamelab.com/find-the-dog/privacy',
    VITE_FTD_TERMS_URL: 'https://basegamelab.com/find-the-dog/terms',
    VITE_FTD_DATA_DELETION_URL: 'https://basegamelab.com/find-the-dog/data-deletion',
    VITE_FTD_SUPPORT_URL: 'https://basegamelab.com/find-the-dog/support',
    VITE_FTD_STORE_LINK: 'https://apps.apple.com/app/id6772100729',
    VITE_PRIVACY_POLICY_URL: 'https://basegamelab.com/find-the-dog/privacy',
    VITE_TERMS_URL: 'https://basegamelab.com/find-the-dog/terms',
  }),
});
const FIND_THE_DOG_GAME_KEY_FINGERPRINT = '6552cf5728ac534e7c024e59e817fa90eb470ed4a13fde22a818ee18e496271d';
const FIND_THE_DOG_SECRET_KEY_FINGERPRINT = '2506d2b5d3ac051a6443feca234099beee48675b2573e19b48f14de28b72b4d2';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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
    keys.push('VITE_ADMOB_ANDROID_ENABLED');
  }
  return keys;
}

function validateConditional({ values, mode, booleanValue, requireValue, invalidKeys }, identityPolicy) {
  validateChoice(values, 'VITE_AD_PROVIDER', ['auto', 'admob', 'applovin-max', 'disabled'], invalidKeys);
  validateChoice(values, 'VITE_ATTRIBUTION_PROVIDER', ['auto', 'appsflyer', 'adjust', 'disabled'], invalidKeys);

  const firebaseProjectId = values.get('VITE_FIREBASE_PROJECT_ID');
  if (firebaseProjectId && firebaseProjectId.trim() !== identityPolicy.releaseIdentity.firebaseProjectId) {
    invalidKeys.push('VITE_FIREBASE_PROJECT_ID');
  }

  for (const [key, expected] of Object.entries(identityPolicy.releaseIdentity.legal)) {
    const actual = values.get(key)?.trim();
    if (actual && actual !== expected) invalidKeys.push(key);
  }

  if (mode === 'ios') {
    const key = 'VITE_REVENUECAT_IOS_API_KEY';
    requireValue(key);
    const value = values.get(key);
    if (typeof value === 'string' && value.trim() !== '' && !/^appl_[A-Za-z0-9]{27}$/.test(value)) {
      invalidKeys.push(key);
    }
  }
  if (mode === 'android') {
    const key = 'VITE_REVENUECAT_ANDROID_API_KEY';
    requireValue(key);
    const value = values.get(key);
    if (typeof value === 'string' && value.trim() !== '' && !/^goog_[A-Za-z0-9]{27,28}$/.test(value)) invalidKeys.push(key);
  }

  if (booleanValue(values.get('VITE_APPSFLYER_ENABLED')) === true) {
    requireValue('VITE_APPSFLYER_DEV_KEY');
    const devKey = values.get('VITE_APPSFLYER_DEV_KEY');
    if (devKey && (!/^[A-Za-z0-9]{22}$/.test(devKey.trim()) || /diagnostic|notreal|placeholder|example|sample/i.test(devKey))) {
      invalidKeys.push('VITE_APPSFLYER_DEV_KEY');
    }
    if (mode === 'ios') {
      requireValue('VITE_APPSFLYER_APPLE_APP_ID');
      const appId = values.get('VITE_APPSFLYER_APPLE_APP_ID');
      if (appId && appId.trim() !== identityPolicy.releaseIdentity.appsFlyerAppleAppId) {
        invalidKeys.push('VITE_APPSFLYER_APPLE_APP_ID');
      }
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
    if (values.get('VITE_GAMEANALYTICS_IOS_GAME_ID')?.trim() !== identityPolicy.releaseIdentity.gameAnalyticsGameId) {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_GAME_ID');
    }
    requireValue('VITE_GAMEANALYTICS_IOS_GAME_KEY');
    requireValue('VITE_GAMEANALYTICS_IOS_SECRET_KEY');
    const gameKey = values.get('VITE_GAMEANALYTICS_IOS_GAME_KEY')?.trim();
    const secretKey = values.get('VITE_GAMEANALYTICS_IOS_SECRET_KEY')?.trim();
    if (gameKey && !/^[a-f0-9]{32}$/i.test(gameKey)) {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_GAME_KEY');
    } else if (gameKey && !identityPolicy.approvedGameAnalyticsGameKeyFingerprints.includes(sha256(gameKey))) {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_GAME_KEY');
    }
    if (secretKey && !/^[a-f0-9]{40}$/i.test(secretKey)) {
      invalidKeys.push('VITE_GAMEANALYTICS_IOS_SECRET_KEY');
    } else if (secretKey && !identityPolicy.approvedGameAnalyticsSecretKeyFingerprints.includes(sha256(secretKey))) {
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
    const expectedAdMobValues = {
      VITE_ADMOB_IOS_APP_ID: identityPolicy.releaseIdentity.admobIos.appId,
      VITE_ADMOB_IOS_BANNER_ID: identityPolicy.releaseIdentity.admobIos.adUnits.banner,
      VITE_ADMOB_IOS_INTERSTITIAL_ID: identityPolicy.releaseIdentity.admobIos.adUnits.interstitial,
      VITE_ADMOB_IOS_REWARDED_ID: identityPolicy.releaseIdentity.admobIos.adUnits.rewarded,
    };
    for (const [key, expected] of Object.entries(expectedAdMobValues)) {
      const actual = values.get(key)?.trim();
      if (actual && actual !== expected) invalidKeys.push(key);
    }
    if (booleanValue(values.get('VITE_ADMOB_IOS_TEST_MODE')) === true) {
      requireValue('VITE_ADMOB_IOS_TEST_DEVICE_IDS');
    }
  }

  if (mode === 'android' && booleanValue(values.get('VITE_ADMOB_ANDROID_ENABLED')) === true) {
    for (const key of ['VITE_ADMOB_ANDROID_APP_ID', 'VITE_ADMOB_ANDROID_BANNER_ID', 'VITE_ADMOB_ANDROID_INTERSTITIAL_ID', 'VITE_ADMOB_ANDROID_REWARDED_ID']) requireValue(key);
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

function configureSyntheticFixture(values, mode, releaseIdentity) {
  values.set('VITE_FIREBASE_PROJECT_ID', releaseIdentity.firebaseProjectId);
  for (const [key, value] of Object.entries(releaseIdentity.legal)) values.set(key, value);
  if (mode === 'ios') {
    values.set('VITE_GAMEANALYTICS_IOS_ENABLED', 'true');
    values.set('VITE_GAMEANALYTICS_IOS_GAME_ID', releaseIdentity.gameAnalyticsGameId);
    values.set('VITE_GAMEANALYTICS_IOS_GAME_KEY', 'a'.repeat(32));
    values.set('VITE_GAMEANALYTICS_IOS_SECRET_KEY', 'b'.repeat(40));
    values.set('VITE_ATTRIBUTION_PROVIDER', 'appsflyer');
    values.set('VITE_APPSFLYER_ENABLED', 'true');
    values.set('VITE_APPSFLYER_DEV_KEY', 'A1b2C3d4E5f6G7h8I9j0K1');
    values.set('VITE_APPSFLYER_APPLE_APP_ID', releaseIdentity.appsFlyerAppleAppId);
    values.set('VITE_FTD_OWNED_ANALYTICS_MIRROR_URL', 'https://example.invalid/analytics');
    values.set('VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY', 'synthetic-public-client-key');
  } else {
    values.set('VITE_REVENUECAT_ANDROID_API_KEY', `goog_${'a'.repeat(28)}`);
  }
}

function configureMissingDryRunCase(values, mode) {
  if (mode === 'ios') {
    values.set('VITE_ADMOB_IOS_ENABLED', 'true');
    values.set('VITE_ADMOB_IOS_TEST_MODE', 'false');
    return 'VITE_ADMOB_IOS_APP_ID';
  }
  values.set('VITE_REVENUECAT_ANDROID_API_KEY', `goog_${'a'.repeat(28)}`);
  values.set('VITE_ADMOB_ANDROID_ENABLED', 'true');
  return 'VITE_ADMOB_ANDROID_APP_ID';
}

export function createFindPolicy({
  releaseIdentity = FIND_THE_DOG_RELEASE_IDENTITY,
  canonicalKeys = FIND_THE_DOG_ENV_KEYS,
  approvedGameAnalyticsGameKeyFingerprints = [],
  approvedGameAnalyticsSecretKeyFingerprints = [],
  approvedOwnedMirrorEndpointUrls = [],
} = {}) {
  const identityPolicy = Object.freeze({
    releaseIdentity: Object.freeze({ ...releaseIdentity }),
    approvedGameAnalyticsGameKeyFingerprints: Object.freeze([...approvedGameAnalyticsGameKeyFingerprints]),
    approvedGameAnalyticsSecretKeyFingerprints: Object.freeze([...approvedGameAnalyticsSecretKeyFingerprints]),
    approvedOwnedMirrorEndpointUrls: Object.freeze([...approvedOwnedMirrorEndpointUrls]),
  });
  return Object.freeze({
    canonicalKeys,
    releaseIdentity: identityPolicy.releaseIdentity,
    intentKeys,
    validateConditional: (context) => validateConditional(context, identityPolicy),
    configureSyntheticFixture: (values, mode) => configureSyntheticFixture(values, mode, identityPolicy.releaseIdentity),
    configureMissingDryRunCase,
    forSyntheticValidation: () => createFindPolicy({
      releaseIdentity: identityPolicy.releaseIdentity,
      canonicalKeys,
      approvedGameAnalyticsGameKeyFingerprints: [sha256('a'.repeat(32))],
      approvedGameAnalyticsSecretKeyFingerprints: [sha256('b'.repeat(40))],
      approvedOwnedMirrorEndpointUrls: ['https://example.invalid/analytics'],
    }),
  });
}

export function createFindTheDogPolicy(options = {}) {
  return createFindPolicy({ ...options, releaseIdentity: FIND_THE_DOG_RELEASE_IDENTITY });
}

export const FIND_THE_DOG_POLICY = createFindTheDogPolicy({
  approvedGameAnalyticsGameKeyFingerprints: [FIND_THE_DOG_GAME_KEY_FINGERPRINT],
  approvedGameAnalyticsSecretKeyFingerprints: [FIND_THE_DOG_SECRET_KEY_FINGERPRINT],
});
