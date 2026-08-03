import { describe, expect, it } from 'vitest';

import { DEFAULT_LEGAL_LINKS, getLegalLinks } from '../../src/platform/LegalLinks';

describe('Find the Bird legal links', () => {
  it('defaults every legal destination to the Find the Bird site', () => {
    expect(DEFAULT_LEGAL_LINKS).toEqual({
      privacyPolicyUrl: 'https://basegamelab.com/find-the-bird/privacy',
      termsUrl: 'https://basegamelab.com/find-the-bird/terms',
      supportUrl: 'https://basegamelab.com/find-the-bird/support',
      dataDeletionUrl: 'https://basegamelab.com/find-the-bird/data-deletion',
    });
  });

  it('keeps explicit release configuration overrides', () => {
    expect(getLegalLinks({ VITE_FTD_SUPPORT_URL: ' https://support.example/bird ' }).supportUrl)
      .toBe('https://support.example/bird');
  });
});
