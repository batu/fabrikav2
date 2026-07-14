import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { repoPath } from './helpers.ts';
import { scanPluginSource } from '../src/publish/safety.ts';

const pluginPath = repoPath(
  'games', 'shell_proof_phaser', 'authoring', 'editor-plugins', 'live-copy-preview', 'live-copy-preview.js',
);
const allowlistPath = repoPath(
  'games', 'shell_proof_phaser', 'authoring', 'editor-plugins', 'allowlist.json',
);
const contractPath = repoPath('packages', 'kernel', 'contracts', 'shell-presentation.v2.json');
const source = readFileSync(pluginPath, 'utf8');

/** A resolved semantic carrier as the plugin reads it from a selected object. */
interface Carrier {
  type?: string;
  semanticId?: string;
  role?: string;
  binding?: string;
}

interface Probe {
  forwardedInputs: number;
  coalescedOperations: number;
  startedBursts: number;
  rejectedInputs: number;
  lastRejection: (Carrier & { reason: string }) | null;
  editableCopyRoles: string[];
  codeOwnedBindings: string[];
  decide: (carrier: Carrier | null) => { allowed: boolean; reason: string };
  probeSelection: () => { carrier: Carrier | null; allowed: boolean; reason: string };
}

class FakeClassList {
  contains(name: string): boolean {
    return name === 'formText';
  }
}

type FakeListener = (event: Event) => void;

