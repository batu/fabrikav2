import { useEffect, useState, useRef } from 'react';

/** Generic localStorage-backed form-state hook.
 *
 * - Reads + parses the key once on mount (ignoring shape errors → {}).
 * - Writes debounced 500ms after the last change so rapid state churn
 *   doesn't trigger a serialize per keystroke.
 * - Per-field fallback: useStickyValue(key, field, fallback, validate?)
 *   returns [value, setValue] where `value` is the stored value if it
 *   passes `validate`, else `fallback`. Invalid stored values don't
 *   strand the UI; they're silently replaced with the fallback.
 *
 * Deliberately not generic over the snapshot shape: each caller owns
 * its own key and schema.
 */

function readStore(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Per-key pending write debounce. Multiple useStickyValue hooks for the
// same key merge writes into a single persistence call.
const pending = new Map<string, { snapshot: Record<string, unknown>; timer: ReturnType<typeof setTimeout> }>();

function scheduleWrite(key: string, patch: Record<string, unknown>): void {
  const existing = pending.get(key);
  const snapshot = { ...(existing?.snapshot ?? readStore(key)), ...patch };
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    try {
      localStorage.setItem(key, JSON.stringify(snapshot));
    } catch {
      /* quota / private mode — in-memory state still works */
    }
    pending.delete(key);
  }, 500);
  pending.set(key, { snapshot, timer });
}

export function useStickyValue<T>(
  key: string,
  field: string,
  fallback: T,
  validate?: (v: unknown) => v is T,
): [T, (next: T) => void] {
  const initialRef = useRef<T | null>(null);
  if (initialRef.current === null) {
    const store = readStore(key);
    const stored = store[field];
    if (stored !== undefined && (!validate || validate(stored))) {
      initialRef.current = stored as T;
    } else {
      initialRef.current = fallback;
    }
  }
  const [value, setValue] = useState<T>(initialRef.current);

  useEffect(() => {
    scheduleWrite(key, { [field]: value });
  }, [key, field, value]);

  return [value, setValue];
}
