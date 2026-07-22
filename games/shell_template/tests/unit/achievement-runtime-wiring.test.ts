import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('achievement runtime wiring contract', () => {
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

  it('hands the committed achievement delta to the completion overlay', () => {
    const gameScene = source('src/scenes/GameScene.ts');
    expect(gameScene).toContain('achievementCommit: completion.achievementCommit,');
  });

  it('drains recovered events only after analytics is live (bootstrap boundary)', () => {
    const bootstrap = source('src/bootstrap.ts');
    const appOpen = bootstrap.indexOf('void analytics.appOpen();');
    const drain = bootstrap.indexOf('gameState.drainAnalyticsOutbox();');
    expect(appOpen).toBeGreaterThan(-1);
    expect(drain).toBeGreaterThan(appOpen);
  });
});
