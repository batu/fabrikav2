import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { cp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ACTIVE, PROJECT, PUBLICATIONS, currentRevision, duplicate, publish, reset, status, validate, verifyPublication } from '../tools.mjs';

const menuPath = join(PROJECT, 'src/scenes/Menu.scene');
const referenceAssetsPath = join(PROJECT, '../../reference/assets.yaml');
const resetTargets = [
  join(PROJECT, 'phasereditor2d.config.json'),
  join(PROJECT, 'src/components/Semantic.components'),
  join(PROJECT, 'src/components/Semantic.ts'),
  ...['Menu', 'GameplayHud', 'Pause', 'SettingsMenu', 'SettingsLevel', 'Shop', 'Win', 'Fail', 'Finale']
    .map((name) => join(PROJECT, `src/scenes/${name}.scene`)),
];

test('native project exposes all nine validated scenes and exact asset bindings', async () => {
  const result = await validate();
  assert.deepEqual(result, { scenes: 9, semantics: 220, assets: 16 });
});

test('reviewed Marble fidelity invariants remain encoded in native scene authority', async () => {
  const readScene = async (name) => JSON.parse(await readFile(join(PROJECT, `src/scenes/${name}.scene`), 'utf8'));
  const flatten = (objects) => objects.flatMap((object) => [object, ...(object.type === 'Container' ? flatten(object.list ?? []) : [])]);

  const menu = flatten((await readScene('Menu')).displayList);
  assert.equal(menu.filter((object) => object['Semantic.fabRole'] === 'confetti-piece').length, 16);
  assert.equal(menu.find((object) => object.id === 'menu.brand.title')?.text, 'Marble Run');
  assert.ok((menu.find((object) => object.id === 'menu.start.surface')?.scaleX ?? 0) * 435 >= 310);
  const sagaNodes = menu
    .filter((object) => ['locked-level-node', 'current-level-node'].includes(object['Semantic.fabRole']))
    .sort((a, b) => a.y - b.y);
  const byId = new Map(menu.map((object) => [object.id, object]));
  assert.deepEqual(sagaNodes.map((node) => byId.get(`${node.id}.label`)?.text), ['6', '5', '4', '3']);
  assert.deepEqual(sagaNodes.map((node) => node['Semantic.fabRole']), [
    'locked-level-node', 'locked-level-node', 'locked-level-node', 'current-level-node',
  ]);
  assert.equal(menu.some((object) => object['Semantic.fabRole'] === 'completed-level-node'), false);

  const hud = flatten((await readScene('GameplayHud')).displayList);
  assert.equal(hud.filter((object) => object['Semantic.fabRole'] === 'life-heart' && object.type === 'Container').length, 3);
  assert.equal(hud.some((object) => object.type === 'Text' && /[♥❤]/u.test(object.text ?? '')), false);

  for (const name of ['SettingsMenu', 'SettingsLevel']) {
    const settings = flatten((await readScene(name)).displayList);
    assert.equal(settings.filter((object) => object['Semantic.fabRole'] === 'toggle-row-surface').every((row) => row.height >= 66), true);
    assert.equal(settings.find((object) => object.text === 'Sound Effects')?.fontFamily, 'Fredoka One');
  }

  const win = flatten((await readScene('Win')).displayList);
  const eyebrow = win.find((object) => object.id === 'win.eyebrow');
  const title = win.find((object) => object.id === 'win.title');
  assert.equal(title?.text, 'COMPLETED');
  assert.ok(Math.abs(eyebrow.y - title.y) >= 30);
});

test('asset manifest binds copied bytes to exact current Marble source bytes', async () => {
  const manifest = JSON.parse(await readFile(join(PROJECT, 'public/assets/asset-manifest.json'), 'utf8'));
  const gameRoot = join(PROJECT, '../../..');
  for (const asset of manifest.assets) {
    const projectBytes = await readFile(join(PROJECT, 'public', asset.url));
    const sourceBytes = await readFile(join(gameRoot, asset.source));
    const projectHash = createHash('sha256').update(projectBytes).digest('hex');
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    assert.equal(projectHash, asset.sha256, asset.key);
    assert.equal(sourceHash, asset.sha256, `${asset.key} source`);
  }
});

