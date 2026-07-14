import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { repoPath } from './helpers.ts';
import { scanPluginSource } from '../src/publish/safety.ts';

const pluginDir = ['games', 'shell_proof_phaser', 'authoring', 'editor-plugins', 'catalog-panel'];
const pluginPath = repoPath(...pluginDir, 'catalog-panel.js');
const descriptorPath = repoPath(...pluginDir, 'plugin.json');
const allowlistPath = repoPath('games', 'shell_proof_phaser', 'authoring', 'editor-plugins', 'allowlist.json');
const catalogPath = repoPath('games', 'shell_proof_phaser', 'authoring', 'catalog', 'catalog.json');
const source = readFileSync(pluginPath, 'utf8');

/** Minimal DOM node good enough to observe what the panel renders. */
class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes: Record<string, string> = {};
  readonly listeners: Record<string, Array<() => void>> = {};
  readonly style: Record<string, string> = {};
  className = '';
  id = '';
  type = '';
  private ownText = '';
  constructor(readonly tagName: string) {}
  set textContent(value: string) {
    this.ownText = value;
  }
  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  getAttribute(name: string): string | undefined {
    return this.attributes[name];
  }
  addEventListener(eventType: string, handler: () => void): void {
    (this.listeners[eventType] ??= []).push(handler);
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement('html');
  readonly body = new FakeElement('body');
  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
}

interface CatalogEntry {
  id: string;
  name: string;
  purpose: string;
  slotId: string;
  slotCompatibility: string[];
  dimensions: { width: number; height: number };
  alphaPolicy: string;
  provenance: { sourceId: string; sourcePath: string; license: string };
}

interface Probe {
  loaded: boolean;
  entryCount: number;
  entries: CatalogEntry[];
  panelId: string;
  toggleId: string;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  renderedIds: () => string[];
}

interface Booted {
  document: FakeDocument;
  probe: Probe;
  loaded: boolean;
}

function boot(): Booted {
  const document = new FakeDocument();
  const context = vm.createContext({ document });
  vm.runInContext(source, context, { filename: pluginPath });
  return {
    document,
    probe: context.__catalogPanelPluginProbe as Probe,
    loaded: context.__catalogPanelPluginLoaded as boolean,
  };
}

function find(root: FakeElement, predicate: (el: FakeElement) => boolean): FakeElement | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}

function collectIds(root: FakeElement, ids: string[] = []): string[] {
  const id = root.attributes['data-catalog-id'];
  if (id) ids.push(id);
  for (const child of root.children) collectIds(child, ids);
  return ids;
}

/** The exact R9 projection of the canonical catalog the panel is expected to mirror. */
function canonicalEntries(): CatalogEntry[] {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
    entries: Array<CatalogEntry & { [k: string]: unknown }>;
  };
  return catalog.entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    purpose: entry.purpose,
    slotId: entry.slotId,
    slotCompatibility: entry.slotCompatibility,
    dimensions: { width: entry.dimensions.width, height: entry.dimensions.height },
    alphaPolicy: entry.alphaPolicy,
    provenance: {
      sourceId: entry.provenance.sourceId,
      sourcePath: entry.provenance.sourcePath,
      license: entry.provenance.license,
    },
  }));
}

describe('catalog-panel editor plugin (R9)', () => {
  it('loads and surfaces every canonical catalog entry', () => {
    const booted = boot();
    const expected = canonicalEntries();
    expect(booted.loaded).toBe(true);
    expect(booted.probe.entryCount).toBe(expected.length);
    expect(expected.length).toBe(24);
    expect(booted.probe.renderedIds().sort()).toEqual(expected.map((e) => e.id).sort());
  });

  it('embeds a snapshot that EXACTLY equals canonical catalog.json (drift fails)', () => {
    const booted = boot();
    expect(booted.probe.entries).toEqual(canonicalEntries());
  });

  it('renders a card per entry showing all R9 fields (id/name/purpose/slots/dims/alpha/provenance)', () => {
    const booted = boot();
    const panel = find(booted.document.body, (el) => el.id === 'fab-catalog-panel');
    expect(panel).not.toBeNull();
    // One rendered card per catalog entry.
    expect(collectIds(panel!).sort()).toEqual(canonicalEntries().map((e) => e.id).sort());

    const text = panel!.textContent;
    for (const entry of canonicalEntries()) {
      expect(text).toContain(entry.id);
      expect(text).toContain(entry.name);
      expect(text).toContain(entry.purpose);
      expect(text).toContain(entry.slotId);
      for (const role of entry.slotCompatibility) expect(text).toContain(role);
      expect(text).toContain(`${entry.dimensions.width} × ${entry.dimensions.height}`);
      expect(text).toContain(entry.alphaPolicy);
      expect(text).toContain(entry.provenance.sourceId);
      expect(text).toContain(entry.provenance.sourcePath);
      expect(text).toContain(entry.provenance.license);
    }
  });

  it('is a discoverable, toggleable overlay that does not replace native panes', () => {
    const booted = boot();
    // A toggle control and the panel are APPENDED to the host — nothing replaced.
    const toggle = find(booted.document.body, (el) => el.id === 'fab-catalog-panel-toggle');
    const panel = find(booted.document.body, (el) => el.id === 'fab-catalog-panel');
    expect(toggle?.tagName).toBe('button');
    expect(panel?.tagName).toBe('aside');
    expect(booted.document.body.children).toContain(toggle);
    expect(booted.document.body.children).toContain(panel);
    const list = find(panel!, (el) => el.className === 'fab-catalog-list');
    expect(toggle?.style.position).toBe('fixed');
    expect(toggle?.style.zIndex).toBe('2147483647');
    expect(toggle?.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.style.position).toBe('fixed');
    expect(panel?.style.height).toContain('100vh');
    expect(panel?.style.overflow).toBe('hidden');
    expect(panel?.style.zIndex).toBe('2147483646');
    expect(list?.style.overflowY).toBe('auto');
    expect(list?.style.minHeight).toBe('0');

    // Starts collapsed; toggling opens and closes it.
    expect(booted.probe.isOpen()).toBe(false);
    expect(panel!.style.display).toBe('none');
    booted.probe.open();
    expect(booted.probe.isOpen()).toBe(true);
    expect(panel!.style.display).toBe('flex');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    booted.probe.toggle();
    expect(booted.probe.isOpen()).toBe(false);
  });

  it('is hash-allowlisted, descriptor-consistent, and references no banned API', () => {
    const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8')) as {
      plugins: Array<{ id: string; sha256: string }>;
    };
    const digest = `sha256-${createHash('sha256').update(source).digest('hex')}`;
    expect(allowlist.plugins.find((entry) => entry.id === 'catalog-panel')?.sha256).toBe(digest);
    expect(scanPluginSource(source)).toEqual([]);

    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as { id: string; scripts: string[] };
    expect(descriptor.id).toBe('catalog-panel');
    expect(descriptor.scripts).toEqual(['catalog-panel.js']);
  });
});
