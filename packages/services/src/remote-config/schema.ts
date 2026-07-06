/**
 * Game-agnostic remote-config schema + validation.
 *
 * v1 find_the_dog welded its remote config to Firebase and to a 60-key literal
 * `RemoteConfigValues` interface (`remoteConfigSchema.ts`, 354 lines) — every
 * game would have forked that file. This distils the reusable core: a game
 * DECLARES its flags as a schema of typed field definitions, and both the value
 * type and the runtime validation fall out of that one declaration. No Firebase
 * import, no game strings, no hand-maintained key-by-key mapper.
 *
 * A field is `boolean | number | string` (the three Firebase Remote Config
 * primitive types FTD used). Each definition carries its default — the
 * fallback the service returns whenever a remote value is absent, the wrong
 * type, or fails the field's optional domain `validate`. `remoteKey` is the
 * snake_case wire key (defaults to the camelCase declaration key).
 */

export type ConfigValueType = 'boolean' | 'number' | 'string';
export type ConfigPrimitive = boolean | number | string;

export interface ConfigFieldDefinition<T extends ConfigPrimitive = ConfigPrimitive> {
  readonly type: ConfigValueType;
  readonly default: T;
  /** Wire key the provider delivers this under. Defaults to the schema key. */
  readonly remoteKey?: string;
  readonly description?: string;
  /**
   * Extra domain check applied AFTER type coercion; failing → default.
   * Declared as a method (not a property arrow) so a `<number>` field stays
   * assignable to the `<ConfigPrimitive>` base under `strictFunctionTypes`.
   */
  validate?(value: T): boolean;
}

export type ConfigSchema = Record<string, ConfigFieldDefinition>;

/** The typed values object a schema resolves to. */
export type ConfigValues<S extends ConfigSchema> = {
  readonly [K in keyof S]: S[K]['default'];
};

// --- field constructors: narrow `default` so ConfigValues stays precise ------

export function booleanField(
  def: boolean,
  opts: Omit<ConfigFieldDefinition<boolean>, 'type' | 'default'> = {},
): ConfigFieldDefinition<boolean> {
  return { type: 'boolean', default: def, ...opts };
}

export function numberField(
  def: number,
  opts: Omit<ConfigFieldDefinition<number>, 'type' | 'default'> = {},
): ConfigFieldDefinition<number> {
  return { type: 'number', default: def, ...opts };
}

export function stringField(
  def: string,
  opts: Omit<ConfigFieldDefinition<string>, 'type' | 'default'> = {},
): ConfigFieldDefinition<string> {
  return { type: 'string', default: def, ...opts };
}

export function remoteKeyFor(key: string, definition: ConfigFieldDefinition): string {
  return definition.remoteKey ?? key;
}

export interface CoerceOk {
  readonly ok: true;
  readonly value: ConfigPrimitive;
}
export interface CoerceErr {
  readonly ok: false;
  readonly reason: 'absent' | 'wrong_type' | 'failed_validate';
}
export type CoerceResult = CoerceOk | CoerceErr;

/**
 * Coerce + validate a single raw remote value against a field definition.
 * Accepts the native primitive OR its string form (remote-config backends like
 * Firebase deliver everything as strings), so a game can wire any provider
 * without a per-provider adapter. Anything ambiguous falls to the default via
 * a typed reason, never a throw.
 */
export function coerceConfigValue(definition: ConfigFieldDefinition, raw: unknown): CoerceResult {
  if (raw === undefined || raw === null) return { ok: false, reason: 'absent' };

  if (definition.type === 'boolean') {
    const value = coerceBoolean(raw);
    if (value === null) return { ok: false, reason: 'wrong_type' };
    return validated(definition, value);
  }
  if (definition.type === 'number') {
    const value = coerceNumber(raw);
    if (value === null) return { ok: false, reason: 'wrong_type' };
    return validated(definition, value);
  }
  const value = coerceString(raw);
  if (value === null) return { ok: false, reason: 'wrong_type' };
  return validated(definition, value);
}

function validated(definition: ConfigFieldDefinition, value: ConfigPrimitive): CoerceResult {
  const check = definition.validate as ((value: ConfigPrimitive) => boolean) | undefined;
  if (check !== undefined && !check(value)) return { ok: false, reason: 'failed_validate' };
  return { ok: true, value };
}

function coerceBoolean(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const lowered = raw.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return null;
}

function coerceNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceString(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  return null;
}

/** Build the all-defaults values object from a schema. */
export function defaultValues<S extends ConfigSchema>(schema: S): ConfigValues<S> {
  const out: Record<string, ConfigPrimitive> = {};
  for (const key of Object.keys(schema)) {
    out[key] = schema[key].default;
  }
  return out as ConfigValues<S>;
}
