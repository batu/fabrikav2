export type BindingTarget = Record<string, unknown>;
export type BindingMap = Record<string, unknown>;

interface PreviousBinding {
  existed: boolean;
  value: unknown;
}

export function assignWindowBindings<TTarget extends BindingTarget, TBindings extends BindingMap>(
  target: TTarget,
  bindings: TBindings,
): () => void {
  const previous = new Map<keyof TBindings, PreviousBinding>();

  for (const key of Object.keys(bindings) as Array<keyof TBindings>) {
    previous.set(key, {
      existed: Object.prototype.hasOwnProperty.call(target, key),
      value: target[key as keyof TTarget],
    });
    target[key as keyof TTarget] = bindings[key] as unknown as TTarget[keyof TTarget];
  }

  return (): void => {
    for (const [key, entry] of previous.entries()) {
      if (entry.existed) {
        target[key as keyof TTarget] = entry.value as TTarget[keyof TTarget];
      } else {
        delete target[key as keyof TTarget];
      }
    }
  };
}
