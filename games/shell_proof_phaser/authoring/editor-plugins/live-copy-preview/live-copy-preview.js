// Fabrikav2 U5 authoring bridge. Phaser Editor commits Text content on change;
// this bridge previews textarea copy immediately and collapses the operations
// produced by one typing burst into a single undo entry. Other inspector strings
// keep the editor's native behavior.
(() => {
  const COPY_CLASS = 'formText';
  const INPUT_EVENT = 'input';
  const COMMIT_EVENT = 'change';
  const BURST_WINDOW_MS = 700;
  const syntheticCommits = new WeakSet();
  const activeBursts = new WeakMap();
  const probe = { forwardedInputs: 0, coalescedOperations: 0, startedBursts: 0 };

  const acceptsCopy = (node) => node?.tagName === 'TEXTAREA'
    && node.classList?.contains(COPY_CLASS)
    && node.readOnly !== true
    && node.disabled !== true;

  const currentUndo = () => {
    const bench = globalThis.colibri?.Platform?.getWorkbench?.();
    const manager = bench?.getActiveEditor?.()?.getUndoManager?.();
    const operations = manager ? Reflect.get(manager, '_undoList') : null;
    return Array.isArray(operations) ? { manager, operations } : null;
  };

  const sameTarget = (left, right) => {
    if (!left || !right || left.constructor !== right.constructor) return false;
    if (Reflect.get(left, '_property') !== Reflect.get(right, '_property')) return false;
    const leftIds = Reflect.get(left, '_objIdList');
    const rightIds = Reflect.get(right, '_objIdList');
    return Array.isArray(leftIds)
      && Array.isArray(rightIds)
      && leftIds.length === rightIds.length
      && leftIds.every((id, index) => id === rightIds[index]);
  };

  const remember = (field, undo, operation, timestamp) => {
    activeBursts.set(field, {
      manager: undo.manager,
      anchor: operation,
      lastInputAt: timestamp,
      lastValue: field.value,
    });
    probe.startedBursts += 1;
  };

  const foldOperation = (field, undo, timestamp, isInput) => {
    const newest = undo.operations.at(-1);
    if (!newest) return;

    const burst = activeBursts.get(field);
    const anchorIndex = burst ? undo.operations.indexOf(burst.anchor) : -1;
    const canFold = burst
      && burst.manager === undo.manager
      && anchorIndex >= 0
      && sameTarget(burst.anchor, newest);
    const outsideWindow = !burst || timestamp - burst.lastInputAt > BURST_WINDOW_MS;

    if (isInput && (outsideWindow || !canFold)) {
      remember(field, undo, newest, timestamp);
      return;
    }
    if (!canFold || newest === burst.anchor) return;

    const newestValues = Reflect.get(newest, '_afterValues');
    Reflect.set(
      burst.anchor,
      '_afterValues',
      Array.isArray(newestValues) ? [...newestValues] : newestValues,
    );
    if (newest.updateCallback) burst.anchor.updateCallback = newest.updateCallback;
    undo.operations.splice(anchorIndex + 1);
    burst.lastValue = field.value;
    if (isInput) burst.lastInputAt = timestamp;
    probe.coalescedOperations += 1;
  };

  const root = document.documentElement;
  root.addEventListener(INPUT_EVENT, (inputEvent) => {
    const field = inputEvent.target;
    if (!acceptsCopy(field)) return;

    const before = currentUndo();
    const previousLength = before?.operations.length ?? -1;
    const commitEvent = new globalThis.Event(COMMIT_EVENT, { bubbles: false });
    syntheticCommits.add(commitEvent);
    field.dispatchEvent(commitEvent);
    const after = currentUndo();
    probe.forwardedInputs += 1;

    if (before && after && before.manager === after.manager
      && after.operations.length > previousLength) {
      foldOperation(field, after, Date.now(), true);
    }
  });

  // Blur or Enter can emit a final native commit for the already-previewed
  // value. Fold that no-op into the current burst as well.
  root.addEventListener(COMMIT_EVENT, (commitEvent) => {
    const field = commitEvent.target;
    if (syntheticCommits.has(commitEvent) || !acceptsCopy(field)) return;
    const burst = activeBursts.get(field);
    if (!burst || burst.lastValue !== field.value) return;
    queueMicrotask(() => {
      const undo = currentUndo();
      if (undo) foldOperation(field, undo, Date.now(), false);
    });
  }, true);

  Object.defineProperties(globalThis, {
    __liveCopyPreviewPluginLoaded: { value: true, configurable: true },
    __liveCopyPreviewPluginProbe: { value: probe, configurable: true },
  });
})();
