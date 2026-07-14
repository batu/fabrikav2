import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { shellPresentationContractV2 } from '@fabrikav2/kernel';
import { REPO_ROOT, repoPath } from './helpers.ts';
import { parseSceneDoc } from '../src/authoring/sceneModel.ts';
import { SCENE_FILES } from '../src/session/graph.ts';
import {
  VISUAL_SEED,
  VISUAL_SEED_SCHEMA,
  SEED_SCENE_ORDER,
  RESULT_COPY,
  SHOP_COPY,
  SAMPLE_COPY,
  FAIL_BALANCE_COPY,
  allCompanions,
  allSemanticCopyEdits,
  allSemanticStyleEdits,
  allSemanticGeometryEdits,
  assertSeedInvariants,
  companionObjData,
  planForScene,
  runVisualSeed,
  sceneSeedFactsFromJSON,
  type Companion,
  type SceneVisualPlan,
} from '../src/session/visualSeed.ts';

interface SceneObject {
  id?: string;
  components?: unknown;
  visible?: unknown;
  [key: string]: unknown;
}

function loadScene(scene: string): { displayList: SceneObject[] } {
  return JSON.parse(
    readFileSync(repoPath('games/shell_proof_phaser/authoring/phaser-editor/src/scenes', scene), 'utf8'),
  ) as { displayList: SceneObject[] };
}

function isSemantic(object: SceneObject): boolean {
  const components = Array.isArray(object.components) ? object.components : [];
  return components.includes('Semantic')
    || Object.keys(object).some((key) => key === 'Semantic' || key.startsWith('Semantic.'));
}

/** The union of the 48 semantic carrier ids across the seven canonical scenes. */
function canonicalSemanticIds(): Set<string> {
  const ids = new Set<string>();
  for (const scene of SCENE_FILES) {
    for (const object of loadScene(scene).displayList) {
      if (isSemantic(object) && typeof object.id === 'string') ids.add(object.id);
    }
  }
  return ids;
}

