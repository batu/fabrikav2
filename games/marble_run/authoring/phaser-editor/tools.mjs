#!/usr/bin/env node
/* global process */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { duplicateSemanticHierarchy } from './project/editor-actions/duplicate-semantic.mjs';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const PROJECT = join(ROOT, 'project');
export const BASELINE = join(ROOT, 'baseline');
export const PUBLICATIONS = join(ROOT, 'publications');
export const ACTIVE = join(ROOT, 'preview', 'active.json');
export const SCENES = Object.freeze([
  'Menu', 'GameplayHud', 'Pause', 'SettingsMenu', 'SettingsLevel', 'Shop', 'Win', 'Fail', 'Finale',
]);
const ALLOWED_TYPES = new Set(['Rectangle', 'Text', 'Image', 'Container']);
const SEMANTIC_FIELDS = ['fabSemanticId', 'fabRole', 'fabBinding', 'fabSlot', 'fabVariant'];
const REVISION_PATTERN = /^sha256-[0-9a-f]{64}$/;
const FROZEN_REFERENCE_ASSETS_SHA256 = '6c3e2268d70d8af00e4269f56616d140ac58d4a803826f49cbcf29801d5c3388';
const SEMANTIC_TS_CANONICAL = `// Native Phaser Editor user component. The Scene Editor owns the assignments.
// This generated-compatible carrier deliberately contains no layout or behavior.
import Phaser from "phaser";

export default class Semantic {
  constructor(gameObject: Phaser.GameObjects.GameObject) {
    this.gameObject = gameObject;
    (gameObject as Phaser.GameObjects.GameObject & { __Semantic?: Semantic }).__Semantic = this;
  }

  static getComponent(gameObject: Phaser.GameObjects.GameObject): Semantic | undefined {
    return (gameObject as Phaser.GameObjects.GameObject & { __Semantic?: Semantic }).__Semantic;
  }

  private gameObject: Phaser.GameObjects.GameObject;
  public fabSemanticId = "";
  public fabRole = "";
  public fabBinding = "";
  public fabSlot = "";
  public fabVariant = "default";
}
`;
const FORBIDDEN = /kenney|trailbound|shell_proof|generic[ -]shell/i;
const SCREEN_TO_SCENE = Object.freeze({
  menu: 'Menu',
  'gameplay-hud': 'GameplayHud',
  pause: 'Pause',
  'settings-menu': 'SettingsMenu',
  'settings-level': 'SettingsLevel',
  shop: 'Shop',
  win: 'Win',
  fail: 'Fail',
  finale: 'Finale',
});

