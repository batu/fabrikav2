import { describe, it, expect } from 'vitest';
import { parseShellPresentationV2 } from '@fabrikav2/kernel';
import { parseSceneDoc, type SceneDoc } from '../src/authoring/sceneModel.ts';
import { parseCatalog, toShellAssetCatalog, type Catalog } from '../src/authoring/catalog.ts';
import {
  buildCanonicalDocument,
  extractDocument,
  STATE_IDS,
} from '../src/authoring/extractV2.ts';
import { readJson } from './helpers.ts';

const CATALOG_PATH = ['games', 'shell_proof_phaser', 'authoring', 'catalog', 'catalog.json'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const scenePath = (state: string) => [
  'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes', `${cap(state)}.scene`,
];

const catalog = parseCatalog(readJson(...CATALOG_PATH)) as Catalog;
const shellCatalog = toShellAssetCatalog(catalog);

function loadScenes(): Map<(typeof STATE_IDS)[number], SceneDoc> {
  const byState = new Map<(typeof STATE_IDS)[number], SceneDoc>();
  for (const state of STATE_IDS) {
    byState.set(state, parseSceneDoc(readJson(...scenePath(state))));
  }
  return byState;
}

describe('P3 kernel-v2 extraction', () => {
  it('the canonical baseline document validates under the kernel parser', () => {
    expect(() => parseShellPresentationV2(buildCanonicalDocument(), { assetCatalog: shellCatalog })).not.toThrow();
  });

  it('the seven authored scenes extract to a kernel-valid document with zero issues', () => {
    const { document, issues } = extractDocument(loadScenes(), catalog);
    expect(issues).toEqual([]);
    expect(document.pages.length).toBe(7);
    expect(document.pages.map((p) => p.stateId)).toEqual([...STATE_IDS]);
    const total = document.pages.reduce((n, p) => n + p.instances.length, 0);
    expect(total).toBe(48);
    expect(() => parseShellPresentationV2(document, { assetCatalog: shellCatalog })).not.toThrow();
  });

  it('reflects an authored copy edit (Morning Shell) live in the extracted document', () => {
    const scenes = loadScenes();
    const menu = scenes.get('menu')!;
    const titleObj = menu.raw['displayList'] as Array<Record<string, unknown>>;
    const title = titleObj.find((o) => o['Semantic.fabSemanticId'] === 'menu.title')!;
    title['text'] = 'Morning Shell';
    const patched = parseSceneDoc(menu.raw);
    scenes.set('menu', patched);
    const { document } = extractDocument(scenes, catalog);
    const menuPage = document.pages.find((p) => p.stateId === 'menu')!;
    const instance = menuPage.instances.find((i) => i.id === 'menu.title')!;
    expect(instance.presentation.copy).toBe('Morning Shell');
    expect(() => parseShellPresentationV2(document, { assetCatalog: shellCatalog })).not.toThrow();
  });

  it('reflects a compatible asset swap (menu.settings → icon-control.confirm) preserving semantics', () => {
    const scenes = loadScenes();
    const menu = scenes.get('menu')!;
    const list = menu.raw['displayList'] as Array<Record<string, unknown>>;
    const settings = list.find((o) => o['Semantic.fabSemanticId'] === 'menu.settings')!;
    // Swap only the texture; the semantic identity (id/role/binding) is untouched.
    settings['texture'] = { key: 'icon_control_confirm' };
    const patched = parseSceneDoc(menu.raw);
    scenes.set('menu', patched);
    const { document } = extractDocument(scenes, catalog);
    const instance = document.pages.find((p) => p.stateId === 'menu')!.instances.find((i) => i.id === 'menu.settings')!;
    expect(instance.presentation.assetId).toBe('icon-control.confirm');
    // menu.settings semantics preserved.
    expect(instance.roleId).toBe('top-icon-action');
    expect(instance.bindingId).toBe('flow.open-settings');
    expect(instance.actionId).toBe('menu.settings');
  });

  it('keeps Pause and Settings as structurally distinct instance trees (R2)', () => {
    const { document } = extractDocument(loadScenes(), catalog);
    const pause = document.pages.find((p) => p.stateId === 'pause')!.instances.map((i) => i.id).sort();
    const settings = document.pages.find((p) => p.stateId === 'settings')!.instances.map((i) => i.id).sort();
    expect(pause).not.toEqual(settings);
    expect(pause.some((id) => id.startsWith('pause.'))).toBe(true);
    expect(settings.some((id) => id.startsWith('settings.'))).toBe(true);
  });

  it('represents the optional second-currency socket (R6) distinct from the primary counter', () => {
    const { document } = extractDocument(loadScenes(), catalog);
    const shop = document.pages.find((p) => p.stateId === 'shop')!.instances;
    const primary = shop.find((i) => i.id === 'shop.currency')!;
    const secondary = shop.find((i) => i.id === 'shop.currency.secondary')!;
    expect(primary.bindingId).toBe('state.primary-currency');
    expect(secondary.bindingId).toBe('state.secondary-currency');
  });

  it('represents Shop viewport/content semantics only (no scrolling-behavior state; U6 owns scrolling)', () => {
    const { document } = extractDocument(loadScenes(), catalog);
    const shop = document.pages.find((p) => p.stateId === 'shop')!.instances;
    expect(shop.some((i) => i.id === 'shop.grid')).toBe(true);
    expect(shop.some((i) => i.roleId === 'item-card')).toBe(true);
    // The presentation model carries no scrolling field for any instance.
    for (const i of shop) {
      expect(Object.keys(i.presentation)).not.toContain('scroll');
    }
  });

  it('reports an unknown-prototype carrier as an issue rather than dropping it silently', () => {
    const scenes = loadScenes();
    const menu = scenes.get('menu')!;
    const list = menu.raw['displayList'] as Array<Record<string, unknown>>;
    list.push({
      type: 'Text',
      id: 'rogue',
      label: 'rogue',
      components: ['Semantic'],
      'Semantic.fabSemanticId': 'menu.rogue-object',
      'Semantic.fabRole': 'screen-title',
      'Semantic.fabBinding': 'presentation.static',
      'Semantic.fabSlot': '',
      'Semantic.fabVariant': 'default',
      x: 100,
      y: 100,
    });
    scenes.set('menu', parseSceneDoc(menu.raw));
    const { issues } = extractDocument(scenes, catalog);
    expect(issues.some((i) => i.code === 'unknown-prototype')).toBe(true);
  });
});
