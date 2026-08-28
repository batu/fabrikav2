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

function validateConditional({ values, mode, booleanValue, requireValue, invalidKeys }) {
  validateChoice(values, 'VITE_AD_PROVIDER', ['auto', 'admob', 'applovin-max', 'disabled'], invalidKeys);
  validateChoice(values, 'VITE_ATTRIBUTION_PROVIDER', ['auto', 'appsflyer', 'adjust', 'disabled'], invalidKeys);

  if (booleanValue(values.get('VITE_APPSFLYER_ENABLED')) === true) {
    requireValue('VITE_APPSFLYER_DEV_KEY');
    if (mode === 'ios') {
      requireValue('VITE_APPSFLYER_APPLE_APP_ID');
      const appId = values.get('VITE_APPSFLYER_APPLE_APP_ID');
      if (appId && !/^\d+$/.test(appId.trim())) invalidKeys.push('VITE_APPSFLYER_APPLE_APP_ID');
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
    requireValue('VITE_GAMEANALYTICS_IOS_GAME_KEY');
    requireValue('VITE_GAMEANALYTICS_IOS_SECRET_KEY');
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

function validateChoice(values, key, allowed, invalidKeys) {
  const value = values.get(key);
  if (value === undefined || value.trim() === '') return;
  if (!allowed.includes(value.trim().toLowerCase())) invalidKeys.push(key);
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

export const FIND_THE_DOG_POLICY = Object.freeze({
  canonicalKeys: FIND_THE_DOG_ENV_KEYS,
  intentKeys,
  validateConditional,
  configureMissingDryRunCase,
});