class FakeDocument {
  readonly documentElement = this;
  private readonly listeners = new Map<string, FakeListener[]>();
  addEventListener(type: string, listener: FakeListener): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(listener);
    this.listeners.set(type, handlers);
  }
  emit(event: Event): void {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

let activeDocument: FakeDocument | null = null;

/** A multi-line copy field — the editor renders the Text `text` property this way. */
class FakeTextArea extends EventTarget {
  readonly tagName = 'TEXTAREA';
  value = '';
  readOnly = false;
  disabled = false;
  classList = new FakeClassList();
  constructor(private readonly sectionTitle = 'Text Content') {
    super();
  }
  closest(selector: string): { querySelector: (selector: string) => { textContent: string } | null } | null {
    if (selector !== '.PropertySectionPane') return null;
    return {
      querySelector: (childSelector: string) => childSelector === ':scope > .PropertyTitleArea > .TitleLabel'
        ? { textContent: this.sectionTitle }
        : null,
    };
  }
  override dispatchEvent(event: Event): boolean {
    const result = super.dispatchEvent(event);
    activeDocument?.emit(event);
    return result;
  }
}

/** A single-line metadata field — the editor renders Semantic.* strings this way. */
class FakeInput extends EventTarget {
  readonly tagName = 'INPUT';
  value = '';
  readOnly = false;
  disabled = false;
  classList = new FakeClassList();
  override dispatchEvent(event: Event): boolean {
    const result = super.dispatchEvent(event);
    activeDocument?.emit(event);
    return result;
  }
}

/** A fake scene object that serializes to the exact `.scene` shape via writeJSON. */
function makeObject(carrier: Carrier): unknown {
  return {
    getEditorSupport: () => ({
      writeJSON: (data: Record<string, unknown>) => {
        if (carrier.type !== undefined) data.type = carrier.type;
        if (carrier.semanticId !== undefined) data['Semantic.fabSemanticId'] = carrier.semanticId;
        if (carrier.role !== undefined) data['Semantic.fabRole'] = carrier.role;
        if (carrier.binding !== undefined) data['Semantic.fabBinding'] = carrier.binding;
      },
    }),
  };
}

interface Booted {
  undoList: Array<Record<string, unknown>>;
  probe: Probe;
  document: FakeDocument;
}

/**
 * Run the plugin in a fresh VM whose active editor exposes the given selection.
 * `selection === undefined` means there is no active editor at all. The real
 * scene editor exposes `getSelectedGameObjects()`; `accessor: 'selection'`
 * exercises the resilient `getSelection()` fallback instead.
 */
function boot(selection: unknown[] | undefined, accessor: 'gameObjects' | 'selection' = 'gameObjects'): Booted {
  const document = new FakeDocument();
  activeDocument = document;
  const undoList: Array<Record<string, unknown>> = [];
  const manager = { _undoList: undoList };
  const editor = selection === undefined
    ? undefined
    : accessor === 'gameObjects'
      ? { getUndoManager: () => manager, getSelectedGameObjects: () => selection }
      : { getUndoManager: () => manager, getSelection: () => selection };
  const workbench = { getActiveEditor: () => editor };
  const context = vm.createContext({
    Event,
    EventTarget,
    WeakMap,
    WeakSet,
    Date,
    Array,
    queueMicrotask,
    document,
    colibri: { Platform: { getWorkbench: () => workbench } },
  });
  vm.runInContext(source, context, { filename: pluginPath });
  return { undoList, probe: context.__liveCopyPreviewPluginProbe as Probe, document };
}

/** Attach the editor's native commit handler: each `change` records one undo op. */
function attachCommit(field: FakeTextArea, undoList: Array<Record<string, unknown>>, semanticId: string): void {
  const property = {};
  let committed = '';
  field.addEventListener('change', () => {
    undoList.push({
      _property: property,
      _objIdList: [semanticId],
      _beforeValues: [committed],
      _afterValues: [field.value],
    });
    committed = field.value;
  });
}

function type(field: FakeTextArea, values: string[]): void {
  for (const value of values) {
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }
}

const carrierOf = (extra: Carrier): Carrier => ({ type: 'Text', ...extra });

describe('live-copy-preview editor plugin (narrowed)', () => {
  it('previews an editable-copy action carrier and coalesces the burst into one undo op', () => {
    const booted = boot([makeObject(carrierOf({
      semanticId: 'win.claim', role: 'bottom-primary-action', binding: 'flow.claim',
    }))]);
    const field = new FakeTextArea();
    attachCommit(field, booted.undoList, 'win.claim');

    type(field, ['M', 'Mo', 'Morning Shell']);

    expect(booted.undoList).toHaveLength(1);
    expect(booted.undoList[0]?._beforeValues).toEqual(['']);
    expect(booted.undoList[0]?._afterValues).toEqual(['Morning Shell']);
    expect(booted.probe.forwardedInputs).toBe(3);
    expect(booted.probe.coalescedOperations).toBe(2);
    expect(booted.probe.rejectedInputs).toBe(0);
    activeDocument = null;
  });

  it('previews an editable-copy title carrier (presentation.static)', () => {
    const booted = boot([makeObject(carrierOf({
      semanticId: 'win.panel', role: 'result-panel', binding: 'presentation.static',
    }))]);
    const field = new FakeTextArea();
    attachCommit(field, booted.undoList, 'win.panel');

    type(field, ['You Won!']);

    expect(booted.probe.forwardedInputs).toBe(1);
    expect(booted.probe.rejectedInputs).toBe(0);
    expect(booted.undoList).toHaveLength(1);
    expect(booted.undoList[0]?._afterValues).toEqual(['You Won!']);
    activeDocument = null;
  });

  // Every code-owned fact carrier in Win/Fail must be refused per keystroke.
  const lockedFacts: Array<[string, Carrier, string]> = [
    ['win.reward', { semanticId: 'win.reward', role: 'level-label', binding: 'state.reward-amount' }, 'code-owned-fact'],
    ['win.claim-double', { semanticId: 'win.claim-double', role: 'bottom-secondary-action', binding: 'flow.claim-double' }, 'code-owned-fact'],
    ['fail.continue-coins', { semanticId: 'fail.continue-coins', role: 'bottom-secondary-action', binding: 'flow.continue-coins' }, 'code-owned-fact'],
    ['fail.bundle', { semanticId: 'fail.bundle', role: 'bottom-secondary-action', binding: 'commerce.bundle' }, 'code-owned-fact'],
  ];
  for (const [id, carrier, reason] of lockedFacts) {
    it(`refuses the locked fact ${id} (never previews, zero undo ops)`, () => {
      const booted = boot([makeObject(carrierOf(carrier))]);
      const field = new FakeTextArea();
      attachCommit(field, booted.undoList, id);

      type(field, ['x', 'xy']);

      expect(booted.probe.forwardedInputs).toBe(0);
      expect(booted.probe.rejectedInputs).toBe(2);
      expect(booted.undoList).toHaveLength(0);
      expect(booted.probe.lastRejection?.reason).toBe(reason);
      activeDocument = null;
    });
  }

  it('refuses a Text carrier with no proven semantic identity', () => {
    const booted = boot([makeObject({ type: 'Text' })]);
    const field = new FakeTextArea();
    attachCommit(field, booted.undoList, 'bare');

    type(field, ['hi']);

    expect(booted.probe.forwardedInputs).toBe(0);
    expect(booted.probe.rejectedInputs).toBe(1);
    expect(booted.probe.lastRejection?.reason).toBe('no-semantic-identity');
    expect(booted.undoList).toHaveLength(0);
    activeDocument = null;
  });

  it('never touches a single-line metadata <input> (Semantic id/role/binding fields)', () => {
    // Even with an editable-copy carrier selected, a metadata INPUT is ignored:
    // the bridge only listens to the copy <textarea>.
    const booted = boot([makeObject(carrierOf({
      semanticId: 'win.claim', role: 'bottom-primary-action', binding: 'flow.claim',
    }))]);
    const metadataField = new FakeInput();
    let committed = false;
    metadataField.addEventListener('change', () => { committed = true; });

    metadataField.value = 'win.reward';
    metadataField.dispatchEvent(new Event('input'));

    expect(committed).toBe(false);
    expect(booted.probe.forwardedInputs).toBe(0);
    expect(booted.probe.rejectedInputs).toBe(0); // filtered before the semantic gate
    expect(booted.undoList).toHaveLength(0);
    activeDocument = null;
  });

  it('never previews non-Text Content textareas used by Description or Semantic fields', () => {
    for (const section of ['Object Description', 'Semantic Role']) {
      const booted = boot([makeObject(carrierOf({
        semanticId: 'win.claim', role: 'bottom-primary-action', binding: 'flow.claim',
      }))]);
      const field = new FakeTextArea(section);
      let committed = false;
      field.addEventListener('change', () => { committed = true; });

      field.value = 'must-not-preview';
      field.dispatchEvent(new Event('input'));

      expect(committed, section).toBe(false);
      expect(booted.probe.forwardedInputs, section).toBe(0);
      expect(booted.probe.rejectedInputs, section).toBe(0);
      expect(booted.undoList, section).toHaveLength(0);
      activeDocument = null;
    }
  });

  it('never erases an unrelated undo operation during a typing burst', () => {
    const booted = boot([makeObject(carrierOf({
      semanticId: 'win.claim', role: 'bottom-primary-action', binding: 'flow.claim',
    }))]);
    const field = new FakeTextArea();
    attachCommit(field, booted.undoList, 'win.claim');

    type(field, ['A']);
    const unrelated = { _property: {}, _objIdList: ['other'], _afterValues: ['kept'] };
    booted.undoList.push(unrelated);
    type(field, ['AB']);

    expect(booted.undoList).toContain(unrelated);
    expect(booted.undoList).toHaveLength(3);
    activeDocument = null;
  });

  it('fails closed when the selection is not exactly one object', () => {
    for (const selection of [[], [makeObject(carrierOf({ semanticId: 'a', role: 'result-panel', binding: 'presentation.static' })), makeObject(carrierOf({ semanticId: 'b', role: 'result-panel', binding: 'presentation.static' }))]]) {
      const booted = boot(selection);
      const field = new FakeTextArea();
      attachCommit(field, booted.undoList, 'ambiguous');
      type(field, ['z']);
      expect(booted.probe.forwardedInputs).toBe(0);
      expect(booted.probe.lastRejection?.reason).toBe('no-proven-selection');
      expect(booted.undoList).toHaveLength(0);
      activeDocument = null;
    }
  });

  it('fails closed when there is no active editor', () => {
    const booted = boot(undefined);
    const field = new FakeTextArea();
    attachCommit(field, booted.undoList, 'none');
    type(field, ['z']);
    expect(booted.probe.forwardedInputs).toBe(0);
    expect(booted.probe.lastRejection?.reason).toBe('no-proven-selection');
    expect(booted.undoList).toHaveLength(0);
    activeDocument = null;
  });

  it('previews via the getSelection() fallback when getSelectedGameObjects is absent', () => {
    const booted = boot([makeObject(carrierOf({
      semanticId: 'fail.retry', role: 'bottom-primary-action', binding: 'flow.retry',
    }))], 'selection');
    const field = new FakeTextArea();
    attachCommit(field, booted.undoList, 'fail.retry');

    type(field, ['Retry!']);

    expect(booted.probe.forwardedInputs).toBe(1);
    expect(booted.probe.rejectedInputs).toBe(0);
    expect(booted.undoList).toHaveLength(1);
    activeDocument = null;
  });

  it('embeds a policy exactly derived from the kernel v2 contract (no drift)', () => {
    const booted = boot([]);
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as {
      roles: Array<{ id: string; editableProperties: string[] }>;
      bindings: Array<{ id: string; kind: string }>;
    };
    const copyRoles = contract.roles
      .filter((role) => role.editableProperties.includes('copy'))
      .map((role) => role.id)
      .sort();
    const codeOwned = [...new Set([
      ...contract.bindings.filter((b) => b.kind === 'read').map((b) => b.id),
      ...contract.bindings.filter((b) => b.id.startsWith('commerce.')).map((b) => b.id),
      'flow.claim-double',
      'flow.continue-coins',
    ])].sort();

    expect(booted.probe.editableCopyRoles).toEqual(copyRoles);
    expect(booted.probe.codeOwnedBindings).toEqual(codeOwned);
    // The two explicit economy locks are real `action` bindings whose label
    // encodes a code-owned quantity (reward multiplier / coin cost).
    for (const id of ['flow.claim-double', 'flow.continue-coins']) {
      expect(contract.bindings.find((b) => b.id === id)?.kind).toBe('action');
    }
    activeDocument = null;
  });

  it('classifies the Win/Fail scene carriers: exactly the 4 locked facts are refused', () => {
    const booted = boot([]);
    const scenesDir = ['games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes'];
    const objects: Array<Record<string, unknown>> = [];
    for (const file of ['Win.scene', 'Fail.scene']) {
      const scene = JSON.parse(readFileSync(repoPath(...scenesDir, file), 'utf8')) as {
        displayList: Array<Record<string, unknown>>;
      };
      objects.push(...scene.displayList);
    }

    const carrierFrom = (object: Record<string, unknown>): Carrier => ({
      type: object.type as string,
      semanticId: object['Semantic.fabSemanticId'] as string,
      role: object['Semantic.fabRole'] as string,
      binding: object['Semantic.fabBinding'] as string,
    });
    const allowed: string[] = [];
    const refusedText: string[] = [];
    for (const object of objects) {
      if (!Array.isArray(object.components) || !object.components.includes('Semantic')) continue;
      const carrier = carrierFrom(object);
      const decision = booted.probe.decide(carrier);
      if (decision.allowed) allowed.push(carrier.semanticId as string);
      else if (carrier.type === 'Text') refusedText.push(carrier.semanticId as string);
    }

    expect(refusedText.sort()).toEqual([
      'fail.bundle', 'fail.continue-coins', 'win.claim-double', 'win.reward',
    ]);
    expect(allowed.sort()).toEqual([
      'fail.panel', 'fail.retry', 'win.claim', 'win.home', 'win.next', 'win.panel',
    ]);
    // fail.currency is an Image, not a copy carrier — irrelevant to copy preview.
    expect(booted.probe.decide(carrierFrom(
      objects.find((o) => o['Semantic.fabSemanticId'] === 'fail.currency')!,
    ))).toEqual({ allowed: false, reason: 'not-text-carrier' });
    activeDocument = null;
  });

  it('is hash-allowlisted and contains no banned plugin API', () => {
    const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8')) as {
      plugins: Array<{ id: string; sha256: string }>;
    };
    const digest = `sha256-${createHash('sha256').update(source).digest('hex')}`;
    expect(allowlist.plugins.find((entry) => entry.id === 'live-copy-preview')?.sha256).toBe(digest);
    expect(scanPluginSource(source)).toEqual([]);
  });
});
