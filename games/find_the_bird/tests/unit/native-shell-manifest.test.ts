import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Find the Bird native shell manifest', () => {
  it('links the RevenueCat Capacitor package used by the iOS purchase provider', () => {
    const manifest = JSON.parse(
      fs.readFileSync(`${process.cwd()}/native-resources/ios/shell-manifest.json`, 'utf8'),
    ) as {
      ios: { localPackages: Array<{ name: string; product: string }> };
    };

    expect(manifest.ios.localPackages).toContainEqual(
      expect.objectContaining({
        name: 'RevenuecatPurchasesCapacitor',
        product: 'RevenuecatPurchasesCapacitor',
      }),
    );
  });

  it('ships the Meta SKAdNetwork identifiers with the AdMob identifier', () => {
    const manifest = JSON.parse(
      fs.readFileSync(`${process.cwd()}/native-resources/ios/shell-manifest.json`, 'utf8'),
    ) as { ios: { skAdNetworkExpectedCount: number } };
    const catalog = JSON.parse(
      fs.readFileSync(`${process.cwd()}/native-resources/ios/attribution-skadnetwork-ids.json`, 'utf8'),
    ) as { skadnetwork_ids: Array<{ skadnetwork_id: string }> };

    const identifiers = catalog.skadnetwork_ids.map(({ skadnetwork_id }) => skadnetwork_id);
    expect(identifiers).toHaveLength(manifest.ios.skAdNetworkExpectedCount);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(identifiers).toEqual(expect.arrayContaining([
      'cstr6suwn9.skadnetwork',
      'v9wttpbfk9.skadnetwork',
      'n38lu8286q.skadnetwork',
    ]));
  });
});
