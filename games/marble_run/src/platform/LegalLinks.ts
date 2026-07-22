export interface LegalLinks {
  privacyPolicyUrl: string;
  termsUrl: string;
  supportUrl: string;
  dataDeletionUrl: string;
}

export type LegalLinksEnv = Record<string, string | boolean | undefined>;

export const DEFAULT_LEGAL_LINKS: LegalLinks = {
  privacyPolicyUrl: 'https://basegamelab.com/marble-run/privacy',
  termsUrl: 'https://basegamelab.com/marble-run/terms',
  supportUrl: 'https://basegamelab.com/marble-run/support',
  dataDeletionUrl: 'https://basegamelab.com/marble-run/data-deletion',
};

export function getLegalLinks(env: LegalLinksEnv = import.meta.env): LegalLinks {
  return {
    privacyPolicyUrl: envString(env, 'VITE_MARBLE_RUN_PRIVACY_POLICY_URL') ?? DEFAULT_LEGAL_LINKS.privacyPolicyUrl,
    termsUrl: envString(env, 'VITE_MARBLE_RUN_TERMS_URL') ?? DEFAULT_LEGAL_LINKS.termsUrl,
    supportUrl: envString(env, 'VITE_MARBLE_RUN_SUPPORT_URL') ?? DEFAULT_LEGAL_LINKS.supportUrl,
    dataDeletionUrl: envString(env, 'VITE_MARBLE_RUN_DATA_DELETION_URL') ?? DEFAULT_LEGAL_LINKS.dataDeletionUrl,
  };
}

function envString(env: LegalLinksEnv, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
