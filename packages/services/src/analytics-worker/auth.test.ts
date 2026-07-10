import { describe, expect, it, vi } from 'vitest';
import {
  authenticate,
  authorizeEnvelope,
  parseIngestCredentials,
  type IngestCredential,
} from './auth.ts';
import {
  ownedAnalyticsWorkerSchema,
  type AnalyticsEnvironment,
  type AnalyticsWorkerEnv,
  type OwnedAnalyticsWorkerBatch,
} from './contracts.ts';

const oldKey = 'old-ingest-key-1234567890';
const newKey = 'new-ingest-key-1234567890';
const controlKey = 'control-key-1234567890';

function credential(
  key: string,
  games: readonly string[] = ['marble_run'],
  envs: readonly string[] = ['production'],
): Record<string, unknown> {
  return { key, games, envs };
}

function parseConfig(value: string | undefined) {
  const env: AnalyticsWorkerEnv = {
    ANALYTICS_PUBLIC_CLIENT_KEYS: oldKey,
    ANALYTICS_ALLOWED_GAME_IDS: 'marble_run,find_the_dog',
    ANALYTICS_INGEST_CREDENTIALS: value,
  };
  return parseIngestCredentials(env);
}

function batch(
  gameId = 'marble_run',
  env: AnalyticsEnvironment = 'production',
): OwnedAnalyticsWorkerBatch {
  return {
    schema: ownedAnalyticsWorkerSchema,
    game_id: gameId,
    env,
    events: [{
      event_id: 'event-1',
      enqueued_at: 1_000,
      name: 'level_start',
      params: {},
    }],
  };
}

function bearer(key: string): Request {
  return new Request('https://analytics.example.com/ingest', {
    headers: { authorization: `Bearer ${key}` },
  });
}