test('publication is content-addressed, repeatable, and preview pointer is fresh', async () => {
  const first = await publish();
  const second = await publish();
  assert.equal(first.revision, second.revision);
  assert.equal(first.revision, await currentRevision());
  assert.equal((await status()).fresh, true);
  const pointer = JSON.parse(await readFile(ACTIVE, 'utf8'));
  assert.equal(pointer.revision, first.revision);
  await stat(join(PUBLICATIONS, first.revision, 'source/project/src/scenes/Menu.scene'));
  await stat(join(PUBLICATIONS, first.revision, 'source/project/public/assets/icon-coin.png'));
});

test('tampered publication cannot remain fresh or be silently reused', async () => {
  const publication = await publish();
  const publishedMenu = join(PUBLICATIONS, publication.revision, 'source/project/src/scenes/Menu.scene');
  const original = await readFile(publishedMenu);
  try {
    await writeFile(publishedMenu, Buffer.concat([original, Buffer.from('\n')]));
    assert.equal((await status()).fresh, false);
    await assert.rejects(verifyPublication(publication.revision), /frozen authority preimage|authority-byte digest mismatch/);
    await assert.rejects(publish(), /frozen authority preimage|authority-byte digest mismatch/);
  } finally {
    await writeFile(publishedMenu, original);
  }
  await verifyPublication(publication.revision);
});

test('tampered frozen Preview preimage is rejected beneath its revision stamp', async () => {
  const publication = await publish();
  const preimagePath = join(PUBLICATIONS, publication.revision, 'authority.bin');
  const original = await readFile(preimagePath);
  try {
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] ^= 1;
    await writeFile(preimagePath, tampered);
    await assert.rejects(verifyPublication(publication.revision), /frozen authority preimage|authority-byte digest mismatch/);
    assert.equal((await status()).fresh, false);
  } finally {
    await writeFile(preimagePath, original);
  }
  await verifyPublication(publication.revision);
});

test('saved scene changes make Preview stale until a new publication', async () => {
  const original = await readFile(menuPath, 'utf8');
  const originalRevision = await currentRevision();
  let transientRevision;
  try {
    const changed = original.replace('"text": "LEVEL 3"', '"text": "LEVEL 3 EDIT"');
    assert.notEqual(changed, original);
    await writeFile(menuPath, changed);
    assert.equal((await status()).fresh, false);
    const publication = await publish();
    transientRevision = publication.revision;
    assert.equal((await status()).fresh, true);
    assert.equal(publication.revision, await currentRevision());
  } finally {
    await writeFile(menuPath, original);
    await publish();
    if (transientRevision && transientRevision !== originalRevision) {
      await rm(join(PUBLICATIONS, transientRevision), { recursive: true, force: true });
    }
  }
});

test('publication revision is derived from one immutable capture during a concurrent save', async () => {
  const original = await readFile(menuPath, 'utf8');
  const captured = original.replace('"text": "LEVEL 3"', '"text": "LEVEL 3 CAPTURED"');
  const laterSave = original.replace('"text": "LEVEL 3"', '"text": "LEVEL 3 LATER SAVE"');
  let transientRevision;
  try {
    await writeFile(menuPath, captured);
    const publication = await publish({
      afterCapture: async () => writeFile(menuPath, laterSave),
    });
    transientRevision = publication.revision;
    assert.equal(await readFile(join(PUBLICATIONS, publication.revision, 'source/project/src/scenes/Menu.scene'), 'utf8'), captured);
    assert.equal(await readFile(menuPath, 'utf8'), laterSave);
    assert.notEqual(publication.revision, await currentRevision());
    await verifyPublication(publication.revision);
  } finally {
    await writeFile(menuPath, original);
    await publish();
    if (transientRevision) await rm(join(PUBLICATIONS, transientRevision), { recursive: true, force: true });
  }
});

test('failed post-rename verification removes the newly created publication', async () => {
  const original = await readFile(menuPath, 'utf8');
  const changed = original.replace('"text": "LEVEL 3"', '"text": "LEVEL 3 VERIFY FAILURE"');
  let transientRevision;
  try {
    await writeFile(menuPath, changed);
    transientRevision = await currentRevision();
    await rm(join(PUBLICATIONS, transientRevision), { recursive: true, force: true });
    await assert.rejects(publish({ verify: async () => { throw new Error('injected verification failure'); } }), /injected verification failure/);
    await assert.rejects(stat(join(PUBLICATIONS, transientRevision)), { code: 'ENOENT' });
  } finally {
    await writeFile(menuPath, original);
    await publish();
  }
});

