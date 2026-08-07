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
});
