// Fabrikav2 U5 authoring bridge (P6, KTD-C, card comment 15 §8). Phaser Editor
// commits Text content only on the native "change" event (blur/Enter), so the
// canvas does not repaint per keystroke. This bridge forwards each "input" as an
// immediate "change" — routing the keystroke through the editor's own undo path —
// and collapses one typing burst into a single undo entry.
//
// NARROWED: the preview runs ONLY for a single selected semantic Text carrier
// whose role allows editable copy and whose binding is NOT a code-owned fact
// string (a runtime state read, a commerce offer, or a code-owned economy label).
// It FAILS CLOSED: if the selection or its semantic identity cannot be proven,
// no preview runs and the editor keeps its native commit-on-"change" behavior.
// It reads the carrier through the editor's own canonical serialization and never
// writes it, so the Semantic id/role/binding carrier fields are preserved. Those
// fields and other inspector strings also render as <textarea.formText> in
// Phaser Editor 5.0.2. The bridge therefore proves the native property-section
// title is exactly "Text Content" before it forwards a keystroke.
(() => {
  const COPY_CLASS = 'formText';
  const INPUT_EVENT = 'input';
  const COMMIT_EVENT = 'change';
  const BURST_WINDOW_MS = 700;
  const TEXT_CONTENT_TITLE = 'Text Content';

  // Semantic carrier keys, exactly as the .scene serialization emits them
  // (UserComponent writeJSON keys are `${componentName}.${propName}`).
  const TYPE_TEXT = 'Text';
  const ID_KEY = 'Semantic.fabSemanticId';
  const ROLE_KEY = 'Semantic.fabRole';
  const BINDING_KEY = 'Semantic.fabBinding';

  // Policy, mirrored verbatim from packages/kernel/contracts/shell-presentation.v2.json.
  // A focused test parses that contract and proves exact equality, so these sets
  // cannot silently drift from the kernel authority.
  //
  // Roles whose `editableProperties` include "copy" — the only roles whose visible
  // string is author-owned copy at all.
  const EDITABLE_COPY_ROLES = new Set([
    'bottom-left-test-action',
    'bottom-primary-action',
    'bottom-right-test-action',
    'bottom-secondary-action',
    'center-toggle-action',
    'currency-counter',
    'item-card',
    'level-label',
    'modal-panel',
    'result-panel',
    'screen-title',
  ]);
  // Bindings whose visible string is owned by code, never by the author:
  //  - every `read` binding (state.*) renders a live runtime value;
  //  - every `commerce.*` binding renders a store-owned offer;
  //  - flow.claim-double / flow.continue-coins are action labels that encode a
  //    code-owned economy quantity (the reward multiplier / the coin cost).
  const CODE_OWNED_BINDINGS = new Set([
    'state.level-label',
    'state.primary-currency',
    'state.progression',
    'state.reward-amount',
    'state.secondary-currency',
    'state.shop-items',
    'commerce.bundle',
    'commerce.restore',
    'flow.claim-double',
    'flow.continue-coins',
  ]);

  const syntheticCommits = new WeakSet();
  const activeBursts = new WeakMap();
  const probe = {
    forwardedInputs: 0,
    coalescedOperations: 0,
    startedBursts: 0,
    rejectedInputs: 0,
    lastRejection: null,
    editableCopyRoles: [...EDITABLE_COPY_ROLES].sort(),
    codeOwnedBindings: [...CODE_OWNED_BINDINGS].sort(),
    // Pure classifier over an already-resolved carrier — no editor access, so a
    // test or the GUI evidence run can assert the decision deterministically.
    decide: (carrier) => decideCopyPreview(carrier),
    // Live probe: resolve the current selection and report the decision, so a
    // real-Editor session can record whether the preview would run.
    probeSelection: () => {
      const carrier = selectedCarrier();
      return { carrier, ...decideCopyPreview(carrier) };
    },
  };

  const acceptsCopy = (node) => {
    const title = node?.closest?.('.PropertySectionPane')
      ?.querySelector?.(':scope > .PropertyTitleArea > .TitleLabel')
      ?.textContent?.trim?.();
    return node?.tagName === 'TEXTAREA'
      && node.classList?.contains(COPY_CLASS)
      && node.readOnly !== true
      && node.disabled !== true
      && title === TEXT_CONTENT_TITLE;
  };

  const activeEditor = () => globalThis.colibri?.Platform?.getWorkbench?.()?.getActiveEditor?.();

  // Resolve the single selected scene object's semantic identity through the
  // editor's OWN canonical serialization (writeJSON produces the exact .scene
  // shape, including the Semantic.* keys). Returns null on ANY ambiguity: no
  // active editor, no selection accessor, not exactly one object, or a target
  // that cannot be serialized. Read-only — it never mutates the object.
  const selectedCarrier = () => {
    const editor = activeEditor();
    // The scene editor's game-object-filtered accessor is preferred (it excludes
    // ObjectList / plain-object selections); getSelection is the resilient base.
    const selection = typeof editor?.getSelectedGameObjects === 'function'
      ? editor.getSelectedGameObjects()
      : editor?.getSelection?.();
    if (!Array.isArray(selection) || selection.length !== 1) return null;
    const support = selection[0]?.getEditorSupport?.();
    if (!support || typeof support.writeJSON !== 'function') return null;
    const data = {};
    try {
      support.writeJSON(data);
    } catch {
      return null;
    }
    return {
      type: data.type,
      semanticId: data[ID_KEY],
      role: data[ROLE_KEY],
      binding: data[BINDING_KEY],
    };
  };

  // Fail-closed decision: preview only a Text carrier with a proven semantic
  // identity whose role allows editable copy and whose binding is author-owned.
  const decideCopyPreview = (carrier) => {
    if (!carrier) return { allowed: false, reason: 'no-proven-selection' };
    if (carrier.type !== TYPE_TEXT) return { allowed: false, reason: 'not-text-carrier' };
    if (typeof carrier.semanticId !== 'string' || carrier.semanticId.length === 0) {
      return { allowed: false, reason: 'no-semantic-identity' };
    }
    if (typeof carrier.role !== 'string' || !EDITABLE_COPY_ROLES.has(carrier.role)) {
      return { allowed: false, reason: 'role-copy-not-editable' };
    }
    if (typeof carrier.binding !== 'string' || CODE_OWNED_BINDINGS.has(carrier.binding)) {
      return { allowed: false, reason: 'code-owned-fact' };
    }
    return { allowed: true, reason: 'editable-copy' };
  };

  const currentUndo = () => {
    const manager = activeEditor()?.getUndoManager?.();
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
      && anchorIndex === undo.operations.length - 2
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
    undo.operations.pop();
    burst.lastValue = field.value;
    if (isInput) burst.lastInputAt = timestamp;
    probe.coalescedOperations += 1;
  };

  const root = document.documentElement;
  root.addEventListener(INPUT_EVENT, (inputEvent) => {
    const field = inputEvent.target;
    if (!acceptsCopy(field)) return;

    // Prove the selected semantic carrier permits editable-copy preview. Any
    // failure — unproven selection, code-owned fact, non-copy role — falls
    // through to the editor's native commit-on-"change" (no live preview).
    const carrier = selectedCarrier();
    const decision = decideCopyPreview(carrier);
    if (!decision.allowed) {
      probe.rejectedInputs += 1;
      probe.lastRejection = { ...(carrier ?? {}), reason: decision.reason };
      return;
    }

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
  // value. Fold that no-op into the current burst as well. This only fires for
  // fields that started a burst — i.e. already-approved copy carriers — so the
  // narrowing gate above is preserved here without re-resolving the selection.
  root.addEventListener(COMMIT_EVENT, (commitEvent) => {
    const field = commitEvent.target;
    if (syntheticCommits.has(commitEvent) || !acceptsCopy(field)) return;
    const burst = activeBursts.get(field);
    if (!burst || burst.lastValue !== field.value) return;
    globalThis.queueMicrotask(() => {
      const undo = currentUndo();
      if (undo) foldOperation(field, undo, Date.now(), false);
    });
  }, true);

  Object.defineProperties(globalThis, {
    __liveCopyPreviewPluginLoaded: { value: true, configurable: true },
    __liveCopyPreviewPluginProbe: { value: probe, configurable: true },
  });
})();
