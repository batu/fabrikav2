export interface OwnedAnalyticsMirrorConfig {
  readonly enabled: boolean;
  readonly endpointUrl: string | null;
  readonly publicClientKey: string | null;
  readonly flushBatchSize: number;
  readonly maxQueueItems: number;
  readonly maxQueueBytes: number;
  readonly maxEventAgeMs: number;
  readonly requestTimeoutMs: number;
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly retryableStatuses: readonly number[];
  readonly disabledReason: string | null;
}

export interface OwnedAnalyticsMirrorConfigResult {
  readonly config: OwnedAnalyticsMirrorConfig;
  readonly missingKeys: readonly string[];
  readonly invalidKeys: readonly string[];
}

type ViteEnv = Record<string, string | boolean | undefined>;

const DEFAULT_FLUSH_BATCH_SIZE = 10;
const DEFAULT_MAX_QUEUE_ITEMS = 100;
const DEFAULT_MAX_QUEUE_BYTES = 96_000;
const DEFAULT_MAX_EVENT_AGE_MS = 5 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 5_000;
const DEFAULT_RETRYABLE_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;

export function readOwnedAnalyticsMirrorConfigFromImportMetaEnv(): OwnedAnalyticsMirrorConfigResult {
  return readOwnedAnalyticsMirrorConfig((import.meta as unknown as { env?: ViteEnv }).env ?? {});
}

export function readOwnedAnalyticsMirrorConfig(env: ViteEnv): OwnedAnalyticsMirrorConfigResult {
  const enabled = envFlag(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_ENABLED);
  const endpointUrl = envString(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_URL);
  const publicClientKey = envString(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY);
  const missingKeys: string[] = [];
  const invalidKeys: string[] = [];

  if (!enabled) {
    return {
      config: disabledConfig('VITE_FTD_OWNED_ANALYTICS_MIRROR_ENABLED is not true'),
      missingKeys,
      invalidKeys,
    };
  }

  if (endpointUrl === null) missingKeys.push('VITE_FTD_OWNED_ANALYTICS_MIRROR_URL');
  if (publicClientKey === null) missingKeys.push('VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY');
  if (endpointUrl !== null && !isValidMirrorEndpoint(endpointUrl)) {
    invalidKeys.push('VITE_FTD_OWNED_ANALYTICS_MIRROR_URL');
  }
  if (publicClientKey !== null && publicClientKey.length < 16) {
    invalidKeys.push('VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY');
  }

  if (missingKeys.length > 0 || invalidKeys.length > 0 || endpointUrl === null || publicClientKey === null) {
    return {
      config: disabledConfig(configIssueReason(missingKeys, invalidKeys)),
      missingKeys,
      invalidKeys,
    };
  }

  return {
    config: {
      enabled: true,
      endpointUrl,
      publicClientKey,
      flushBatchSize: envPositiveInt(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_FLUSH_BATCH_SIZE, DEFAULT_FLUSH_BATCH_SIZE),
      maxQueueItems: envPositiveInt(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_MAX_QUEUE_ITEMS, DEFAULT_MAX_QUEUE_ITEMS),
      maxQueueBytes: envPositiveInt(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_MAX_QUEUE_BYTES, DEFAULT_MAX_QUEUE_BYTES),
      maxEventAgeMs: envPositiveInt(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_MAX_EVENT_AGE_MS, DEFAULT_MAX_EVENT_AGE_MS),
      requestTimeoutMs: envPositiveInt(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
      maxAttempts: envPositiveInt(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
      baseBackoffMs: envPositiveInt(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_BASE_BACKOFF_MS, DEFAULT_BASE_BACKOFF_MS),
      maxBackoffMs: envPositiveInt(env.VITE_FTD_OWNED_ANALYTICS_MIRROR_MAX_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS),
      retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
      disabledReason: null,
    },
    missingKeys,
    invalidKeys,
  };
}

function disabledConfig(reason: string): OwnedAnalyticsMirrorConfig {
  return {
    enabled: false,
    endpointUrl: null,
    publicClientKey: null,
    flushBatchSize: DEFAULT_FLUSH_BATCH_SIZE,
    maxQueueItems: DEFAULT_MAX_QUEUE_ITEMS,
    maxQueueBytes: DEFAULT_MAX_QUEUE_BYTES,
    maxEventAgeMs: DEFAULT_MAX_EVENT_AGE_MS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    baseBackoffMs: DEFAULT_BASE_BACKOFF_MS,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    retryableStatuses: DEFAULT_RETRYABLE_STATUSES,
    disabledReason: reason,
  };
}

function configIssueReason(missingKeys: readonly string[], invalidKeys: readonly string[]): string {
  const parts: string[] = [];
  if (missingKeys.length > 0) parts.push(`missing ${missingKeys.join(', ')}`);
  if (invalidKeys.length > 0) parts.push(`invalid ${invalidKeys.join(', ')}`);
  return parts.join('; ');
}

function envString(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function envFlag(value: string | boolean | undefined): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

function envPositiveInt(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isValidMirrorEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username.length === 0
      && url.password.length === 0
      && url.search.length === 0;
  } catch {
    return false;
  }
}
