import { describe, expect, it } from 'vitest';
import { readAppLovinIosConfig } from '../../src/ads/AppLovinConfig';
import { DEFAULT_LEGAL_LINKS, getLegalLinks } from '../../src/platform/LegalLinks';

const MARBLE_RUN_LEGAL_LINKS = {
  privacyPolicyUrl: 'https://basegamelab.com/marble-run/privacy',
  termsUrl: 'https://basegamelab.com/marble-run/terms',
  supportUrl: 'https://basegamelab.com/marble-run/support',
  dataDeletionUrl: 'https://basegamelab.com/marble-run/data-deletion',
};

describe('Marble Run legal links', () => {
  it('uses the public Marble Run legal pages by default', () => {
    expect(DEFAULT_LEGAL_LINKS).toEqual(MARBLE_RUN_LEGAL_LINKS);
    expect(getLegalLinks({})).toEqual(MARBLE_RUN_LEGAL_LINKS);
  });

  it('accepts Marble Run overrides without reading Find the Dog overrides', () => {
    expect(getLegalLinks({
      VITE_MARBLE_RUN_PRIVACY_POLICY_URL: ' https://example.com/marble/privacy ',
      VITE_MARBLE_RUN_TERMS_URL: 'https://example.com/marble/terms',
      VITE_MARBLE_RUN_SUPPORT_URL: 'https://example.com/marble/support',
      VITE_MARBLE_RUN_DATA_DELETION_URL: 'https://example.com/marble/delete',
      VITE_FTD_PRIVACY_POLICY_URL: 'https://example.com/find-the-dog/privacy',
      VITE_FTD_TERMS_URL: 'https://example.com/find-the-dog/terms',
      VITE_FTD_SUPPORT_URL: 'https://example.com/find-the-dog/support',
      VITE_FTD_DATA_DELETION_URL: 'https://example.com/find-the-dog/delete',
    })).toEqual({
      privacyPolicyUrl: 'https://example.com/marble/privacy',
      termsUrl: 'https://example.com/marble/terms',
      supportUrl: 'https://example.com/marble/support',
      dataDeletionUrl: 'https://example.com/marble/delete',
    });
  });

  it('passes the Marble Run policy and terms URLs into AppLovin consent', () => {
    const result = readAppLovinIosConfig({
      VITE_APPLOVIN_IOS_ENABLED: 'true',
      VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY: 'true',
      VITE_APPLOVIN_IOS_SDK_KEY: 'sdk-key',
      VITE_MARBLE_RUN_PRIVACY_POLICY_URL: 'https://example.com/marble/privacy',
      VITE_MARBLE_RUN_TERMS_URL: 'https://example.com/marble/terms',
      VITE_FTD_PRIVACY_POLICY_URL: 'https://example.com/find-the-dog/privacy',
      VITE_FTD_TERMS_URL: 'https://example.com/find-the-dog/terms',
    });

    expect(result.enabled).toBe(true);
    if (!result.enabled) throw new Error(result.reason);
    expect(result.config.consentFlow.privacyPolicyUrl).toBe('https://example.com/marble/privacy');
    expect(result.config.consentFlow.termsOfServiceUrl).toBe('https://example.com/marble/terms');
  });
});