async function bytes(path) {
  return readFile(path);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

function parseInlineRecord(source) {
  const body = source.trim().replace(/^-\s*\{/, '').replace(/\}\s*$/, '');
  const fields = [];
  let token = '';
  let quote = false;
  let depth = 0;
  for (const character of body) {
    if (character === '"') quote = !quote;
    if (!quote && character === '[') depth += 1;
    if (!quote && character === ']') depth -= 1;
    if (!quote && depth === 0 && character === ',') {
      fields.push(token);
      token = '';
    } else token += character;
  }
  fields.push(token);
  return Object.fromEntries(fields.map((field) => {
    const separator = field.indexOf(':');
    const key = field.slice(0, separator).trim();
    const raw = field.slice(separator + 1).trim();
    let value;
    if (raw.startsWith('"') || raw.startsWith('[')) value = JSON.parse(raw);
    else if (raw === 'true' || raw === 'false') value = raw === 'true';
    else value = raw;
    return [key, value];
  }));
}

async function frozenAssetContract() {
  const referencePath = resolve(ROOT, '../reference/assets.yaml');
  const sourceBytes = await bytes(referencePath);
  if (sha256(sourceBytes) !== FROZEN_REFERENCE_ASSETS_SHA256) {
    throw new Error('frozen MR1 asset contract bytes changed');
  }
  const source = sourceBytes.toString('utf8');
  const records = [];
  let section = null;
  for (const line of source.split('\n')) {
    if (line === 'assets:') section = 'image';
    else if (line === 'fonts:') section = 'font';
    else if (section && /^ {2}- \{/.test(line)) records.push({ ...parseInlineRecord(line.trim()), type: section });
  }
  const eligible = records.filter((record) => (
    record.type === 'image'
      ? record.status === 'live' && !/favicon only/i.test(record.consumer)
      : ['live', 'loaded-fallback'].includes(record.status)
  ));
  return eligible.map((record) => {
    const relative = record.path.replace(/^design\/assets\//, '');
    const basename = relative.split('/').at(-1).replace(/\.[^.]+$/, '');
    return {
      key: record.family ?? basename.replaceAll('-', '_'),
      source: record.path,
      sha256: record.sha256,
      dimensions: record.dimensions,
      type: record.type,
      url: `assets/${relative}`,
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function normalizedAssetContract(manifest, packFiles) {
  const packByKey = new Map(packFiles.map((asset) => [asset.key, asset]));
  return manifest.assets.map((asset) => ({
    key: asset.key,
    source: asset.source,
    sha256: asset.sha256,
    dimensions: asset.dimensions,
    type: packByKey.get(asset.key)?.type,
    url: asset.url,
  })).sort((a, b) => a.key.localeCompare(b.key));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function walkObjects(objects, visitor) {
  for (const object of objects) {
    visitor(object);
    if (object.type === 'Container') walkObjects(object.list ?? [], visitor);
  }
}

function validateSemantic(object, seen, errors, file) {
  if (!ALLOWED_TYPES.has(object.type)) errors.push(`${file}: unsupported native type ${object.type}`);
  if (!Array.isArray(object.components) || !object.components.includes('Semantic')) {
    errors.push(`${file}: ${object.label ?? object.id ?? '<unknown>'} lacks Semantic component`);
    return;
  }
  for (const field of SEMANTIC_FIELDS) {
    const value = object[`Semantic.${field}`];
    if (typeof value !== 'string' || value.length === 0) errors.push(`${file}: ${object.id} lacks Semantic.${field}`);
  }
  const id = object['Semantic.fabSemanticId'];
  if (seen.has(id)) errors.push(`${file}: duplicate semantic instance ${id}`);
  seen.add(id);
  if (object.id !== id || object.label !== id) errors.push(`${file}: native id/label must equal semantic instance ${id}`);
  if (object.type === 'Container' && (!Array.isArray(object.list) || object.list.length === 0)) {
    errors.push(`${file}: semantic container ${id} has no selectable children`);
  }
}

async function validateSceneSet(directory, label, manifestKeys) {
  const errors = [];
  const names = (await readdir(directory)).filter((name) => name.endsWith('.scene')).sort();
  const expected = SCENES.map((name) => `${name}.scene`).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    errors.push(`${label}: expected exactly ${expected.join(', ')}, found ${names.join(', ')}`);
  }
  const seen = new Set();
  for (const name of names) {
    const path = join(directory, name);
    let scene;
    try { scene = await json(path); } catch (error) { errors.push(`${label}/${name}: invalid JSON (${error.message})`); continue; }
    const settings = scene.settings ?? {};
    if (settings.borderWidth !== 390 || settings.borderHeight !== 844) errors.push(`${label}/${name}: viewport must be 390x844`);
    if (settings.sceneKey !== name.replace(/\.scene$/, '')) errors.push(`${label}/${name}: sceneKey mismatch`);
    if (scene.meta?.app !== 'Phaser Editor - Scene Editor' || scene.meta?.version !== 5) errors.push(`${label}/${name}: not Phaser Editor 5 scene content`);
    if (FORBIDDEN.test(JSON.stringify(scene))) errors.push(`${label}/${name}: generic/forbidden content detected`);
    const objectsById = new Map();
    walkObjects(scene.displayList ?? [], (object) => {
      objectsById.set(object.id, object);
      validateSemantic(object, seen, errors, `${label}/${name}`);
      if (object.type === 'Image' && !manifestKeys.has(object.texture?.key)) errors.push(`${label}/${name}: uncurated texture ${object.texture?.key}`);
      if (object.type === 'Text' && !manifestKeys.has(object.fontFamily)) errors.push(`${label}/${name}: unloaded or uncurated font ${object.fontFamily}`);
    });
    if (name === 'Menu.scene') {
      const pieces = [...objectsById.values()].filter((object) => object['Semantic.fabRole'] === 'confetti-piece');
      if (pieces.length !== 16) errors.push(`${label}/${name}: expected exactly 16 deterministic confetti pieces, found ${pieces.length}`);
      const title = objectsById.get('menu.brand.title');
      if (title?.text !== 'Marble Run' || title?.color !== '#6a3016') errors.push(`${label}/${name}: banner title must be source Title Case brown copy`);
      const cta = objectsById.get('menu.start.surface');
      if ((cta?.scaleX ?? 0) * 435 < 310) errors.push(`${label}/${name}: primary CTA must remain near full width`);
      const sagaNodes = [...objectsById.values()]
        .filter((object) => ['locked-level-node', 'current-level-node'].includes(object['Semantic.fabRole']))
        .sort((a, b) => a.y - b.y);
      const sagaLabels = sagaNodes.map((node) => objectsById.get(`${node.id}.label`)?.text);
      if (JSON.stringify(sagaLabels) !== JSON.stringify(['6', '5', '4', '3'])) {
        errors.push(`${label}/${name}: level-3 primary saga must descend 6, 5, 4, 3 from top to bottom`);
      }
      if (sagaNodes.slice(0, 3).some((node) => node['Semantic.fabRole'] !== 'locked-level-node') || sagaNodes.at(-1)?.['Semantic.fabRole'] !== 'current-level-node') {
        errors.push(`${label}/${name}: locked-ahead levels must sit above current level 3`);
      }
      if ([...objectsById.values()].some((object) => object['Semantic.fabRole'] === 'completed-level-node')) {
        errors.push(`${label}/${name}: level-3 primary saga must not include completed level 2`);
      }
    }
    if (name === 'GameplayHud.scene') {
      const hearts = [...objectsById.values()].filter((object) => object['Semantic.fabRole'] === 'life-heart');
      if (hearts.length !== 3 || hearts.some((heart) => heart.type !== 'Container' || heart.list?.length !== 3 || heart.list.some((part) => part.type !== 'Rectangle'))) {
        errors.push(`${label}/${name}: lives must be three procedural three-piece native heart groups`);
      }
      if ([...objectsById.values()].some((object) => object.type === 'Text' && /[♥❤]/u.test(object.text ?? ''))) errors.push(`${label}/${name}: Unicode heart glyphs are forbidden`);
    }
    if (name === 'SettingsMenu.scene' || name === 'SettingsLevel.scene') {
      const rows = [...objectsById.values()].filter((object) => object['Semantic.fabRole'] === 'toggle-row-surface');
      if (rows.length !== 3 || rows.some((row) => row.height < 66)) errors.push(`${label}/${name}: all three toggle rows must be at least 66px tall`);
      const sfx = [...objectsById.values()].find((object) => object.type === 'Text' && object.text === 'Sound Effects');
      if (!sfx || /\n/u.test(sfx.text)) errors.push(`${label}/${name}: Sound Effects must remain a one-line label`);
    }
    if (name === 'Win.scene') {
      const eyebrow = objectsById.get('win.eyebrow');
      const title = objectsById.get('win.title');
      if (title?.text !== 'COMPLETED' || /\n/u.test(title?.text ?? '')) errors.push(`${label}/${name}: result headline must be one-line current-source COMPLETED`);
      if (!eyebrow || !title || Math.abs(eyebrow.y - title.y) < 30) errors.push(`${label}/${name}: result eyebrow and headline require distinct vertical bands`);
    }
  }
  return { errors, semanticCount: seen.size };
}

export async function validate() {
  const errors = [];
  const referenceScreens = (await readFile(resolve(ROOT, '../reference/screens.yaml'), 'utf8'))
    .split('\n')
    .map((line) => line.match(/^ {2}- id: ([a-z0-9-]+)$/)?.[1])
    .filter(Boolean);
  const mappedScenes = referenceScreens.map((screen) => SCREEN_TO_SCENE[screen]).filter(Boolean).sort();
  if (referenceScreens.some((screen) => !SCREEN_TO_SCENE[screen]) || JSON.stringify(mappedScenes) !== JSON.stringify([...SCENES].sort())) {
    errors.push(`native scenes no longer match the MR1 primary-screen inventory: ${referenceScreens.join(', ')}`);
  }
  const config = await json(join(PROJECT, 'phasereditor2d.config.json'));
  if (config.type !== 'phaser' || config.sceneEditor?.outputLanguage !== 'TYPE_SCRIPT') errors.push('project config is not a native Phaser TypeScript project');
  if (FORBIDDEN.test(JSON.stringify(config))) errors.push('project config contains generic shell identity');
  const projectPackage = await json(join(PROJECT, 'package.json'));
  if (projectPackage.dependencies?.phaser !== '^3.90.0') errors.push('native project must resolve the repository Phaser 3.90 runtime');

  const componentDoc = await json(join(PROJECT, 'src/components/Semantic.components'));
  const properties = componentDoc.components?.[0]?.properties?.map((property) => property.name);
  if (JSON.stringify(properties) !== JSON.stringify(SEMANTIC_FIELDS)) errors.push('Semantic component must expose exactly five string fields');
  if (componentDoc.components?.[0]?.properties?.some((property) => property.type?.id !== 'string')) errors.push('Semantic component fields must all be strings');
  const semanticSource = await readFile(join(PROJECT, 'src/components/Semantic.ts'), 'utf8');
  const baselineSemanticSource = await readFile(join(BASELINE, 'Semantic.ts'), 'utf8');
  if (semanticSource !== SEMANTIC_TS_CANONICAL) errors.push('Semantic.ts must remain the canonical inert five-field carrier');
  if (baselineSemanticSource !== SEMANTIC_TS_CANONICAL) errors.push('protected baseline Semantic.ts must remain canonical');

  const manifestPath = join(PROJECT, 'public/assets/asset-manifest.json');
  const manifest = await json(manifestPath);
  const pack = await json(join(PROJECT, 'public/assets/asset-pack.json'));
  const packFiles = pack['marble-run-exact-ui']?.files ?? [];
  const expectedAssetContract = await frozenAssetContract();
  const actualAssetContract = normalizedAssetContract(manifest, packFiles);
  if (!sameJson(actualAssetContract, expectedAssetContract)) {
    errors.push('asset manifest/pack must equal the complete status-eligible frozen MR1 contract');
  }
  const manifestKeys = new Set(manifest.assets.map((asset) => asset.key));
  const packKeys = new Set(packFiles.map((asset) => asset.key));
  if (manifestKeys.size !== manifest.assets.length) errors.push('asset manifest keys must be unique');
  if (JSON.stringify([...manifestKeys].sort()) !== JSON.stringify([...packKeys].sort())) errors.push('asset pack must contain exactly the curated manifest');
  for (const family of ['Fredoka One', 'Titan One']) {
    const packed = packFiles.find((asset) => asset.key === family);
    if (packed?.type !== 'font') errors.push(`asset pack must load exact ${family} bytes under the real font family name`);
  }

  const gameRoot = resolve(ROOT, '../..');
  for (const asset of manifest.assets) {
    const projectPath = join(PROJECT, 'public', asset.url);
    const sourcePath = join(gameRoot, asset.source);
    for (const [kind, path] of [['project', projectPath], ['source', sourcePath]]) {
      if (!(await exists(path))) { errors.push(`${kind} asset missing: ${path}`); continue; }
      const actual = sha256(await bytes(path));
      if (actual !== asset.sha256) errors.push(`${kind} asset hash mismatch for ${asset.key}: ${actual}`);
    }
  }

  const working = await validateSceneSet(join(PROJECT, 'src/scenes'), 'working', manifestKeys);
  const baseline = await validateSceneSet(join(BASELINE, 'scenes'), 'baseline', manifestKeys);
  errors.push(...working.errors, ...baseline.errors);
  if (working.semanticCount < 120) errors.push(`working scenes expose only ${working.semanticCount} semantic objects; expected complete hierarchy`);

  if (errors.length > 0) throw new Error(`Phaser authoring validation failed:\n- ${errors.join('\n- ')}`);
  return { scenes: SCENES.length, semantics: working.semanticCount, assets: manifest.assets.length };
}

async function authorityPaths() {
  const paths = [
    'project/phasereditor2d.config.json',
    'project/package.json',
    'project/tsconfig.json',
    'project/public/publicroot',
    'project/src/components/Semantic.components',
    'project/src/components/Semantic.ts',
    'project/editor-actions/duplicate-semantic.action.json',
    'project/editor-actions/duplicate-semantic.mjs',
    'project/public/assets/asset-manifest.json',
    'project/public/assets/asset-pack.json',
    ...SCENES.map((name) => `project/src/scenes/${name}.scene`),
  ];
  paths.push(...(await frozenAssetContract()).map((asset) => `project/public/${asset.url}`));
  return [...new Set(paths)].sort();
}

async function revisionAt(root) {
  return `sha256-${sha256(await authorityPreimageAt(root))}`;
}

async function authorityPreimageAt(root) {
  const parts = [];
  for (const relativePath of await authorityPaths()) {
    const content = await bytes(join(root, relativePath));
    parts.push(Buffer.from(`${relativePath}\0${content.length}\0`), content);
  }
  return Buffer.concat(parts);
}

export async function currentRevision() {
  return revisionAt(ROOT);
}

export async function verifyPublication(revision) {
  if (!REVISION_PATTERN.test(revision)) throw new Error(`invalid publication revision ${revision}`);
  const publication = join(PUBLICATIONS, revision);
  const revisionDoc = await json(join(publication, 'revision.json'));
  const expectedPaths = await authorityPaths();
  if (revisionDoc.schema !== 'fabrikav2-phaser-editor-publication/v1') throw new Error(`${revision}: invalid publication schema`);
  if (revisionDoc.revision !== revision) throw new Error(`${revision}: embedded revision mismatch`);
  if (!sameJson(revisionDoc.scenes, SCENES)) throw new Error(`${revision}: scene set mismatch`);
  if (!sameJson(revisionDoc.authorityPaths, expectedPaths)) throw new Error(`${revision}: authority path set mismatch`);
  const sourceRoot = join(publication, 'source');
  const actualPreimage = await authorityPreimageAt(sourceRoot);
  const frozenPreimage = await bytes(join(publication, 'authority.bin'));
  if (!actualPreimage.equals(frozenPreimage)) throw new Error(`${revision}: frozen authority preimage does not match source bytes`);
  const actualRevision = `sha256-${sha256(frozenPreimage)}`;
  if (actualRevision !== revision) throw new Error(`${revision}: authority-byte digest mismatch (${actualRevision})`);
  return revisionDoc;
}

export async function publish() {
  const validation = await validate();
  const revision = await currentRevision();
  const destination = join(PUBLICATIONS, revision);
  if (await exists(destination)) {
    if (!(await exists(join(destination, 'authority.bin')))) {
      const sourceRevision = await revisionAt(join(destination, 'source'));
      if (sourceRevision !== revision) throw new Error(`${revision}: cannot migrate a mismatched publication`);
      await writeFile(join(destination, 'authority.bin'), await authorityPreimageAt(join(destination, 'source')), { flag: 'wx' });
    }
    await verifyPublication(revision);
  } else {
    await mkdir(PUBLICATIONS, { recursive: true });
    const temporary = await mkdtemp(join(PUBLICATIONS, '.tmp-'));
    try {
      for (const relativePath of await authorityPaths()) {
        const target = join(temporary, 'source', relativePath);
        await mkdir(dirname(target), { recursive: true });
        await cp(join(ROOT, relativePath), target, { force: false });
      }
      await writeFile(join(temporary, 'authority.bin'), await authorityPreimageAt(ROOT), { flag: 'wx' });
      const revisionDoc = {
        schema: 'fabrikav2-phaser-editor-publication/v1',
        revision,
        authority: 'saved-native-phaser-editor-scenes',
        viewport: { width: 390, height: 844 },
        scenes: SCENES,
        sceneCount: validation.scenes,
        semanticCount: validation.semantics,
        assetCount: validation.assets,
        authorityPaths: await authorityPaths(),
      };
      await writeFile(join(temporary, 'revision.json'), `${JSON.stringify(revisionDoc, null, 2)}\n`);
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    await verifyPublication(revision);
  }
  const active = {
    schema: 'fabrikav2-phaser-editor-preview-pointer/v1',
    revision,
    publication: `../publications/${revision}`,
    defaultScene: 'Menu',
    scenes: SCENES,
  };
  await writeFile(ACTIVE, `${JSON.stringify(active, null, 2)}\n`);
  return active;
}

export async function status() {
  const revision = await currentRevision();
  if (!(await exists(ACTIVE))) return { revision, publishedRevision: null, publicationValid: false, fresh: false };
  const active = await json(ACTIVE);
  let publicationValid = false;
  try {
    if (active.publication !== `../publications/${active.revision}` || !sameJson(active.scenes, SCENES)) throw new Error('invalid pointer');
    await verifyPublication(active.revision);
    publicationValid = true;
  } catch {
    publicationValid = false;
  }
  return { revision, publishedRevision: active.revision, publicationValid, fresh: publicationValid && revision === active.revision };
}

async function replaceFromBaseline(source, target) {
  const temporary = `${target}.reset-${process.pid}`;
  await cp(source, temporary, { force: true });
  await rename(temporary, target);
}

export async function reset() {
  const manifestKeys = new Set((await json(join(PROJECT, 'public/assets/asset-manifest.json'))).assets.map((asset) => asset.key));
  const baselineCheck = await validateSceneSet(join(BASELINE, 'scenes'), 'baseline', manifestKeys);
  if (baselineCheck.errors.length > 0) throw new Error(`Protected baseline is invalid:\n- ${baselineCheck.errors.join('\n- ')}`);
  await replaceFromBaseline(join(BASELINE, 'phasereditor2d.config.json'), join(PROJECT, 'phasereditor2d.config.json'));
  await replaceFromBaseline(join(BASELINE, 'Semantic.components'), join(PROJECT, 'src/components/Semantic.components'));
  await replaceFromBaseline(join(BASELINE, 'Semantic.ts'), join(PROJECT, 'src/components/Semantic.ts'));
  for (const name of SCENES) await replaceFromBaseline(join(BASELINE, 'scenes', `${name}.scene`), join(PROJECT, 'src/scenes', `${name}.scene`));
  return validate();
}

export async function duplicate(sceneName, sourceSemanticId, cloneSemanticId) {
  if (!SCENES.includes(sceneName)) throw new Error(`unknown native scene ${sceneName}`);
  const path = join(PROJECT, 'src/scenes', `${sceneName}.scene`);
  const scene = await json(path);
  const clone = duplicateSemanticHierarchy(scene, sourceSemanticId, cloneSemanticId);
  const temporary = `${path}.duplicate-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(scene, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
  return { scene: sceneName, sourceSemanticId, cloneSemanticId: clone['Semantic.fabSemanticId'] };
}

async function main() {
  const command = process.argv[2];
  if (command === 'validate') console.log(JSON.stringify(await validate(), null, 2));
  else if (command === 'publish') console.log(JSON.stringify(await publish(), null, 2));
  else if (command === 'status') console.log(JSON.stringify(await status(), null, 2));
  else if (command === 'reset') console.log(JSON.stringify(await reset(), null, 2));
  else if (command === 'duplicate') console.log(JSON.stringify(await duplicate(process.argv[3], process.argv[4], process.argv[5]), null, 2));
  else throw new Error('usage: tools.mjs <validate|publish|status|reset|duplicate SCENE SOURCE_ID CLONE_ID>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