test('failed active-pointer replacement preserves the previous pointer atomically', async () => {
  const original = await readFile(menuPath, 'utf8');
  const previousPointer = await readFile(ACTIVE);
  const changed = original.replace('"text": "LEVEL 3"', '"text": "LEVEL 3 POINTER FAILURE"');
  let transientRevision;
  try {
    await writeFile(menuPath, changed);
    transientRevision = await currentRevision();
    await rm(join(PUBLICATIONS, transientRevision), { recursive: true, force: true });
    await assert.rejects(publish({ replaceActive: async () => { throw new Error('injected pointer failure'); } }), /injected pointer failure/);
    assert.deepEqual(await readFile(ACTIVE), previousPointer);
    assert.deepEqual((await readdir(dirname(ACTIVE))).filter((name) => name.startsWith('active.json.write-')), []);
    await verifyPublication(transientRevision);
  } finally {
    await writeFile(menuPath, original);
    await publish();
    if (transientRevision) await rm(join(PUBLICATIONS, transientRevision), { recursive: true, force: true });
  }
});

test('validator rejects a texture outside the exact Marble tray', async () => {
  const original = await readFile(menuPath, 'utf8');
  try {
    const changed = original.replace('"key": "icon_coin"', '"key": "generic_coin"');
    assert.notEqual(changed, original);
    await writeFile(menuPath, changed);
    await assert.rejects(validate(), /uncurated texture generic_coin/);
  } finally {
    await writeFile(menuPath, original);
  }
});

test('validator rejects a self-attested asset addition outside frozen MR1 eligibility', async () => {
  const manifestPath = join(PROJECT, 'public/assets/asset-manifest.json');
  const packPath = join(PROJECT, 'public/assets/asset-pack.json');
  const replayPath = join(PROJECT, 'public/assets/icon-replay.png');
  const originalManifest = await readFile(manifestPath, 'utf8');
  const originalPack = await readFile(packPath, 'utf8');
  try {
    const manifest = JSON.parse(originalManifest);
    manifest.assets.push({
      key: 'icon_replay', role: 'replay-icon', url: 'assets/icon-replay.png', source: 'design/assets/icon-replay.png',
      sha256: 'baf974eeaba7b82c17b0e748f87aaf2358251c2cdfdf464bfbc24b80980c7639', dimensions: [256, 256], alpha: true,
    });
    const pack = JSON.parse(originalPack);
    pack['marble-run-exact-ui'].files.push({ url: 'assets/icon-replay.png', type: 'image', key: 'icon_replay' });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(packPath, `${JSON.stringify(pack, null, 2)}\n`);
    await cp(join(PROJECT, '../../../design/assets/icon-replay.png'), replayPath);
    await assert.rejects(validate(), /complete status-eligible frozen MR1 contract/);
  } finally {
    await writeFile(manifestPath, originalManifest);
    await writeFile(packPath, originalPack);
    await rm(replayPath, { force: true });
  }
});

test('validator rejects coordinated edits to the frozen MR1 asset contract', async () => {
  const original = await readFile(referenceAssetsPath, 'utf8');
  try {
    await writeFile(referenceAssetsPath, `${original}\n`);
    await assert.rejects(validate(), /frozen MR1 asset contract bytes changed/);
  } finally {
    await writeFile(referenceAssetsPath, original);
  }
});

test('native duplicate action assigns unique native and semantic descendant identities atomically', async () => {
  const original = await readFile(menuPath, 'utf8');
  try {
    await duplicate('Menu', 'menu.currency', 'menu.currency.bonus');
    const scene = JSON.parse(await readFile(menuPath, 'utf8'));
    const flatten = (objects) => objects.flatMap((object) => [object, ...(object.type === 'Container' ? flatten(object.list ?? []) : [])]);
    const objects = flatten(scene.displayList);
    const clone = objects.find((object) => object.id === 'menu.currency.bonus');
    assert.ok(clone);
    assert.deepEqual(clone.list.map((object) => object.id), [
      'menu.currency.bonus.panel', 'menu.currency.bonus.icon', 'menu.currency.bonus.value',
    ]);
    assert.equal(clone.list.every((object) => object.id === object.label && object.id === object['Semantic.fabSemanticId']), true);
    assert.equal(new Set(objects.map((object) => object.id)).size, objects.length);
    assert.equal((await validate()).semantics, 224);
  } finally {
    await writeFile(menuPath, original);
  }
});

