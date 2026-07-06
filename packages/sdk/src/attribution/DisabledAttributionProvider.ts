import type { AttributionEventName, AttributionParamBag, AttributionProvider } from './AttributionProvider.ts';

export class DisabledAttributionProvider implements AttributionProvider {
  readonly providerName = 'disabled';
  private didLogReason = false;

  constructor(
    private readonly reason: string,
    private readonly logger: Pick<Console, 'info' | 'warn'> = console,
  ) {}

  async init(): Promise<void> {
    this.logReasonOnce();
  }

  async track<P extends AttributionParamBag<P>>(_eventName: AttributionEventName, _params?: P): Promise<void> {
    this.logReasonOnce();
  }

  private logReasonOnce(): void {
    if (this.didLogReason) return;
    this.didLogReason = true;
    const message = `[attribution:disabled] ${this.reason}`;
    if (this.reason.startsWith('iOS Adjust unavailable:')) {
      this.logger.warn(message);
      return;
    }
    this.logger.info(message);
  }
}
