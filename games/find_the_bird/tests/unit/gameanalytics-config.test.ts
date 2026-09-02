import { describe, expect, it } from 'vitest';
import { readGameAnalyticsIosConfig } from '../../src/analytics/GameAnalyticsConfig';

describe('Find the Bird GameAnalytics runtime configuration', () => {
  it('stays disabled unless the explicit iOS enable flag is true', () => {
    const result = readGameAnalyticsIosConfig({
      VITE_GAMEANALYTICS_IOS_ENABLED: 'false',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_bird',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
    }, true);

    expect(result).toMatchObject({ enabled: false, reason: 'GameAnalytics iOS is disabled' });
  });

  it('rejects credentials labeled for Find the Dog', () => {
    const result = readGameAnalyticsIosConfig({
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
    }, true);

    expect(result).toMatchObject({
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_ID must be find_the_bird',
    });
    expect(JSON.stringify(result)).not.toContain('a'.repeat(32));
    expect(JSON.stringify(result)).not.toContain('b'.repeat(40));
  });

  it('rejects non-hexadecimal credential shapes without returning their values', () => {
    const malformedGameKey = 'g'.repeat(32);
    const malformedSecretKey = 's'.repeat(40);
    const result = readGameAnalyticsIosConfig({
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_bird',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: malformedGameKey,
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: malformedSecretKey,
    }, true);

    expect(result).toMatchObject({
      enabled: false,
      reason: 'VITE_GAMEANALYTICS_IOS_GAME_KEY must be 32 hexadecimal characters',
    });
    expect(JSON.stringify(result)).not.toContain(malformedGameKey);
    expect(JSON.stringify(result)).not.toContain(malformedSecretKey);
  });

  it('forces verbose logging off in production and permits it in development', () => {
    const env = {
      VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
      VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_bird',
      VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
      VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
      VITE_GAMEANALYTICS_VERBOSE_LOGGING: 'true',
    };

    const production = readGameAnalyticsIosConfig(env, true);
    const development = readGameAnalyticsIosConfig(env, false);
    expect(production.enabled && production.config.verboseLogging).toBe(false);
    expect(development.enabled && development.config.verboseLogging).toBe(true);
  });
});
