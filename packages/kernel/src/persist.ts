/**
 * Storage-guarded JSON persistence for game saves and settings.
 *
 * Both helpers tolerate hostile storage environments: localStorage can
 * throw at ACCESS time (private browsing, WebView storage disabled),
 * not just on parse — and a save-state singleton typically touches
 * storage during module evaluation, where an uncaught throw
 * black-screens the whole bundle before boot. Writes can also throw
 * (quota) mid-gameplay; a lost write must never abort a win path.
 *
 * (Incident: marble_run SaveState, fixed e7de862b5 — extracted here
 * after the fifth identical copy.)
 */

/**
 * Load and merge persisted JSON over `defaults()`. Returns defaults on
 * missing key, unreadable storage, parse failure, or `isValid` veto.
 * Merge is shallow: `{ ...defaults(), ...parsed }`.
 */
export function loadPersistedJson<T extends object>(
  key: string,
  defaults: () => T,
  isValid?: (parsed: Partial<T>) => boolean,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<T>;
    if (isValid && !isValid(parsed)) return defaults();
    return { ...defaults(), ...parsed };
  } catch {
    return defaults();
  }
}

/**
 * Persist `data` as JSON. Swallows storage errors (quota, blocked) —
 * the game keeps running with in-memory state.
 */
export function savePersistedJson(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Quota/blocked storage: keep playing with in-memory state.
  }
}