describe('session/visualSeed — deterministic companion recipe', () => {
  it('covers the seven canonical scenes in open order', () => {
    expect(VISUAL_SEED.map((plan) => plan.scene)).toEqual([...SCENE_FILES]);
    expect(SEED_SCENE_ORDER).toEqual(SCENE_FILES);
    for (const scene of SCENE_FILES) expect(planForScene(scene)).toBeDefined();
  });

  it('gives every companion a unique, scene-namespaced, non-colliding id', () => {
    const semanticIds = canonicalSemanticIds();
    expect(semanticIds.size).toBe(48);

    const ids = allCompanions().map((companion) => companion.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    for (const companion of allCompanions()) {
      const prefix = `${companion.name.split('.fab.')[0]}.fab.`;
      expect(companion.id.startsWith(prefix)).toBe(true);
      expect(companion.id).toBe(companion.name);
      expect(semanticIds.has(companion.id)).toBe(false); // never collides with a carrier
    }
    // The declared invariant checker agrees with the real 48 carriers.
    expect(() => assertSeedInvariants(semanticIds)).not.toThrow();
  });

  it('accounts for every persisted fab companion so old recipe objects cannot linger visibly', () => {
    const expected = new Set(allCompanions().map((companion) => companion.id));
    for (const scene of SCENE_FILES) {
      for (const object of loadScene(scene).displayList) {
        if (typeof object.id !== 'string' || !object.id.includes('.fab.')) continue;
        expect(expected.has(object.id), `${scene}:${object.id}`).toBe(true);
      }
    }
  });

  it('rejects a companion id that collides with a semantic carrier', () => {
    const withCollision = new Set(canonicalSemanticIds());
    withCollision.add('menu.fab.backdrop'); // pretend a carrier owned a companion id
    expect(() => assertSeedInvariants(withCollision)).toThrow(/collides with a semantic id/);
  });

  it('never emits a Semantic component on any companion object data', () => {
    for (const companion of allCompanions()) {
      const data = companionObjData(companion);
      expect('components' in data).toBe(false);
      expect(Object.keys(data).some((key) => key === 'Semantic' || key.startsWith('Semantic.'))).toBe(false);
      expect(data.id).toBe(companion.id);
      expect(data.label).toBe(companion.name);
    }
  });

  it('maps each companion kind to a valid Editor 5.0.2 object shape', () => {
    const byKind = (kind: Companion['kind']): Companion =>
      allCompanions().find((companion) => companion.kind === kind)!;

    const rectData = companionObjData(byKind('rect'));
    expect(rectData.type).toBe('Rectangle');
    expect(rectData.isFilled).toBe(true);
    expect(typeof rectData.fillColor).toBe('string');
    expect(typeof rectData.width).toBe('number');
    expect(typeof rectData.height).toBe('number');

    const imageData = companionObjData(byKind('image'));
    expect(imageData.type).toBe('Image');
    expect(imageData.texture).toMatchObject({ key: expect.any(String) });

    const retiredRaster = companionObjData(
      allCompanions().find((companion) => companion.id === 'menu.fab.play-surface')!,
    );
    expect(retiredRaster.visible).toBe(false);

    const textData = companionObjData(allCompanions().find((companion) => companion.id === 'fail.fab.balance')!);
    expect(textData.type).toBe('Text');
    expect(textData.text).toBe(FAIL_BALANCE_COPY);
    expect(textData.fontFamily).toBe('kenney_future_narrow');
  });

  it('uses only the two retained Kenney families for authored player text', () => {
    const allowed = new Set(['kenney_future', 'kenney_future_narrow']);
    for (const companion of allCompanions()) {
      if (companion.kind === 'text') expect(allowed.has(companion.fontFamily), companion.id).toBe(true);
    }
    for (const edit of allSemanticStyleEdits()) {
      if (edit.property === 'fontFamily') expect(allowed.has(edit.value), edit.semanticId).toBe(true);
    }
  });

  it('composes each screen with real raster button surfaces and cards', () => {
    // Every plan carries at least a background/card rect; menu/level/pause/win/fail
    // put a real button-surface raster behind their primary action.
    for (const plan of VISUAL_SEED) {
      expect(plan.companions.some((companion) => companion.kind === 'rect')).toBe(true);
    }
    const surfaceKeys = allCompanions()
      .filter((companion): companion is Extract<Companion, { kind: 'image' }> => companion.kind === 'image')
      .map((companion) => companion.textureKey);
    expect(surfaceKeys).toContain('button_surface_primary');
    expect(surfaceKeys).toContain('button_surface_secondary');
    expect(surfaceKeys).toContain('button_surface_test_win');
    expect(surfaceKeys).toContain('button_surface_test_lose');
    expect(surfaceKeys).toContain('icon_control_surface');

    // Settings gets three distinct green toggle switches.
    const settings = planForScene('Settings.scene')!;
    const greenTracks = settings.companions.filter(
      (companion) => companion.kind === 'rect' && companion.id.includes('toggle') && companion.id.endsWith('-track'),
    );
    expect(greenTracks).toHaveLength(3);
    for (const track of greenTracks) {
      expect((track as Extract<Companion, { kind: 'rect' }>).fillColor).toBe('#14724f');
    }
  });

  it('keeps visible companion copy readable and strips internal proof terminology', () => {
    expect(SAMPLE_COPY['menu.title']).not.toMatch(/shell|proof|phaser/i);
    for (const companion of allCompanions()) {
      if (companion.kind !== 'text' || companion.text.length === 0) continue;
      expect(Number.parseFloat(companion.fontSize), companion.id).toBeGreaterThanOrEqual(14);
    }
  });

  it('uses accessible controls without changing action geometry', () => {
    const level = planForScene('Level.scene')!;
    expect(level.companions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'level.fab.marker-goal', fillColor: '#1f765d' }),
      expect.objectContaining({ id: 'level.fab.test-win-control', width: 160, height: 56, fillColor: '#14724f' }),
      expect.objectContaining({ id: 'level.fab.test-lose-control', width: 160, height: 56, fillColor: '#a94f46' }),
    ]));
  });

  it('retires every player-visible surface of the third Shop card', () => {
    const shop = planForScene('Shop.scene')!;
    const retiredIds = [
      'shop.fab.item-locked-shadow',
      'shop.fab.item-locked-card',
      'shop.fab.item-locked-trophy',
      'shop.fab.item-locked-icon-surface',
      'shop.fab.item-locked-trophy-icon',
      'shop.fab.item-locked-detail',
      'shop.fab.item-locked-status-surface',
      'shop.fab.item-locked-status',
    ];
    const retired = shop.companions.filter((entry) => retiredIds.includes(entry.id));
    expect(retired.map((entry) => entry.id)).toEqual(retiredIds);
    for (const companion of retired) {
      expect(companion.x, companion.id).toBe(1);
      expect(companion.y, companion.id).toBe(1);
      if (companion.kind === 'rect') {
        expect(companion.fillAlpha, companion.id).toBe(0);
        if (companion.id.endsWith('-card') || companion.id.endsWith('-status-surface')) {
          expect(companion.strokeAlpha, companion.id).toBe(0);
        }
      }
      if (companion.kind === 'image') expect(companion.visible, companion.id).toBe(false);
      if (companion.kind === 'text') expect(companion.text, companion.id).toBe(' ');
    }
    expect(shop.semanticCopy).toContainEqual(
      { semanticId: 'shop.item.locked', property: 'text', value: ' ' },
    );
    expect(shop.semanticGeometry).toEqual(expect.arrayContaining([
      { semanticId: 'shop.item.locked', property: 'x', value: 195 },
      { semanticId: 'shop.item.locked', property: 'y', value: 526 },
      { semanticId: 'shop.item.locked', property: 'scaleX', value: 0.01 },
      { semanticId: 'shop.item.locked', property: 'scaleY', value: 0.01 },
    ]));
  });

  it('keeps result actions above the mobile safe area and preserves tertiary hierarchy', () => {
    const fail = planForScene('Fail.scene')!;
    const rectById = (id: string): Extract<Companion, { kind: 'rect' }> =>
      fail.companions.find((entry): entry is Extract<Companion, { kind: 'rect' }> =>
        entry.kind === 'rect' && entry.id === id)!;
    const retry = rectById('fail.fab.retry-control');
    const bundle = rectById('fail.fab.bundle-control');
    const retryBottom = retry.y + retry.height * (1 - retry.originY);
    const bundleTop = bundle.y - bundle.height * bundle.originY;
    const bundleBottom = bundle.y + bundle.height * (1 - bundle.originY);

    expect(bundleBottom).toBeLessThanOrEqual(810); // 34 px home-indicator reserve
    expect(bundleTop - retryBottom).toBeGreaterThanOrEqual(24);
    expect(bundle.width).toBeLessThan(retry.width);
  });

  it('centres secondary compositions and keeps menu art inside its card', () => {
    const menu = planForScene('Menu.scene')!;
    const nearHill = menu.companions.find((entry) => entry.id === 'menu.fab.hero-hill-near');
    expect(nearHill).toMatchObject({ kind: 'rect', x: 310, y: 362, width: 86, height: 54 });
    if (nearHill?.kind !== 'rect') throw new Error('menu near hill must be a rect');
    expect(370 - (nearHill.x + nearHill.width / 2)).toBeGreaterThanOrEqual(16);
    expect(405 - (nearHill.y + nearHill.height / 2)).toBeGreaterThanOrEqual(16);

    const shop = planForScene('Shop.scene')!;
    expect(shop.companions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'shop.fab.item-locked-card', x: 1, y: 1, fillAlpha: 0 }),
      expect.objectContaining({ id: 'shop.fab.item-owned-detail', text: ' ' }),
    ]));
    expect(shop.semanticGeometry).toContainEqual(
      { semanticId: 'shop.item.locked', property: 'x', value: 195 },
    );

    const win = planForScene('Win.scene')!;
    expect(win.companions).toContainEqual(
      expect.objectContaining({ id: 'win.fab.result-medal', x: 195, y: 260 }),
    );
  });
});

