/**
 * In-memory localStorage for unit tests.
 *
 * The vitest environment does not supply one, so every suite that exercises
 * persistence installs this on globalThis (the convention established by
 * daily-streak-reward.test.ts). Shared here so the collection and sanctuary
 * suites do not each carry a copy.
 */
export class MemStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  get length(): number { return this.values.size; }
}

export function installMemStorage(): MemStorage {
  const storage = new MemStorage();
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = storage;
  return storage;
}

export function removeMemStorage(): void {
  Reflect.deleteProperty(globalThis as object, 'localStorage');
}
