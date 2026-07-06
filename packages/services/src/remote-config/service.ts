/**
 * Game-agnostic remote-config service — schema-validated flags, defaults, and a
 * fetch+cache lifecycle over an INJECTABLE provider seam.
 *
 * This is the reusable middle of FTD's `RemoteConfigService.ts` (241 lines,
 * welded to `firebase/remote-config`): the state machine, the default-fallback
 * discipline, and the typed `value(key)`/`snapshot()` surface — but with the
 * Firebase SDK pushed behind a `RemoteConfigProvider` seam so it unit-tests
 * against a fake with zero network and any game can wire any backend (Firebase,
 * a plain HTTPS JSON endpoint, a bundled file). A game passes its own schema;
 * the returned service is typed to that schema's keys.
 *
 * Fallback contract (the AC's "default-fallback tested"): a key resolves to its
 * remote value ONLY when the provider delivered a value that coerces to the
 * declared type and passes the field's optional `validate`. Absent, wrong-type,
 * and failed-validate all fall back to the declared default. A failed refresh
 * keeps the last good values rather than reverting to defaults.
 */
import {
  coerceConfigValue,
  defaultValues,
  remoteKeyFor,
  type ConfigSchema,
  type ConfigValues,
} from './schema.ts';

export type RemoteConfigState =
  | 'local-only'
  | 'fetching'
  | 'ready'
  | 'fetch-failed';

/** The one injected dependency. Returns raw remote values keyed by remoteKey. */
export interface RemoteConfigProvider {
  fetch(): Promise<Record<string, unknown>>;
}

export type ValueOrigin = 'default' | 'remote';

export interface RemoteConfigSnapshot<S extends ConfigSchema> {
  readonly state: RemoteConfigState;
  readonly defaults: ConfigValues<S>;
  readonly active: ConfigValues<S>;
  readonly origins: Record<keyof S, ValueOrigin>;
  readonly lastFetchAtMs: number | null;
  readonly lastErrorMessage: string | null;
}

export interface RemoteConfigServiceOptions {
  readonly provider?: RemoteConfigProvider;
  /** Injected clock for `lastFetchAtMs`; default `Date.now`. */
  readonly now?: () => number;
}

export interface RemoteConfigService<S extends ConfigSchema> {
  /** Fetch, validate, and cache remote values. Idempotent-safe to re-call. */
  refresh(): Promise<void>;
  /** Typed accessor: remote value when valid, else the declared default. */
  value<K extends keyof S>(key: K): ConfigValues<S>[K];
  snapshot(): RemoteConfigSnapshot<S>;
  readonly state: RemoteConfigState;
}

export function createRemoteConfigService<S extends ConfigSchema>(
  schema: S,
  options: RemoteConfigServiceOptions = {},
): RemoteConfigService<S> {
  const now = options.now ?? Date.now;
  const defaults = defaultValues(schema);
  const keys = Object.keys(schema) as (keyof S)[];

  let state: RemoteConfigState = 'local-only';
  let active: ConfigValues<S> = defaults;
  let origins = allDefaultOrigins(keys);
  let lastFetchAtMs: number | null = null;
  let lastErrorMessage: string | null = null;

  async function refresh(): Promise<void> {
    const provider = options.provider;
    if (provider === undefined) {
      state = 'local-only';
      return;
    }
    state = 'fetching';
    let raw: Record<string, unknown>;
    try {
      raw = await provider.fetch();
    } catch (err) {
      // Keep last good values; do not revert to defaults on a transient failure.
      lastErrorMessage = errorMessage(err);
      state = 'fetch-failed';
      return;
    }

    const resolved: Record<string, unknown> = {};
    const nextOrigins: Record<string, ValueOrigin> = {};
    for (const key of keys) {
      const definition = schema[key];
      const result = coerceConfigValue(definition, raw[remoteKeyFor(key as string, definition)]);
      if (result.ok) {
        resolved[key as string] = result.value;
        nextOrigins[key as string] = 'remote';
      } else {
        resolved[key as string] = definition.default;
        nextOrigins[key as string] = 'default';
      }
    }
    active = resolved as ConfigValues<S>;
    origins = nextOrigins as Record<keyof S, ValueOrigin>;
    lastFetchAtMs = now();
    lastErrorMessage = null;
    state = 'ready';
  }

  function value<K extends keyof S>(key: K): ConfigValues<S>[K] {
    return active[key];
  }

  function snapshot(): RemoteConfigSnapshot<S> {
    return {
      state,
      defaults: { ...defaults },
      active: { ...active },
      origins: { ...origins },
      lastFetchAtMs,
      lastErrorMessage,
    };
  }

  return {
    refresh,
    value,
    snapshot,
    get state(): RemoteConfigState {
      return state;
    },
  };
}

function allDefaultOrigins<S extends ConfigSchema>(keys: (keyof S)[]): Record<keyof S, ValueOrigin> {
  const out: Record<string, ValueOrigin> = {};
  for (const key of keys) out[key as string] = 'default';
  return out as Record<keyof S, ValueOrigin>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
