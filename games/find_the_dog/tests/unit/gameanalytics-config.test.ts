import { describe, expect, it } from 'vitest';
import { readGameAnalyticsIosConfig } from '../../src/analytics/GameAnalyticsConfig';

describe('FTD GameAnalytics runtime configuration', () => {
  it('stays disabled unless the explicit iOS enable flag is true', () => {
    const result = readGameAnalyticsIosConfig({
      VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
    }, true);

    expect(result).toMatchObject({ enabled: false, reason: 'GameAnalytics iOS is disabled' });
  });

  it('rejects credentials labeled for Find the Bird', () => {
    const result = readGameAnalyticsIosConfig({
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_bird',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
    }, true);

    expect(result).toMatchObject({
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_ID must be find_the_dog',
    });
    expect(JSON.stringify(result)).not.toContain('a'.repeat(32));
    expect(JSON.stringify(result)).not.toContain('b'.repeat(40));
  });

  it('rejects placeholder-shaped credentials without returning their values', () => {
    const placeholderGameKey = 'g'.repeat(32);
    const placeholderSecretKey = 's'.repeat(40);
    const result = readGameAnalyticsIosConfig({
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: placeholderGameKey,
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: placeholderSecretKey,
    }, true);

    expect(result).toMatchObject({
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_KEY must be 32 hexadecimal characters',
    });
    expect(JSON.stringify(result)).not.toContain(placeholderGameKey);
    expect(JSON.stringify(result)).not.toContain(placeholderSecretKey);
  });

  it('fails production closed when the well-shaped game key is not in the approved FTD registry', () => {
    const arbitraryGameKey = 'a'.repeat(32);
    const result = readGameAnalyticsIosConfig({
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: arbitraryGameKey,
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
    }, true);

    expect(result).toMatchObject({
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_KEY is not approved for find_the_dog',
    });
    expect(JSON.stringify(result)).not.toContain(arbitraryGameKey);
  });

  it('accepts an owned synthetic game key only through an injected test registry', () => {
    const ownedSyntheticGameKey = 'a'.repeat(32);
    const result = readGameAnalyticsIosConfig({
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: ownedSyntheticGameKey,
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
    }, true, { approvedGameKeys: [ownedSyntheticGameKey] });

    expect(result).toMatchObject({ enabled: true });
  });
});
