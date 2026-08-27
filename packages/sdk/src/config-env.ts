/**
 * Shared env-value parsing helpers for `import.meta.env`-style config readers.
 * Extracted from the identical copies in AdjustConfig.ts and AppLovinConfig.ts.
 */

export function envString(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function requiredValue(
  value: string | null,
  diagnostic = 'Config value was read after missing-key validation.',
): string {
  if (value === null) {
    throw new Error(diagnostic);
  }
  return value;
}

export function parseBooleanEnv(value: string | boolean | undefined, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

/** Parse a closed provider/config choice without silently accepting typos. */
export function parseChoiceEnv<const Choice extends string>(
  value: string | boolean | undefined,
  choices: readonly Choice[],
  defaultValue: Choice,
): Choice {
  const normalized = envString(value)?.toLowerCase() ?? null;
  if (normalized === null) return defaultValue;
  const choice = choices.find((candidate) => candidate === normalized);
  if (choice === undefined) {
    throw new Error(`Invalid configuration choice "${normalized}"; expected one of: ${choices.join(', ')}`);
  }
  return choice;
}
