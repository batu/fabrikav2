import { describe, expect, it } from 'vitest';
import { readAdjustIosConfig, type AdjustEnv } from './AdjustConfig.ts';

const completeEnv = (overrides: AdjustEnv = {}): AdjustEnv => ({
  VITE_ADJUST_IOS_ENABLED: 'true',
  VITE_ADJUST_IOS_APP_TOKEN: ' abc123abc123 ',
  VITE_ADJUST_IOS_ENVIRONMENT: ' sandbox ',
  ...overrides,
});

describe('readAdjustIosConfig', (): void => {
  it('stays disabled unless the iOS Adjust flag is enabled', (): void => {
    expect(readAdjustIosConfig({}, false).enabled).toBe(false);
    expect(readAdjustIosConfig({ VITE_ADJUST_IOS_ENABLED: 'false' }, false).enabled).toBe(false);
    expect(readAdjustIosConfig({ VITE_ADJUST_IOS_ENABLED: '0' }, false).enabled).toBe(false);
    expect(readAdjustIosConfig({ VITE_ADJUST_IOS_ENABLED: 'off' }, false).enabled).toBe(false);
  });

  it('trims a complete Adjust config and optional event tokens', (): void => {
    expect(
      readAdjustIosConfig(
        completeEnv({
          VITE_ADJUST_VERBOSE_LOGGING: '1',
          VITE_ADJUST_EVENT_LEVEL_COMPLETE_TOKEN: ' level-complete-token ',
          VITE_ADJUST_EVENT_REWARDED_WATCHED_TOKEN: ' rewarded-token ',
        }),
        false,
      ),
    ).toEqual({
      enabled: true,
      config: {
        appToken: 'abc123abc123',
        environment: 'sandbox',
        verboseLogging: true,
        eventTokens: {
          appOpen: null,
          levelStart: null,
          levelComplete: 'level-complete-token',
          levelFailed: null,
          rewardedWatched: 'rewarded-token',
        },
        privacy: {
          disableIdfaReading: true,
          disableAppTrackingTransparencyUsage: true,
        },
      },
    });
  });

  it('accepts SDK-compatible mixed-case 12-character app tokens', (): void => {
    expect(readAdjustIosConfig(completeEnv({ VITE_ADJUST_IOS_APP_TOKEN: ' AbC123xYz789 ' }), false)).toMatchObject({
      enabled: true,
      config: {
        appToken: 'AbC123xYz789',
      },
    });
  });

  it('defaults the Adjust environment to sandbox when it is not set', (): void => {
    expect(readAdjustIosConfig(completeEnv({ VITE_ADJUST_IOS_ENVIRONMENT: undefined }), false)).toMatchObject({
      enabled: true,
      config: {
        appToken: 'abc123abc123',
        environment: 'sandbox',
      },
    });

    // A blank/whitespace-only value is treated the same as unset.
    expect(readAdjustIosConfig(completeEnv({ VITE_ADJUST_IOS_ENVIRONMENT: '   ' }), false)).toMatchObject({
      enabled: true,
      config: {
        environment: 'sandbox',
      },
    });
  });

  it('keeps a production build disabled when the environment defaults to sandbox', (): void => {
    expect(readAdjustIosConfig(completeEnv({ VITE_ADJUST_IOS_ENVIRONMENT: undefined }), true)).toEqual({
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENVIRONMENT must be production for production builds',
      missingKeys: [],
    });
  });

  it('requires the app token when enabled', (): void => {
    const result = readAdjustIosConfig(
      completeEnv({
        VITE_ADJUST_IOS_APP_TOKEN: ' ',
        VITE_ADJUST_IOS_ENVIRONMENT: undefined,
      }),
      false,
    );

    expect(result).toEqual({
      enabled: false,
      reason: 'missing Adjust iOS config: VITE_ADJUST_IOS_APP_TOKEN',
      missingKeys: ['VITE_ADJUST_IOS_APP_TOKEN'],
    });
  });

  it('rejects environments outside sandbox and production', (): void => {
    expect(readAdjustIosConfig(completeEnv({ VITE_ADJUST_IOS_ENVIRONMENT: ' staging ' }), false)).toEqual({
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENVIRONMENT must be sandbox or production',
      missingKeys: [],
    });
  });

  it('rejects malformed Adjust app tokens before native init', (): void => {
    expect(readAdjustIosConfig(completeEnv({ VITE_ADJUST_IOS_APP_TOKEN: 'bad-token' }), false)).toEqual({
      enabled: false,
      reason: 'VITE_ADJUST_IOS_APP_TOKEN must be a 12-character Adjust app token',
      missingKeys: [],
    });
  });

  it('keeps production builds disabled unless the environment is production', (): void => {
    expect(readAdjustIosConfig(completeEnv(), true)).toEqual({
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENVIRONMENT must be production for production builds',
      missingKeys: [],
    });

    expect(
      readAdjustIosConfig(completeEnv({ VITE_ADJUST_IOS_ENVIRONMENT: ' production ' }), true),
    ).toMatchObject({
      enabled: true,
      config: {
        environment: 'production',
      },
    });
  });

  it('suppresses verbose Adjust logging in production builds', (): void => {
    expect(
      readAdjustIosConfig(
        completeEnv({
          VITE_ADJUST_IOS_ENVIRONMENT: 'production',
          VITE_ADJUST_VERBOSE_LOGGING: 'true',
        }),
        true,
      ),
    ).toMatchObject({
      enabled: true,
      config: {
        verboseLogging: false,
      },
    });
  });

  it('fails closed when env is empty and PROD is not supplied', (): void => {
    expect(readAdjustIosConfig()).toEqual({
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENABLED is not true',
      missingKeys: [],
    });

    expect(readAdjustIosConfig(completeEnv())).toEqual({
      enabled: false,
      reason: 'VITE_ADJUST_IOS_ENVIRONMENT must be production for production builds',
      missingKeys: [],
    });
  });
});
