import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('achievement runtime wiring contract', () => {
  it('records accepted dog finds before draining their analytics outbox', () => {
    const gameScene = source('src/scenes/GameScene.ts');
    const record = gameScene.indexOf('gameState.recordDogFound(this.level!.id, dog.id);');
    const drain = gameScene.indexOf('gameState.drainAnalyticsOutbox();', record);
    expect(record).toBeGreaterThan(-1);
    expect(drain).toBeGreaterThan(record);
  });

  it('preserves the existing completion-result consumer and then drains analytics', () => {
    const gameScene = source('src/scenes/GameScene.ts');
    const begin = gameScene.indexOf('const completion = gameState.beginLevelCompletionTransaction({');
    const baseGrant = gameScene.indexOf('completion.baseCoinsGrantedNow', begin);
    const transaction = gameScene.indexOf('completion.transaction.baseCoinReward', begin);
    const previousBest = gameScene.indexOf('const previousBest = completion.previousBest;', begin);
    const drain = gameScene.indexOf('gameState.drainAnalyticsOutbox();', begin);
    expect(begin).toBeGreaterThan(-1);
    expect(baseGrant).toBeGreaterThan(begin);
    expect(transaction).toBeGreaterThan(begin);
    expect(drain).toBeGreaterThan(begin);
    expect(previousBest).toBeGreaterThan(drain);
  });

  it('drains recovered events only after the real analytics composition is installed', () => {
    const sdkContext = source('src/sdk/SdkContext.ts');
    const install = sdkContext.indexOf('export function installSdkContext');
    const configure = sdkContext.indexOf('analytics.configureComposition({', install);
    const drain = sdkContext.indexOf('gameState.drainAnalyticsOutbox();', install);
    expect(install).toBeGreaterThan(-1);
    expect(configure).toBeGreaterThan(install);
    expect(drain).toBeGreaterThan(configure);
  });
});
