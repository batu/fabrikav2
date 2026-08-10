import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFirebaseRemoteConfigTemplate,
  stableRemoteConfigTemplateJson,
} from '../../src/config/remoteConfigTemplate';

/**
 * `docs/remote-config-template.json` is what gets uploaded to the Firebase
 * console, so it must never drift from the schema the client actually reads.
 * Regenerate with `UPDATE_REMOTE_CONFIG_TEMPLATE=1 npm run test:unit`.
 */
const templatePath = resolve(__dirname, '../../docs/remote-config-template.json');

describe('firebase remote config template', () => {
  it('matches the compiled schema', () => {
    const generated = stableRemoteConfigTemplateJson(buildFirebaseRemoteConfigTemplate());
    if (process.env.UPDATE_REMOTE_CONFIG_TEMPLATE === '1') {
      writeFileSync(templatePath, generated);
    }
    expect(readFileSync(templatePath, 'utf8')).toBe(generated);
  });

  it('publishes every ad-policy key the client reads', () => {
    const template = buildFirebaseRemoteConfigTemplate();
    const adParameters = Object.keys(template.parameterGroups.Ads.parameters);
    expect(adParameters).toEqual([
      'interstitial_ads_enabled',
      'interstitial_first_level',
      'interstitial_fail_only_until_level',
      'interstitial_fail_cooldown_s',
      'interstitial_level_end_cooldown_s',
      'rewarded_ads_enabled',
    ]);
  });
});
