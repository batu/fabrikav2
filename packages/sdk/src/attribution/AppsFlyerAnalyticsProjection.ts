import type { AnalyticsSink, AnalyticsSinkDiagnostics } from '../analytics/sink.ts';
import type { AnalyticsEvent } from '../analytics/contract.ts';
import type { AppsFlyerCanonicalEvent, DedupeStore } from './AppsFlyerEventMapper.ts';

const PROGRESSION_MILESTONES = new Set([1, 5, 10, 20, 30, 40, 50]);
const RETENTION_DAYS = new Set([1, 3, 7, 14, 30]);

export function createAppsFlyerAnalyticsProjection(options: {
  forward: (event: AppsFlyerCanonicalEvent) => Promise<boolean>;
  dedupe: DedupeStore;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
}): AnalyticsSink {
  const now = options.now ?? Date.now;
  const inFlight = new Set<string>();
  const metrics = { sent: 0, dropped: 0 };
  return {
    name: 'appsflyer-projection',
    emit(event: AnalyticsEvent): void {
      if (event.name === 'level_complete') {
        const level = progressionLevel(event.params);
        if (level === null) return;
        if (level === 1) forwardOnce(options, inFlight, metrics, 'tutorial:intro', { type: 'tutorial_completed', tutorialId: 'intro' });
        if (PROGRESSION_MILESTONES.has(level)) forwardOnce(options, inFlight, metrics, `progression:${level}`, { type: 'progression_milestone', level });
        return;
      }
      if (event.name === 'app_open') {
        const openedAt = now();
        const firstSeen = readFirstSeen(options.storage, openedAt);
        const day = Math.floor((openedAt - firstSeen) / 86_400_000);
        if (RETENTION_DAYS.has(day)) forwardOnce(options, inFlight, metrics, `retention:${day}`, { type: 'retention_milestone', day: day as 1 | 3 | 7 | 14 | 30 });
      }
    },
    diagnostics(): AnalyticsSinkDiagnostics {
      return {
        queued: inFlight.size,
        sent: metrics.sent,
        retried: 0,
        dropped: metrics.dropped,
        initializationFailure: null,
        lastSuccessfulFlushAt: null,
      };
    },
  };
}

function forwardOnce(
  options: { forward: (event: AppsFlyerCanonicalEvent) => Promise<boolean>; dedupe: DedupeStore },
  inFlight: Set<string>,
  metrics: { sent: number; dropped: number },
  key: string,
  event: AppsFlyerCanonicalEvent,
): void {
  if (options.dedupe.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  void options.forward(event).then((delivered) => {
    if (delivered) {
      options.dedupe.add(key);
      metrics.sent += 1;
    } else {
      metrics.dropped += 1;
    }
  }, () => {
    metrics.dropped += 1;
  }).finally(() => { inFlight.delete(key); });
}

function progressionLevel(params: Readonly<Record<string, unknown>>): number | null {
  const sequenceSlot = Number(params.sequence_slot);
  if (Number.isSafeInteger(sequenceSlot) && sequenceSlot > 0) return sequenceSlot;
  const zeroBasedIndex = Number(params.level_index);
  if (Number.isSafeInteger(zeroBasedIndex) && zeroBasedIndex >= 0) return zeroBasedIndex + 1;
  return null;
}

function readFirstSeen(storage: Pick<Storage, 'getItem' | 'setItem'>, now: number): number {
  const current = Number(storage.getItem('appsflyer-first-seen-at'));
  if (Number.isFinite(current) && current > 0 && current <= now) return current;
  try { storage.setItem('appsflyer-first-seen-at', String(now)); } catch { /* retention projection is non-critical */ }
  return now;
}