describe('session/visualSeed — exact composed copy + carrier preservation', () => {
  it('writes the exact win/fail result copy through semantic edits only', () => {
    expect(RESULT_COPY).toEqual({
      'win.reward': '5 Coins earned',
      'win.claim-double': 'Watch ad · Double Coins',
      'fail.continue-coins': 'Continue · 10 Coins',
      'fail.bundle': 'Rescue bundle · $4.99\nContinue this level',
    });
    expect(FAIL_BALANCE_COPY).toBe('25 Coins');

    const edits = allSemanticCopyEdits();
    expect(edits).toHaveLength(14);
    const bySemanticId = Object.fromEntries(edits.map((edit) => [edit.semanticId, edit.value]));
    expect(bySemanticId).toEqual({ ...SAMPLE_COPY, ...SHOP_COPY, ...RESULT_COPY });

    // Every semantic copy edit targets a real carrier.
    const semanticIds = canonicalSemanticIds();
    for (const edit of edits) expect(semanticIds.has(edit.semanticId)).toBe(true);
    for (const edit of [...allSemanticStyleEdits(), ...allSemanticGeometryEdits()]) {
      expect(semanticIds.has(edit.semanticId)).toBe(true);
    }
  });

  it('carries the companion fail-balance text as a non-semantic companion', () => {
    const fail = planForScene('Fail.scene')!;
    const balance = fail.companions.find((companion) => companion.id === 'fail.fab.balance');
    expect(balance?.kind).toBe('text');
    expect((balance as Extract<Companion, { kind: 'text' }>).text).toBe('25 Coins');
    // It is a companion, never a carrier — no semantic copy edit points at it.
    expect(fail.semanticCopy.some((edit) => edit.semanticId === 'fail.fab.balance')).toBe(false);
  });

  it('never touches the hidden win next/home carriers', () => {
    const win = loadScene('Win.scene');
    const next = win.displayList.find((object) => object.id === 'win.next');
    const home = win.displayList.find((object) => object.id === 'win.home');
    expect(next?.visible).toBe(false);
    expect(home?.visible).toBe(false);

    const winPlan = planForScene('Win.scene')!;
    const touched = [
      ...winPlan.semanticCopy,
      ...winPlan.semanticStyle,
      ...winPlan.semanticGeometry,
    ].map((edit) => edit.semanticId);
    expect(touched).not.toContain('win.next');
    expect(touched).not.toContain('win.home');
  });

  it('moves Shop, Play, and Settings into a real three-control bottom dock', () => {
    const menu = planForScene('Menu.scene')!;
    expect(menu.semanticGeometry).toEqual(expect.arrayContaining([
      { semanticId: 'menu.shop', property: 'x', value: 83 },
      { semanticId: 'menu.shop', property: 'y', value: 738 },
      { semanticId: 'menu.play', property: 'y', value: 786 },
      { semanticId: 'menu.play', property: 'originY', value: 1 },
      { semanticId: 'menu.settings', property: 'x', value: 347 },
      { semanticId: 'menu.settings', property: 'y', value: 738 },
    ]));
    expect(menu.companions.some((entry) => entry.id === 'menu.fab.shop-label')).toBe(true);
    expect(menu.companions.some((entry) => entry.id === 'menu.fab.settings-label')).toBe(true);
    expect(menu.companions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'menu.fab.balance', x: 108, text: '25 Coins' }),
      expect.objectContaining({ id: 'menu.fab.hero-title', text: 'Find the next step' }),
      expect.objectContaining({ id: 'menu.fab.play-control', width: 154, height: 94 }),
    ]));
    expect(menu.semanticGeometry).toEqual(expect.arrayContaining([
      { semanticId: 'menu.currency', property: 'scaleX', value: 0.36 },
      { semanticId: 'menu.currency', property: 'scaleY', value: 0.36 },
    ]));
  });

  it('keeps every seeded semantic origin aligned with its contract anchor', () => {
    const anchors = new Map(shellPresentationContractV2.anchors.map((anchor) => [anchor.id, anchor]));
    const roles = new Map(shellPresentationContractV2.roles.map((role) => [role.id, role]));

    for (const plan of VISUAL_SEED) {
      const scene = parseSceneDoc(loadScene(plan.scene));
      const geometry = new Map(
        plan.semanticGeometry.map((edit) => [`${edit.semanticId}:${edit.property}`, edit.value]),
      );
      for (const object of scene.objects) {
        if (object.type === 'Container') continue;
        const role = roles.get(object.carrier.fabRole);
        const anchor = role ? anchors.get(role.anchor) : undefined;
        const originX = geometry.get(`${object.carrier.fabSemanticId}:originX`)
          ?? object.geometry.originX;
        const originY = geometry.get(`${object.carrier.fabSemanticId}:originY`)
          ?? object.geometry.originY;
        expect(anchor, object.carrier.fabSemanticId).toBeDefined();
        expect(originX, object.carrier.fabSemanticId).toBe(anchor!.x);
        expect(originY, object.carrier.fabSemanticId).toBe(anchor!.y);
      }
    }
  });
});

