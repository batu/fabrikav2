import { describe, expect, it } from 'vitest';
import { readMetaConfig, redactMetaToken } from './MetaConfig.ts';

const APP_ID = '4138472436283342';
const CLIENT_TOKEN = 'df7e72e4b37b02ff036dc836d8eea518';

const enabledEnv = {
  VITE_FB_ENABLED: 'true',
  VITE_FB_APP_ID: APP_ID,
  VITE_FB_CLIENT_TOKEN: CLIENT_TOKEN,
};

describe('readMetaConfig', (): void => {
  it('enables with app id and client token, privacy flags defaulting off', (): void => {
    const result = readMetaConfig('ios', enabledEnv);

    expect(result).toEqual({
      enabled: true,
      config: {
        appId: APP_ID,
        clientToken: CLIENT_TOKEN,
        autoLogAppEvents: false,
        advertiserIdCollection: false,
      },
    });
  });

  it('requires the enable flag', (): void => {
    const result = readMetaConfig('ios', { VITE_FB_APP_ID: APP_ID, VITE_FB_CLIENT_TOKEN: CLIENT_TOKEN });

    expect(result).toMatchObject({ enabled: false, reason: 'VITE_FB_ENABLED is not true' });
  });

  it('disables off native platforms', (): void => {
    expect(readMetaConfig('web', enabledEnv)).toMatchObject({
      enabled: false,
      reason: 'Facebook SDK disabled on web platform',
    });
  });

  it('names missing keys', (): void => {
    const result = readMetaConfig('android', { VITE_FB_ENABLED: 'true' });

    expect(result).toMatchObject({
      enabled: false,
      missingKeys: ['VITE_FB_APP_ID', 'VITE_FB_CLIENT_TOKEN'],
    });
  });

  it('rejects a non-numeric app id', (): void => {
    const result = readMetaConfig('ios', { ...enabledEnv, VITE_FB_APP_ID: 'fb-app' });

    expect(result).toMatchObject({
      enabled: false,
      reason: 'VITE_FB_APP_ID must be the numeric Facebook app id',
    });
  });

  it('honors explicit privacy opt-ins', (): void => {
    const result = readMetaConfig('ios', {
      ...enabledEnv,
      VITE_FB_AUTO_LOG_APP_EVENTS: 'true',
      VITE_FB_ADVERTISER_ID_COLLECTION: 'true',
    });

    expect(result.enabled && result.config.autoLogAppEvents).toBe(true);
    expect(result.enabled && result.config.advertiserIdCollection).toBe(true);
  });
});

describe('redactMetaToken', (): void => {
  it('keeps only the token tail', (): void => {
    expect(redactMetaToken(CLIENT_TOKEN)).toBe(`<redacted:${CLIENT_TOKEN.slice(-4)}>`);
    expect(redactMetaToken('short')).toBe('<redacted>');
  });
});