test('validator rejects behavior injected into the inert Semantic carrier', async () => {
  const semanticPath = join(PROJECT, 'src/components/Semantic.ts');
  const original = await readFile(semanticPath, 'utf8');
  try {
    await writeFile(semanticPath, original.replace('public fabVariant', 'public updateLayout() { this.gameObject.setPosition(0, 0); }\n  public fabVariant'));
    await assert.rejects(validate(), /canonical inert five-field carrier/);
  } finally {
    await writeFile(semanticPath, original);
  }
});

test('reset restores protected native scene bytes and republishes cleanly', async () => {
  const baseline = await readFile(join(PROJECT, '../baseline/scenes/Menu.scene'), 'utf8');
  await writeFile(menuPath, baseline.replace('"text": "Marble Run"', '"text": "BROKEN EXPERIMENT"'));
  assert.notEqual(await readFile(menuPath, 'utf8'), baseline);
  const result = await reset();
  assert.equal(result.scenes, 9);
  assert.equal(await readFile(menuPath, 'utf8'), baseline);
  await publish();
  assert.equal((await status()).fresh, true);
});

test('reset rolls back every working file when one staged replacement fails', async () => {
  const semanticPath = join(PROJECT, 'src/components/Semantic.components');
  const originalMenu = await readFile(menuPath, 'utf8');
  const originalSemantic = await readFile(semanticPath, 'utf8');
  const dirtyMenu = originalMenu.replace('"text": "Marble Run"', '"text": "WORKING GENERATION"');
  const dirtySemantic = `${originalSemantic}\n`;
  await writeFile(menuPath, dirtyMenu);
  await writeFile(semanticPath, dirtySemantic);
  const workingGeneration = new Map(await Promise.all(resetTargets.map(async (path) => [path, await readFile(path)])));
  try {
    const replaceWithFailure = async (source, target) => {
      if (target.endsWith('/Pause.scene')) throw new Error('injected replacement failure');
      const temporary = `${target}.injected-replacement`;
      try {
        await cp(source, temporary, { force: false });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    };
    await assert.rejects(
      reset({ replace: replaceWithFailure }),
      /injected replacement failure/,
    );
    for (const [path, expected] of workingGeneration) assert.deepEqual(await readFile(path), expected, path);
  } finally {
    await writeFile(menuPath, originalMenu);
    await writeFile(semanticPath, originalSemantic);
  }
  await validate();
});

test('reset rejects a corrupt protected config before replacing any working file', async () => {
  const baselineConfigPath = join(PROJECT, '../baseline/phasereditor2d.config.json');
  const originalBaseline = await readFile(baselineConfigPath, 'utf8');
  const workingGeneration = new Map(await Promise.all(resetTargets.map(async (path) => [path, await readFile(path)])));
  try {
    await writeFile(baselineConfigPath, originalBaseline.replace('"type": "phaser"', '"type": "corrupt"'));
    await assert.rejects(reset(), /project config is not a native Phaser TypeScript project/);
    for (const [path, expected] of workingGeneration) assert.deepEqual(await readFile(path), expected, path);
  } finally {
    await writeFile(baselineConfigPath, originalBaseline);
  }
  await validate();
});

test('reset keeps rollback state until post-replacement validation succeeds', async () => {
  const originalMenu = await readFile(menuPath, 'utf8');
  const dirtyMenu = originalMenu.replace('"text": "Marble Run"', '"text": "POST VALIDATION WORKING GENERATION"');
  await writeFile(menuPath, dirtyMenu);
  const workingGeneration = new Map(await Promise.all(resetTargets.map(async (path) => [path, await readFile(path)])));
  try {
    await assert.rejects(reset({ validateResult: async () => { throw new Error('injected post-replacement validation failure'); } }), /injected post-replacement validation failure/);
    for (const [path, expected] of workingGeneration) assert.deepEqual(await readFile(path), expected, path);
  } finally {
    await writeFile(menuPath, originalMenu);
  }
  await validate();
});
