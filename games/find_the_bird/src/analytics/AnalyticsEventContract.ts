export type AnalyticsSequenceSource = 'remote' | 'cached' | 'default' | 'direct_select' | 'unknown';
export type AnalyticsSinkVisibility = 'firebase' | 'gameanalytics' | 'owned_mirror' | 'dashboard' | 'local_support_ledger';
export type AnalyticsIdentifierField = 'anonymous_install_id' | 'anonymous_player_id' | 'event_occurrence_id' | 'dedupe_key';

export interface AnalyticsIdentifierPolicy {
  readonly field: AnalyticsIdentifierField;
  readonly persistence: string;
  readonly resetBehavior: string;
  readonly allowedSinks: readonly AnalyticsSinkVisibility[];
  readonly thirdPartyVisibility: 'never';
  readonly dashboardVisibility: 'aggregated_only' | 'never';
  readonly ownedIngestionEncoding: 'keyed_hmac_per_environment';
}

export interface AnalyticsLevelAttributionInput {
  readonly progressionIndex: number;
  readonly runtimeLevelIds: readonly string[];
  readonly intendedLevelId?: string;
  readonly servedLevelId?: string;
  readonly displayLevelNumber?: number;
  readonly sequenceVersion?: string | null;
  readonly sequenceSource?: AnalyticsSequenceSource;
  readonly catalogRevision?: string;
  readonly fallbackReason?: string | null;
}

export interface AnalyticsLevelAttribution {
  readonly sequence_slot: number;
  readonly display_level_number: number;
  readonly intended_level_id: string;
  readonly served_level_id: string;
  readonly fallback_reason: string | null;
  readonly sequence_version: string | null;
  readonly sequence_source: AnalyticsSequenceSource;
  readonly catalog_revision?: string;
}

export interface AnalyticsLevelServingAttemptSnapshot {
  readonly intendedLevelId: string;
  readonly servedLevelId: string;
  readonly progressionIndex: number;
  readonly runtimeLevelIds: readonly string[];
  readonly displayLevelNumber: number;
  readonly sequenceSource: AnalyticsSequenceSource;
  readonly sequenceVersion: string | null;
  readonly catalogRevision?: string;
  readonly fallbackReason: string | null;
}

export const analyticsContractVersion = 'ftd.analytics.v1';

export const analyticsIdentifierPolicies = [
  {
    field: 'anonymous_install_id',
    persistence: 'Stable per install/browser profile using first-party local storage.',
    resetBehavior: 'Resets on app reinstall, browser profile storage clear, or explicit privacy reset.',
    allowedSinks: ['owned_mirror'],
    thirdPartyVisibility: 'never',
    dashboardVisibility: 'aggregated_only',
    ownedIngestionEncoding: 'keyed_hmac_per_environment',
  },
  {
    field: 'anonymous_player_id',
    persistence: 'Stable per local player profile when the app later supports multiple profiles.',
    resetBehavior: 'Resets with local profile deletion or explicit privacy reset.',
    allowedSinks: ['owned_mirror'],
    thirdPartyVisibility: 'never',
    dashboardVisibility: 'aggregated_only',
    ownedIngestionEncoding: 'keyed_hmac_per_environment',
  },
  {
    field: 'event_occurrence_id',
    persistence: 'Per event occurrence for owned ingestion idempotency only.',
    resetBehavior: 'Not persisted beyond retry/idempotency windows.',
    allowedSinks: ['owned_mirror'],
    thirdPartyVisibility: 'never',
    dashboardVisibility: 'never',
    ownedIngestionEncoding: 'keyed_hmac_per_environment',
  },
  {
    field: 'dedupe_key',
    persistence: 'Deterministic owned retry key for mirror/Worker ingestion.',
    resetBehavior: 'Expires with owned ingestion retry/idempotency windows.',
    allowedSinks: ['owned_mirror'],
    thirdPartyVisibility: 'never',
    dashboardVisibility: 'never',
    ownedIngestionEncoding: 'keyed_hmac_per_environment',
  },
] as const satisfies readonly AnalyticsIdentifierPolicy[];

export function resolveAnalyticsLevelAttribution(input: AnalyticsLevelAttributionInput): AnalyticsLevelAttribution {
  if (!Number.isSafeInteger(input.progressionIndex) || input.progressionIndex < 0) {
    throw new Error('progressionIndex must be a safe non-negative integer.');
  }
  if (input.runtimeLevelIds.length === 0) {
    throw new Error('runtimeLevelIds must contain at least one level.');
  }
  if (input.displayLevelNumber !== undefined && (!Number.isSafeInteger(input.displayLevelNumber) || input.displayLevelNumber < 1)) {
    throw new Error('displayLevelNumber must be a safe positive integer.');
  }

  const sequenceIndex = input.progressionIndex % input.runtimeLevelIds.length;
  const intendedLevelId = input.intendedLevelId ?? input.runtimeLevelIds[sequenceIndex];
  if (!isNonEmptyIdentifier(intendedLevelId)) {
    throw new Error('intended level id could not be resolved.');
  }
  const servedLevelId = input.servedLevelId ?? intendedLevelId;
  if (!isNonEmptyIdentifier(servedLevelId)) {
    throw new Error('served level id could not be resolved.');
  }

  return {
    sequence_slot: sequenceIndex + 1,
    display_level_number: input.displayLevelNumber ?? input.progressionIndex + 1,
    intended_level_id: intendedLevelId,
    served_level_id: servedLevelId,
    fallback_reason: input.fallbackReason ?? null,
    sequence_version: input.sequenceVersion ?? null,
    sequence_source: input.sequenceSource ?? 'unknown',
    ...(input.catalogRevision === undefined ? {} : { catalog_revision: input.catalogRevision }),
  };
}

export function resolveAnalyticsLevelAttributionFromServingAttempt(attempt: AnalyticsLevelServingAttemptSnapshot): AnalyticsLevelAttribution {
  return resolveAnalyticsLevelAttribution({
    progressionIndex: attempt.progressionIndex,
    runtimeLevelIds: attempt.runtimeLevelIds,
    intendedLevelId: attempt.intendedLevelId,
    servedLevelId: attempt.servedLevelId,
    displayLevelNumber: attempt.displayLevelNumber,
    sequenceSource: attempt.sequenceSource,
    sequenceVersion: attempt.sequenceVersion,
    catalogRevision: attempt.catalogRevision,
    fallbackReason: attempt.fallbackReason,
  });
}

export function isOwnedAnalyticsIdentifierField(field: string): boolean {
  return analyticsIdentifierPolicies.some((policy) => policy.field === field);
}

function isNonEmptyIdentifier(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
