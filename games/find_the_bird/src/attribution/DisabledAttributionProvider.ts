import type { AttributionEventName, AttributionParams, AttributionProvider } from './AttributionProvider';

export class DisabledAttributionProvider implements AttributionProvider {
  readonly providerName = 'disabled';
  private didLogReason = false;

  constructor(
    private readonly reason: string,
    private readonly logger: Pick<Console, 'info'> = console,
  ) {}

  async init(): Promise<void> {
    this.logReasonOnce();
  }

  async track(_eventName: AttributionEventName, _params?: AttributionParams): Promise<void> {
    this.logReasonOnce();
  }

  private logReasonOnce(): void {
    if (this.didLogReason) return;
    this.didLogReason = true;
    this.logger.info(`[attribution:disabled] ${this.reason}`);
  }
}
