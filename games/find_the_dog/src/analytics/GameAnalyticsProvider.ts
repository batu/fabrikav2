import type { GameAnalyticsAdEvent, GameAnalyticsDesignEvent, GameAnalyticsProgressionEvent, GameAnalyticsResourceEvent } from './GameAnalyticsEvents';

export class GameAnalyticsProvider {
  init(): Promise<void> {
    return Promise.resolve();
  }

  trackDesign(_event: GameAnalyticsDesignEvent): Promise<void> {
    return Promise.resolve();
  }

  trackProgression(_event: GameAnalyticsProgressionEvent): Promise<void> {
    return Promise.resolve();
  }

  trackResource(_event: GameAnalyticsResourceEvent): Promise<void> {
    return Promise.resolve();
  }

  trackAd(_event: GameAnalyticsAdEvent): Promise<void> {
    return Promise.resolve();
  }
}

export const gameAnalytics = new GameAnalyticsProvider();