describe('session/visualSeed — saved-scene readback facts', () => {
  const fail = planForScene('Fail.scene')!;

  it('reports companions present + non-semantic and semantic copy applied', () => {
    const displayList: SceneObject[] = [
      // the two carriers this plan rewrites, with the composed copy already applied
      {
        id: 'fail.continue-coins', components: ['Semantic'], text: RESULT_COPY['fail.continue-coins'],
        type: 'Text', fontFamily: 'kenney_future_narrow', fontSize: '19px', y: 643, originY: 1,
      },
      {
        id: 'fail.bundle', components: ['Semantic'], text: RESULT_COPY['fail.bundle'],
        type: 'Text', fontFamily: 'kenney_future_narrow', fontSize: '14px', color: '#173042', y: 792, originY: 1, scaleX: 1,
      },
      {
        id: 'fail.panel', components: ['Semantic'], text: SAMPLE_COPY['fail.panel'], type: 'Text',
        color: '#173042', fontFamily: 'kenney_future', fontSize: '20px', x: 195, y: 438,
      },
      { id: 'fail.currency', components: ['Semantic'], x: 98, y: 504, scaleX: 0.32, scaleY: 0.32 },
      {
        id: 'fail.retry', components: ['Semantic'], type: 'Text', fontFamily: 'kenney_future_narrow', fontSize: '20px',
        color: '#173042', y: 713, originY: 1,
      },
      // every companion, seeded as plain (non-semantic) objects
      ...fail.companions.map((companion) => companionObjData(companion) as SceneObject),
    ];
    const facts = sceneSeedFactsFromJSON(JSON.stringify({ displayList }), fail);

    expect(facts.companions.every((companion) => companion.present)).toBe(true);
    expect(facts.companions.every((companion) => !companion.hasSemantic)).toBe(true);
    expect(facts.semanticCopy.every((edit) => edit.matches)).toBe(true);
    expect(facts.semanticStyle.every((edit) => edit.matches)).toBe(true);
    expect(facts.semanticGeometry.every((edit) => edit.matches)).toBe(true);
    expect(facts.semanticIdCount).toBe(5);
  });

  it('flags a companion that was wrongly given a Semantic component', () => {
    const displayList: SceneObject[] = fail.companions.map((companion) => {
      const data = companionObjData(companion) as SceneObject;
      if (companion.id === 'fail.fab.card') data.components = ['Semantic'];
      return data;
    });
    const facts = sceneSeedFactsFromJSON(JSON.stringify({ displayList }), fail);
    const card = facts.companions.find((companion) => companion.id === 'fail.fab.card');
    expect(card?.hasSemantic).toBe(true);
  });

  it('reports a missing companion and a stale semantic copy', () => {
    const facts = sceneSeedFactsFromJSON(
      JSON.stringify({ displayList: [{ id: 'fail.continue-coins', components: ['Semantic'], text: 'Continue' }] }),
      fail,
    );
    expect(facts.companions.every((companion) => !companion.present)).toBe(true);
    const stale = facts.semanticCopy.find((edit) => edit.semanticId === 'fail.continue-coins');
    expect(stale?.matches).toBe(false);
    expect(stale?.observed).toBe('Continue');
  });
});

