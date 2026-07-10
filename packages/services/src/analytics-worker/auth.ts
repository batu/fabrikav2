import {
  ANALYTICS_ENVIRONMENTS,
  type AnalyticsEnvironment,
  type AnalyticsWorkerEnv,
  type AnalyticsWorkerError,
  type OwnedAnalyticsWorkerBatch,
} from './contracts.ts';

export const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type IngestCredentialConfigState = 'missing' | 'empty' | 'invalid' | 'loaded';

export interface IngestCredential {
  readonly key: string;
  readonly games: ReadonlySet<string>;
  readonly envs: ReadonlySet<AnalyticsEnvironment>;
}

export interface ParsedIngestCredentials {
  readonly credentials: ReadonlyMap<string, IngestCredential>;
  readonly configState: IngestCredentialConfigState;
  readonly malformedEntries: number;
  readonly duplicateCanonicalKeys: ReadonlySet<string>;
}

export type IngestAuthenticationResult =
  | { readonly ok: true; readonly credential: IngestCredential }
  | { readonly ok: false; readonly status: 401 | 403; readonly error: AnalyticsWorkerError };

export type IngestAuthorizationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'game' | 'env' };

export function parseIngestCredentials(env: AnalyticsWorkerEnv): ParsedIngestCredentials {
  const rawConfig = env.ANALYTICS_INGEST_CREDENTIALS;
  if (rawConfig === undefined) return emptyParseResult('missing');
  if (rawConfig.trim().length === 0) return emptyParseResult('empty');

  let entries: unknown;
  try {
    entries = JSON.parse(rawConfig);
  } catch {
    return emptyParseResult('invalid');
  }
  if (!Array.isArray(entries)) return emptyParseResult('invalid');

  const canonicalKeyCounts = new Map<string, number>();
  const duplicateCanonicalKeys = new Set<string>();
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.key !== 'string') continue;
    const canonicalKey = entry.key.trim();
    const count = (canonicalKeyCounts.get(canonicalKey) ?? 0) + 1;
    canonicalKeyCounts.set(canonicalKey, count);
    if (count === 2) duplicateCanonicalKeys.add(canonicalKey);
  }

  const credentials = new Map<string, IngestCredential>();
  let malformedEntries = 0;
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.key !== 'string') {
      malformedEntries += 1;
      continue;
    }

    const rawKey = entry.key;
    const canonicalKey = rawKey.trim();
    if (
      rawKey !== canonicalKey
      || canonicalKey.length < 16
      || canonicalKeyCounts.get(canonicalKey) !== 1
    ) {
      malformedEntries += 1;
      continue;
    }

    const games = parseGames(entry.games);
    const envs = parseEnvironments(entry.envs);
    if (games === null || envs === null) {
      malformedEntries += 1;
      continue;
    }

    credentials.set(canonicalKey, { key: canonicalKey, games, envs });
  }

  return {
    credentials,
    configState: 'loaded',
    malformedEntries,
    duplicateCanonicalKeys,
  };
}

export function authenticate(
  request: Request,
  credentials: ReadonlyMap<string, IngestCredential>,
): IngestAuthenticationResult {
  const authorization = request.headers.get('authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: { code: 'missing_token', message: 'Missing bearer token.' } };
  }
  const publicClientKey = authorization.slice('Bearer '.length).trim();
  const credential = credentials.get(publicClientKey);
  if (credential === undefined) {
    return { ok: false, status: 403, error: { code: 'invalid_token', message: 'Invalid public client token.' } };
  }
  return { ok: true, credential };
}

export function authorizeEnvelope(
  credential: IngestCredential,
  batch: OwnedAnalyticsWorkerBatch,
): IngestAuthorizationResult {
  const gameAllowed = credential.games.has(batch.game_id);
  const environmentAllowed = credential.envs.has(batch.env);
  if (!gameAllowed) return { ok: false, reason: 'game' };
  if (!environmentAllowed) return { ok: false, reason: 'env' };
  return { ok: true };
}

export function isAnalyticsEnvironment(value: unknown): value is AnalyticsEnvironment {
  return typeof value === 'string'
    && (ANALYTICS_ENVIRONMENTS as readonly string[]).includes(value);
}

function emptyParseResult(configState: Exclude<IngestCredentialConfigState, 'loaded'>): ParsedIngestCredentials {
  return {
    credentials: new Map(),
    configState,
    malformedEntries: 0,
    duplicateCanonicalKeys: new Set(),
  };
}

function parseGames(value: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((gameId) => typeof gameId === 'string' && GAME_ID_PATTERN.test(gameId))) return null;
  return new Set(value);
}

function parseEnvironments(value: unknown): ReadonlySet<AnalyticsEnvironment> | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isAnalyticsEnvironment)) return null;
  return new Set(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
