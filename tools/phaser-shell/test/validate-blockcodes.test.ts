import { describe, it, expect } from 'vitest';
import { parseSceneDoc, type SceneDoc } from '../src/authoring/sceneModel.ts';
import { parseCatalog, type Catalog } from '../src/authoring/catalog.ts';
import { STATE_IDS } from '../src/authoring/extractV2.ts';
import { validateProject } from '../src/publish/validate.ts';
import {
  isNonRasterPackEntry,
  isUnsafeAssetPath,
  isRasterFile,
  scanPluginSource,
  isAllowlistedPlugin,
  isGuideObject,
  outcomeForBlock,
} from '../src/publish/safety.ts';
import { readJson } from './helpers.ts';

const CATALOG_PATH = ['games', 'shell_proof_phaser', 'authoring', 'catalog', 'catalog.json'];
const PACK_PATH = [
  'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public', 'assets', 'asset-pack.json',
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const scenePath = (state: string) => [
  'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes', `${cap(state)}.scene`,
];

type RawScene = Record<string, unknown>;
type DisplayList = Array<Record<string, unknown>>;

/** Fresh raw scenes + catalog + pack; mutators run against the raw before parse. */
function loadRaw(): { rawByState: Map<(typeof STATE_IDS)[number], RawScene>; catalog: Catalog; pack: unknown } {
  const rawByState = new Map<(typeof STATE_IDS)[number], RawScene>();
  for (const state of STATE_IDS) rawByState.set(state, readJson(...scenePath(state)) as RawScene);
  return { rawByState, catalog: parseCatalog(readJson(...CATALOG_PATH)) as Catalog, pack: readJson(...PACK_PATH) };
}

function build(rawByState: Map<(typeof STATE_IDS)[number], RawScene>, catalog: Catalog, pack: unknown) {
  const scenes = new Map<(typeof STATE_IDS)[number], SceneDoc>();
  for (const [state, raw] of rawByState) scenes.set(state, parseSceneDoc(raw));
  return validateProject({ scenes, catalog, editorPack: pack });
}

function menuList(raw: Map<(typeof STATE_IDS)[number], RawScene>): DisplayList {
  return raw.get('menu')!['displayList'] as DisplayList;
}
function find(list: DisplayList, id: string): Record<string, unknown> {
  return list.find((o) => o['Semantic.fabSemanticId'] === id)!;
}

describe('P4 typed validation gate (fail-closed, zero-write)', () => {
  it('the committed seven-scene project validates with zero blocks', () => {
    const { rawByState, catalog, pack } = loadRaw();
    expect(build(rawByState, catalog, pack).result).toBe('ok');
  });

  const fires = (mutate: (ctx: ReturnType<typeof loadRaw>) => void, code: string) => () => {
    const ctx = loadRaw();
    mutate(ctx);
    const result = build(ctx.rawByState, ctx.catalog, ctx.pack);
    expect(result.result).toBe('blocked');
    expect(result.blocks.map((b) => b.code)).toContain(code);
  };

  it('blocked-missing-semantic-id', fires((c) => { find(menuList(c.rawByState), 'menu.title')['Semantic.fabSemanticId'] = ''; }, 'blocked-missing-semantic-id'));

  it('blocked-duplicate-semantic-id', fires((c) => {
    const list = menuList(c.rawByState);
    const src = find(list, 'menu.title');
    list.push({ ...src, id: 'menu.title--dup' });
  }, 'blocked-duplicate-semantic-id'));

  it('blocked-invalid-binding', fires((c) => { find(menuList(c.rawByState), 'menu.play')['Semantic.fabBinding'] = 'not-a-binding'; }, 'blocked-invalid-binding'));

  it('blocked-unknown-texture', fires((c) => { find(menuList(c.rawByState), 'menu.settings')['texture'] = { key: 'totally_unknown_key' }; }, 'blocked-unknown-texture'));

  it('blocked-invalid-catalog-id', fires((c) => {
    // A pack key that exists in the pack but corresponds to no curated catalog id.
    const pack = c.pack as Record<string, { files: DisplayList }>;
    pack['shell-authoring'].files.push({ url: 'assets/rogue.png', type: 'image', key: 'rogue_key' });
    find(menuList(c.rawByState), 'menu.settings')['texture'] = { key: 'rogue_key' };
  }, 'blocked-invalid-catalog-id'));

  it('blocked-missing-required-action (hidden action)', fires((c) => { find(menuList(c.rawByState), 'menu.play')['visible'] = false; }, 'blocked-missing-required-action'));

  it('blocked-unsafe-geometry (action moved far outside)', fires((c) => {
    const play = find(menuList(c.rawByState), 'menu.play');
    play['x'] = -9000;
    play['y'] = -9000;
  }, 'blocked-unsafe-geometry'));

  it('blocked-active-content (script markup in a property)', fires((c) => { find(menuList(c.rawByState), 'menu.title')['text'] = '<script>alert(1)</script>'; }, 'blocked-active-content'));

  it('blocked-remote-content (http URL the kernel copy check would allow)', fires((c) => { find(menuList(c.rawByState), 'menu.title')['text'] = 'see https://evil.example.com'; }, 'blocked-remote-content'));

  it('blocked-unsafe-asset-path (pack url escapes the pack root)', fires((c) => {
    const pack = c.pack as Record<string, { files: DisplayList }>;
    pack['shell-authoring'].files.push({ url: '../../../etc/passwd', type: 'image', key: 'escape_key' });
  }, 'blocked-unsafe-asset-path'));

  it('blocked-guide-leak (safe-area guide carries a Semantic component)', fires((c) => {
    menuList(c.rawByState).push({
      type: 'Rectangle', id: 'guide-1', label: 'guide:safe-top', components: ['Semantic'],
      'Semantic.fabSemanticId': 'menu.title', 'Semantic.fabGuide': true, x: 0, y: 0,
    });
  }, 'blocked-guide-leak'));

  it('blocked-unsafe-string-encoding (control char in a carrier field)', fires((c) => { find(menuList(c.rawByState), 'menu.title')['Semantic.fabSlot'] = 'bad\u0001slot'; }, 'blocked-unsafe-string-encoding'));

  it('blocked-unrepresentable (carrier is not a known prototype)', fires((c) => { find(menuList(c.rawByState), 'menu.title')['Semantic.fabSemanticId'] = 'menu.ghost-object'; }, 'blocked-unrepresentable'));

  it('a blocked result is read-only: validateProject never mutates the input scenes', () => {
    const ctx = loadRaw();
    const before = JSON.stringify([...ctx.rawByState.get('menu')!['displayList'] as DisplayList]);
    find(menuList(ctx.rawByState), 'menu.play')['Semantic.fabBinding'] = 'not-a-binding';
    const snapshot = JSON.stringify([...ctx.rawByState.get('menu')!['displayList'] as DisplayList]);
    build(ctx.rawByState, ctx.catalog, ctx.pack);
    // validateProject did not further mutate beyond the test's own edit.
    expect(JSON.stringify([...ctx.rawByState.get('menu')!['displayList'] as DisplayList])).toBe(snapshot);
    expect(snapshot).not.toBe(before);
  });
});

describe('P4 safety guards', () => {
  it('classifies runtime raster vs non-raster pack entries', () => {
    expect(isRasterFile('assets/x.png')).toBe(true);
    expect(isRasterFile('fonts/x.ttf')).toBe(false);
    expect(isNonRasterPackEntry({ type: 'image', url: 'assets/x.png' })).toBe(false);
    expect(isNonRasterPackEntry({ type: 'bitmapFont', url: 'fonts/x.ttf' })).toBe(true);
    expect(isNonRasterPackEntry({ type: 'image', url: 'assets/x.ttf' })).toBe(true);
  });

  it('rejects escaping / absolute / backslash asset paths', () => {
    expect(isUnsafeAssetPath('assets/ok.png')).toBe(false);
    expect(isUnsafeAssetPath('../secret.png')).toBe(true);
    expect(isUnsafeAssetPath('/etc/passwd')).toBe(true);
    expect(isUnsafeAssetPath('C:\\win.png')).toBe(true);
    expect(isUnsafeAssetPath('a/../b.png')).toBe(true);
  });

  it('flags plugin sources that call banned network/storage/eval APIs', () => {
    expect(scanPluginSource('const x = 1;')).toEqual([]);
    expect(scanPluginSource('fetch("http://x")')).toContain('fetch');
    expect(scanPluginSource('localStorage.setItem("k","v")')).toContain('localStorage');
  });

  it('enforces the plugin id+hash allowlist', () => {
    const allow = [{ id: 'live-copy-preview', sha256: 'abc' }];
    expect(isAllowlistedPlugin('live-copy-preview', 'abc', allow)).toBe(true);
    expect(isAllowlistedPlugin('live-copy-preview', 'tampered', allow)).toBe(false);
    expect(isAllowlistedPlugin('rogue', 'abc', allow)).toBe(false);
  });

  it('detects editor-only guide objects', () => {
    expect(isGuideObject({ label: 'guide:top' })).toBe(true);
    expect(isGuideObject({ 'Semantic.fabGuide': true })).toBe(true);
    expect(isGuideObject({ label: 'menu.title' })).toBe(false);
  });

  it('maps block codes onto the shared typed outcome vocabulary', () => {
    expect(outcomeForBlock('blocked-unsafe-import')).toBe('blocked-drift');
    expect(outcomeForBlock('blocked-unrepresentable')).toBe('unsupported-intent');
    expect(outcomeForBlock('blocked-missing-semantic-id')).toBe('invalid-revision');
  });
});
