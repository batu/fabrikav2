export type Listener<T> = T extends undefined ? () => void : (data: T) => void;

type AnyListener = (...args: unknown[]) => void;

export interface TypedEventEmitter<EventMap extends Record<string, unknown>> {
  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void;
  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void;
  emit<K extends keyof EventMap>(
    event: K,
    ...args: EventMap[K] extends undefined ? [] : [EventMap[K]]
  ): void;
  removeAll(event?: keyof EventMap): void;
}

export function createTypedEventEmitter<EventMap extends Record<string, unknown>>(): TypedEventEmitter<EventMap> {
  const listeners = new Map<keyof EventMap, Set<AnyListener>>();

  return {
    on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
      let handlers = listeners.get(event);
      if (!handlers) {
        handlers = new Set<AnyListener>();
        listeners.set(event, handlers);
      }
      handlers.add(listener as AnyListener);
    },

    off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
      listeners.get(event)?.delete(listener as AnyListener);
    },

    emit<K extends keyof EventMap>(
      event: K,
      ...args: EventMap[K] extends undefined ? [] : [EventMap[K]]
    ): void {
      listeners.get(event)?.forEach((listener: AnyListener): void => {
        listener(...args);
      });
    },

    removeAll(event?: keyof EventMap): void {
      if (event !== undefined) {
        listeners.delete(event);
        return;
      }
      listeners.clear();
    },
  };
}
