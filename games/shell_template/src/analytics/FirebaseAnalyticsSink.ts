export interface FirebaseAnalyticsSink {
  logEvent(name: string, params?: object): Promise<void>;
  setUserProperty(name: string, value: string): Promise<void>;
}

export function createDisabledFirebaseAnalyticsSink(): FirebaseAnalyticsSink {
  return {
    async logEvent(): Promise<void> {
      // Disabled in the v2 local port.
    },
    async setUserProperty(): Promise<void> {
      // Disabled in the v2 local port.
    },
  };
}

export function createFirebaseAnalyticsSink(): FirebaseAnalyticsSink {
  return createDisabledFirebaseAnalyticsSink();
}