describe('analytics ingest credential auth', (): void => {
  it.each([
    ['missing', undefined, 'missing'],
    ['empty', '', 'empty'],
    ['whitespace', ' \n\t ', 'empty'],
    ['malformed JSON', '{', 'invalid'],
    ['object', '{}', 'invalid'],
    ['null', 'null', 'invalid'],
    ['scalar', '"credential"', 'invalid'],
    ['empty array', '[]', 'loaded'],
  ] as const)('reports the sanitized %s config state and fails closed', (_label, value, expectedState): void => {
    const parsed = parseConfig(value);

    expect(parsed.configState).toBe(expectedState);
    expect(parsed.credentials.size).toBe(0);
    expect(parsed.malformedEntries).toBe(0);
    expect(parsed.duplicateCanonicalKeys.size).toBe(0);
    expect(authenticate(bearer(oldKey), parsed.credentials)).toMatchObject({
      ok: false,
      status: 403,
      error: { code: 'invalid_token' },
    });
  });

  it('loads only uniquely keyed entries with explicit valid non-empty claims', (): void => {
    const whitespaceKey = ' whitespace-key-1234567890 ';
    const parsed = parseConfig(JSON.stringify([
      { key: 'missing-games-key-1234567890', envs: ['production'] },
      credential('empty-envs-key-1234567890', ['marble_run'], []),
      credential('invalid-env-key-1234567890', ['marble_run'], ['staging']),
      credential('short', ['marble_run'], ['production']),
      credential(whitespaceKey, ['marble_run'], ['production']),
      credential(controlKey, ['marble_run', 'find_the_dog'], ['production', 'development', 'test']),
    ]));

    expect(parsed.configState).toBe('loaded');
    expect(parsed.malformedEntries).toBe(5);
    expect(parsed.duplicateCanonicalKeys.size).toBe(0);
    expect([...parsed.credentials.keys()]).toEqual([controlKey]);
    expect(parsed.credentials.get(controlKey)?.games).toEqual(new Set(['marble_run', 'find_the_dog']));
    expect(parsed.credentials.get(controlKey)?.envs).toEqual(new Set(['production', 'development', 'test']));
  });

  it.each([
    ['two occurrences', [credential(oldKey), credential(oldKey)]],
    ['three occurrences with malformed first', [{ key: oldKey, games: ['marble_run'] }, credential(oldKey), credential(oldKey)]],
    ['three occurrences with malformed middle', [credential(oldKey), { key: oldKey, envs: ['production'] }, credential(oldKey)]],
    ['three occurrences with malformed last', [credential(oldKey), credential(oldKey), { key: oldKey, games: [] }]],
    ['four occurrences including whitespace variant', [
      credential(oldKey),
      credential(` ${oldKey} `),
      { key: oldKey, games: ['marble_run'] },
      credential(oldKey),
    ]],
  ] as const)('permanently poisons canonical duplicate keys: %s', (_label, duplicates): void => {
    const parsed = parseConfig(JSON.stringify([
      ...duplicates,
      credential(controlKey),
    ]));

    expect(parsed.duplicateCanonicalKeys).toEqual(new Set([oldKey]));
    expect(parsed.credentials.has(oldKey)).toBe(false);
    expect(parsed.credentials.has(` ${oldKey} `)).toBe(false);
    expect(parsed.credentials.has(controlKey)).toBe(true);
    expect(parsed.malformedEntries).toBe(duplicates.length);
  });

  it('keeps bearer parsing behavior while returning the matching credential', (): void => {
    const parsed = parseConfig(JSON.stringify([credential(oldKey)]));
    const missing = authenticate(new Request('https://analytics.example.com/ingest'), parsed.credentials);
    const invalid = authenticate(bearer(newKey), parsed.credentials);
    const accepted = authenticate(bearer(oldKey), parsed.credentials);

    expect(missing).toMatchObject({ ok: false, status: 401, error: { code: 'missing_token' } });
    expect(invalid).toMatchObject({ ok: false, status: 403, error: { code: 'invalid_token' } });
    expect(accepted).toMatchObject({ ok: true, credential: { key: oldKey } });
  });

  it('authorizes multiple games and all canonical environments directly from the worker batch', (): void => {
    const parsed = parseConfig(JSON.stringify([
      credential(controlKey, ['marble_run', 'find_the_dog'], ['production', 'development', 'test']),
    ]));
    const scoped = parsed.credentials.get(controlKey);
    expect(scoped).toBeDefined();
    if (scoped === undefined) return;

    for (const gameId of ['marble_run', 'find_the_dog']) {
      for (const env of ['production', 'development', 'test'] as const) {
        expect(authorizeEnvelope(scoped, batch(gameId, env))).toEqual({ ok: true });
      }
    }
  });

  it('checks both claims and uses stable game-before-env internal precedence', (): void => {
    const games = new Set(['marble_run']);
    const envs = new Set<AnalyticsEnvironment>(['production']);
    const gameHas = vi.spyOn(games, 'has');
    const envHas = vi.spyOn(envs, 'has');
    const scoped: IngestCredential = { key: oldKey, games, envs };

    expect(authorizeEnvelope(scoped, batch('find_the_dog', 'development'))).toEqual({ ok: false, reason: 'game' });
    expect(gameHas).toHaveBeenCalledWith('find_the_dog');
    expect(envHas).toHaveBeenCalledWith('development');

    expect(authorizeEnvelope(scoped, batch('marble_run', 'development'))).toEqual({ ok: false, reason: 'env' });
    expect(authorizeEnvelope(scoped, batch('find_the_dog', 'production'))).toEqual({ ok: false, reason: 'game' });
  });

  it('supports narrow overlap, revocation, and rollback registries without wildcard grants', (): void => {
    const narrowClaims = ['marble_run'] as const;
    const narrowEnvs = ['production'] as const;
    const overlap = parseConfig(JSON.stringify([
      credential(oldKey, narrowClaims, narrowEnvs),
      credential(newKey, narrowClaims, narrowEnvs),
    ]));

    const oldOverlap = authenticate(bearer(oldKey), overlap.credentials);
    const newOverlap = authenticate(bearer(newKey), overlap.credentials);
    expect(oldOverlap.ok).toBe(true);
    expect(newOverlap.ok).toBe(true);
    if (!oldOverlap.ok || !newOverlap.ok) return;
    expect(authorizeEnvelope(oldOverlap.credential, batch())).toEqual({ ok: true });
    expect(authorizeEnvelope(newOverlap.credential, batch())).toEqual({ ok: true });
    expect(authorizeEnvelope(oldOverlap.credential, batch('find_the_dog'))).toEqual({ ok: false, reason: 'game' });

    const revoked = parseConfig(JSON.stringify([credential(newKey, narrowClaims, narrowEnvs)]));
    expect(authenticate(bearer(oldKey), revoked.credentials).ok).toBe(false);
    expect(authenticate(bearer(newKey), revoked.credentials).ok).toBe(true);

    const rollback = parseConfig(JSON.stringify([
      credential(oldKey, narrowClaims, narrowEnvs),
      credential(newKey, narrowClaims, narrowEnvs),
    ]));
    expect(rollback.credentials.get(oldKey)?.games).toEqual(new Set(narrowClaims));
    expect(rollback.credentials.get(oldKey)?.envs).toEqual(new Set(narrowEnvs));
  });
});
