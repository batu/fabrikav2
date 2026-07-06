/**
 * ConsoleSink — the always-available dev sink. No native shell, no credentials,
 * no network: it just prints the flattened payload (env marker included) so a
 * developer can watch the event stream on the web dev-server or in a test.
 */
import type { AnalyticsParams } from './contract.ts';
import { toWirePayload } from './contract.ts';
import type { AnalyticsSink } from './sink.ts';

export interface ConsoleSinkOptions {
  /**
   * Injected line writer. Defaults to `console.log`; tests pass a spy, and a
   * game can route it to an on-screen debug overlay. Receives the event name
   * and the flattened wire payload (which always contains the env marker).
   */
  readonly log?: (name: string, payload: AnalyticsParams) => void;
}

export function createConsoleSink(options: ConsoleSinkOptions = {}): AnalyticsSink {
  const log =
    options.log ??
    ((name: string, payload: AnalyticsParams): void => {
      // eslint-disable-next-line no-console
      console.log(`[analytics] ${name}`, payload);
    });

  return {
    name: 'console',
    emit(event): void {
      log(event.name, toWirePayload(event));
    },
  };
}
