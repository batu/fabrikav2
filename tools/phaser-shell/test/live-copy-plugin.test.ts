import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { repoPath } from './helpers.ts';
import { scanPluginSource } from '../src/publish/safety.ts';

const pluginPath = repoPath(
  'games',
  'shell_proof_phaser',
  'authoring',
  'editor-plugins',
  'live-copy-preview',
  'live-copy-preview.js',
);
const allowlistPath = repoPath(
  'games',
  'shell_proof_phaser',
  'authoring',
  'editor-plugins',
  'allowlist.json',
);

class FakeClassList {
  hasFormText = true;
  contains(name: string): boolean {
    return name === 'formText' && this.hasFormText;
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

class FakeTextArea extends EventTarget {
  readonly tagName = 'TEXTAREA';
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

class FakeInput extends FakeTextArea {}

describe('live-copy-preview editor plugin', () => {
  it('previews each textarea input and coalesces the burst into one undo operation', () => {
    const source = readFileSync(pluginPath, 'utf8');
    const document = new FakeDocument();
    activeDocument = document;
    const undoList: Array<Record<string, unknown>> = [];
    const property = {};
    const manager = { _undoList: undoList };
    const editor = { getUndoManager: () => manager };
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
      HTMLTextAreaElement: FakeTextArea,
      HTMLInputElement: FakeInput,
      colibri: { Platform: { getWorkbench: () => workbench } },
    });
    vm.runInContext(source, context, { filename: pluginPath });

    const field = new FakeTextArea();
    let committed = '';
    field.addEventListener('change', () => {
      undoList.push({
        _property: property,
        _objIdList: ['copy-title'],
        _beforeValues: [committed],
        _afterValues: [field.value],
      });
      committed = field.value;
    });

    for (const value of ['M', 'Mo', 'Morning Shell']) {
      field.value = value;
      field.dispatchEvent(new Event('input'));
    }

    expect(committed).toBe('Morning Shell');
    expect(undoList).toHaveLength(1);
    expect(undoList[0]?._beforeValues).toEqual(['']);
    expect(undoList[0]?._afterValues).toEqual(['Morning Shell']);
    expect((context.__liveCopyPreviewPluginProbe as { forwardedInputs: number }).forwardedInputs).toBe(3);
    expect((context.__liveCopyPreviewPluginProbe as { coalescedOperations: number }).coalescedOperations).toBe(2);
    activeDocument = null;
  });

  it('is hash-allowlisted and contains no banned plugin API', () => {
    const source = readFileSync(pluginPath, 'utf8');
    const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8')) as {
      plugins: Array<{ id: string; sha256: string }>;
    };
    const digest = `sha256-${createHash('sha256').update(source).digest('hex')}`;
    expect(allowlist.plugins.find((entry) => entry.id === 'live-copy-preview')?.sha256).toBe(digest);
    expect(scanPluginSource(source)).toEqual([]);
  });
});
