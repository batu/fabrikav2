export type TuningValue = number | boolean;
export type TuningConfig = object;

export interface TuningStore<T extends TuningConfig> {
  readonly defaults: Readonly<T>;
  readonly current: T;
  get(): T;
  reset(): void;
  getChangedValues(): Partial<T>;
}

export function createTuningStore<T extends TuningConfig>(defaults: T): TuningStore<T> {
  const frozenDefaults: Readonly<T> = Object.freeze({ ...defaults });
  const current: T = { ...defaults };

  return {
    defaults: frozenDefaults,
    current,

    get(): T {
      return current;
    },

    reset(): void {
      Object.assign(current, frozenDefaults);
    },

    getChangedValues(): Partial<T> {
      const changed: Partial<T> = {};
      const keys = Object.keys(frozenDefaults) as Array<keyof T>;

      for (const key of keys) {
        if (current[key] !== frozenDefaults[key]) {
          changed[key] = current[key];
        }
      }

      return changed;
    },
  };
}
