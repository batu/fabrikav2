export interface PrivacyConsentServiceDependencies {
  showAdPrivacyOptions: () => Promise<boolean>;
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
  timeoutMs: number;
  logger: Pick<Console, 'warn'>;
}

export interface PrivacyOptionsResult {
  shown: boolean;
}

const defaultDependencies: PrivacyConsentServiceDependencies = {
  showAdPrivacyOptions: async (): Promise<boolean> => {
    const ads = await import('../ads/Service');
    return ads.showAdPrivacyOptions();
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  timeoutMs: 15_000,
  logger: console,
};

export class PrivacyConsentService {
  private inFlight: Promise<PrivacyOptionsResult> | null = null;

  constructor(private readonly dependencies: PrivacyConsentServiceDependencies = defaultDependencies) {}

  showPrivacyOptions(): Promise<PrivacyOptionsResult> {
    if (this.inFlight !== null) return this.inFlight;
    const request = this.showPrivacyOptionsOnce()
      .finally((): void => {
        if (this.inFlight === request) this.inFlight = null;
      });
    this.inFlight = request;
    return request;
  }

  private async showPrivacyOptionsOnce(): Promise<PrivacyOptionsResult> {
    try {
      const shown = await this.withTimeout(this.dependencies.showAdPrivacyOptions());
      return { shown };
    } catch (err: unknown) {
      this.dependencies.logger.warn('[privacy] privacy options failed', err);
      return { shown: false };
    }
  }

  private withTimeout<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      // `timer` is declared first so it can be `const`; its callback references
      // `finish` (defined just below), which is safe because the callback only
      // fires asynchronously, after `finish` is initialized.
      const timer = this.dependencies.setTimeout(() => {
        finish(() => reject(new Error('privacy options timed out')));
      }, this.dependencies.timeoutMs);
      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        this.dependencies.clearTimeout(timer);
        settle();
      };
      operation.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }
}

export const privacyConsentService = new PrivacyConsentService();
