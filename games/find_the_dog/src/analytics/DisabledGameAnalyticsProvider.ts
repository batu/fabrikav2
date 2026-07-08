import type {
  GameAnalyticsAdEvent,
  GameAnalyticsDesignEvent,
  GameAnalyticsProgressionEvent,
  GameAnalyticsResourceEvent,
  GameAnalyticsSink,
} from './GameAnalyticsEvents';

export class DisabledGameAnalyticsProvider implements GameAnalyticsSink {
  readonly providerName = 'disabled';
  private didLogReason = false;

  constructor(
    private readonly reason: string,
    private readonly logger: Pick<Console, 'info'> = console,
  ) {}

  async init(): Promise<void> {
    this.logReasonOnce();
  }

  async trackProgression(_event: GameAnalyticsProgressionEvent): Promise<void> {
    this.logReasonOnce();
  }

  async trackDesign(_event: GameAnalyticsDesignEvent): Promise<void> {
    this.logReasonOnce();
  }

  async trackResource(_event: GameAnalyticsResourceEvent): Promise<void> {
    this.logReasonOnce();
  }

  async trackAd(_event: GameAnalyticsAdEvent): Promise<void> {
    this.logReasonOnce();
  }

  private logReasonOnce(): void {
    if (this.didLogReason) return;
    this.didLogReason = true;
    this.logger.info(`[analytics:gameanalytics:disabled] ${this.reason}`);
  }
}
