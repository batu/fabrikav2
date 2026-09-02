import { createFindPolicy, FIND_THE_DOG_ENV_KEYS } from './find-the-dog.mjs';
import { FIND_THE_BIRD_ADMOB_IDENTITY } from '../admob-identities.mjs';

const FIND_THE_BIRD_RELEASE_IDENTITY = Object.freeze({
  firebaseProjectId: 'find-the-bird-basegamelab',
  gameAnalyticsGameId: 'find_the_bird',
  appsFlyerAppleAppId: '6796698146',
  admobIos: FIND_THE_BIRD_ADMOB_IDENTITY,
  legal: Object.freeze({
    VITE_FTD_PRIVACY_POLICY_URL: 'https://basegamelab.com/find-the-bird/privacy',
    VITE_FTD_TERMS_URL: 'https://basegamelab.com/find-the-bird/terms',
    VITE_FTD_DATA_DELETION_URL: 'https://basegamelab.com/find-the-bird/data-deletion',
    VITE_FTD_SUPPORT_URL: 'https://basegamelab.com/find-the-bird/support',
    VITE_FTD_STORE_LINK: 'https://apps.apple.com/app/id6796698146',
    VITE_PRIVACY_POLICY_URL: 'https://basegamelab.com/find-the-bird/privacy',
    VITE_TERMS_URL: 'https://basegamelab.com/find-the-bird/terms',
  }),
});
const FIND_THE_BIRD_GAME_KEY_FINGERPRINT = 'b7d40d4f0f62188d11ec138b31f971e26a7500428142939660af4cab20fe6425';
const FIND_THE_BIRD_SECRET_KEY_FINGERPRINT = 'c356f65080a80ff69c17de5d3af900aa8ecb11268b066e72b12fa042d9066038';

export function createFindTheBirdPolicy(options = {}) {
  return createFindPolicy({
    ...options,
    canonicalKeys: FIND_THE_DOG_ENV_KEYS,
    releaseIdentity: FIND_THE_BIRD_RELEASE_IDENTITY,
  });
}

export const FIND_THE_BIRD_POLICY = createFindTheBirdPolicy({
  approvedGameAnalyticsGameKeyFingerprints: [FIND_THE_BIRD_GAME_KEY_FINGERPRINT],
  approvedGameAnalyticsSecretKeyFingerprints: [FIND_THE_BIRD_SECRET_KEY_FINGERPRINT],
});