describe('session/visualSeed — runner guards', () => {
  const cleanup: string[] = [];
  afterEach(() => {
    while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
  });

  it('fails closed before launching the Editor when the scratch is inside the repository', async () => {
    const result = await runVisualSeed({
      scratch: REPO_ROOT,
      project: REPO_ROOT,
      p0Hash: 'sha256-test',
      port: 19_698,
      serverBin: '/must-not-launch',
    });
    cleanup.push(result.evidencePath);

    expect(result.result).toBe('blocked');
    expect(result.code).toBe('scratch-in-repo');
    expect(result.evidence.schema).toBe(VISUAL_SEED_SCHEMA);
    expect(result.evidencePath.startsWith(REPO_ROOT)).toBe(false);
    const written = readFileSync(result.evidencePath, 'utf8');
    expect(written).not.toContain(REPO_ROOT);
    expect(written).not.toContain(os.homedir());
  });

  it('publishes a stable companion/semantic-copy count on the evidence draft', async () => {
    const result = await runVisualSeed({
      scratch: '/definitely/not/a/scratch/outside/repo',
      project: '/definitely/not/a/scratch/outside/repo/phaser-editor',
      p0Hash: 'sha256-test',
      port: 19_697,
      serverBin: '/must-not-launch',
    });
    cleanup.push(result.evidencePath);
    expect(result.result).toBe('blocked');
    expect(result.evidence.companionCount).toBe(allCompanions().length);
    expect(result.evidence.semanticCopyCount).toBe(allSemanticCopyEdits().length);
    expect(result.evidence.semanticStyleCount).toBe(allSemanticStyleEdits().length);
    expect(result.evidence.semanticGeometryCount).toBe(allSemanticGeometryEdits().length);
    expect(result.evidence.semanticIdsExpected).toBe(48);
  });
});

// Keep the SceneVisualPlan type referenced so the import stays meaningful.
export type { SceneVisualPlan };
