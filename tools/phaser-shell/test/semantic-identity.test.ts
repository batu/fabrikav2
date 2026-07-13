import { describe, it, expect } from 'vitest';
import { parseShellPresentationV2 } from '@fabrikav2/kernel';
import {
  parseSceneDoc,
  findDuplicateSemanticIds,
  type SceneDoc,
} from '../src/authoring/sceneModel.ts';
import { parseCatalog, toShellAssetCatalog, type Catalog } from '../src/authoring/catalog.ts';
import { extractDocument, STATE_IDS } from '../src/authoring/extractV2.ts';
import { readJson } from './helpers.ts';

const CATALOG_PATH = ['games', 'shell_proof_phaser', 'authoring', 'catalog', 'catalog.json'];
const SHOP_PATH = [
  'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes', 'Shop.scene',
];
const catalog = parseCatalog(readJson(...CATALOG_PATH)) as Catalog;
const shellCatalog = toShellAssetCatalog(catalog);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function loadScenes(shopRaw: unknown): Map<(typeof STATE_IDS)[number], SceneDoc> {
  const byState = new Map<(typeof STATE_IDS)[number], SceneDoc>();
  for (const state of STATE_IDS) {
    const raw =
      state === 'shop'
        ? shopRaw
        : readJson('games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes', `${cap(state)}.scene`);
    byState.set(state, parseSceneDoc(raw));
  }
  return byState;
}

/** Clone the shop.currency counter with a FRESH object UUID and a CLONED carrier id. */
function duplicateShopCurrency(): { raw: Record<string, unknown>; cloneUuid: string; sourceUuid: string } {
  const raw = readJson(...SHOP_PATH) as Record<string, unknown>;
  const list = raw['displayList'] as Array<Record<string, unknown>>;
  const source = list.find((o) => o['Semantic.fabSemanticId'] === 'shop.currency')!;
  const cloneUuid = 'shop.currency--dup-uuid';
  const clone = { ...source, id: cloneUuid, label: 'shop.currency (copy)' };
  list.push(clone);
  return { raw, cloneUuid, sourceUuid: source['id'] as string };
}

describe('P3 R8 duplicate → clone → block → retarget → stable identity', () => {
  it('a duplicated counter gets a fresh object UUID but a cloned fabSemanticId', () => {
    const { raw, cloneUuid, sourceUuid } = duplicateShopCurrency();
    expect(cloneUuid).not.toBe(sourceUuid);
    const doc = parseSceneDoc(raw);
    const duplicates = findDuplicateSemanticIds(doc);
    expect(duplicates).toContain('shop.currency');
  });

  it('the cloned duplicate (un-retargeted) is detectable as a duplicate id (P4 blocks it)', () => {
    const { raw } = duplicateShopCurrency();
    const doc = parseSceneDoc(raw);
    expect(findDuplicateSemanticIds(doc).length).toBeGreaterThan(0);
  });

  it('after retargeting to the second-currency socket the duplicate resolves to a stable new instance', () => {
    const { raw, cloneUuid } = duplicateShopCurrency();
    const list = raw['displayList'] as Array<Record<string, unknown>>;
    // The socket starts empty in the rehearsal: remove the pre-seeded secondary
    // so the duplicate-of-primary is the one that populates it.
    const pre = list.findIndex((o) => o['Semantic.fabSemanticId'] === 'shop.currency.secondary');
    if (pre >= 0) list.splice(pre, 1);
    const clone = list.find((o) => o['id'] === cloneUuid)!;
    // Retarget the clone onto the distinct second-currency prototype + binding.
    clone['Semantic.fabSemanticId'] = 'shop.currency.secondary';
    clone['Semantic.fabBinding'] = 'state.secondary-currency';
    const doc = parseSceneDoc(raw);
    expect(findDuplicateSemanticIds(doc)).toEqual([]);

    const scenes = loadScenes(raw);
    const { document, issues } = extractDocument(scenes, catalog);
    expect(issues).toEqual([]);
    const shop = document.pages.find((p) => p.stateId === 'shop')!.instances;
    const primary = shop.find((i) => i.id === 'shop.currency')!;
    const secondary = shop.find((i) => i.id === 'shop.currency.secondary')!;
    expect(primary.id).not.toBe(secondary.id);
    expect(secondary.parentInstanceId).toBe('shop.page');
    expect(() => parseShellPresentationV2(document, { assetCatalog: shellCatalog })).not.toThrow();
  });
});
