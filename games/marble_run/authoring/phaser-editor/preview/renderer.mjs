/* global Blob, FontFace, ResizeObserver, URL, location, history, Option, crypto, TextDecoder */

const picker = document.querySelector('#scene-picker');
const sceneRoot = document.querySelector('#scene');
const revisionNode = document.querySelector('#revision');
const device = document.querySelector('.device');

const expectedScenes = ['Menu', 'GameplayHud', 'Pause', 'SettingsMenu', 'SettingsLevel', 'Shop', 'Win', 'Fail', 'Finale'];
const revisionPattern = /^sha256-[0-9a-f]{64}$/;
const decoder = new TextDecoder();
const active = await fetch('./active.json', { cache: 'no-store' }).then((response) => {
  if (!response.ok) throw new Error(`Preview is unpublished (${response.status}). Run tools.mjs publish.`);
  return response.json();
});
if (active.schema !== 'fabrikav2-phaser-editor-preview-pointer/v1' || !revisionPattern.test(active.revision)) {
  throw new Error('Preview pointer has an invalid schema or revision');
}
if (active.publication !== `../publications/${active.revision}` || JSON.stringify(active.scenes) !== JSON.stringify(expectedScenes)) {
  throw new Error('Preview pointer path or scene set does not match its revision');
}
const publication = `../publications/${active.revision}`;
const revision = await fetch(`${publication}/revision.json`, { cache: 'no-store' }).then((response) => {
  if (!response.ok) throw new Error(`Publication metadata is missing (${response.status})`);
  return response.json();
});
if (revision.schema !== 'fabrikav2-phaser-editor-publication/v1' || revision.revision !== active.revision) {
  throw new Error('Publication metadata does not match the active revision');
}
if (JSON.stringify(revision.scenes) !== JSON.stringify(expectedScenes) || !Array.isArray(revision.authorityPaths)) {
  throw new Error('Publication scene or authority path set is invalid');
}
const authorityBytes = new Map();
const preimageResponse = await fetch(`${publication}/authority.bin`, { cache: 'no-store' });
if (!preimageResponse.ok) throw new Error(`Publication authority preimage is missing (${preimageResponse.status})`);
const preimage = new Uint8Array(await preimageResponse.arrayBuffer());
const actualDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', preimage))]
  .map((value) => value.toString(16).padStart(2, '0'))
  .join('');
if (`sha256-${actualDigest}` !== active.revision) throw new Error('Publication authority-byte digest does not match the revision stamp');
let cursor = 0;
const parsedPaths = [];
function readUntilNull() {
  const end = preimage.indexOf(0, cursor);
  if (end < 0) throw new Error('Publication authority preimage is truncated');
  const value = decoder.decode(preimage.slice(cursor, end));
  cursor = end + 1;
  return value;
}
while (cursor < preimage.length) {
  const path = readUntilNull();
  const lengthText = readUntilNull();
  const length = Number(lengthText);
  if (typeof path !== 'string' || path.startsWith('/') || path.includes('..') || !path.startsWith('project/') || !Number.isSafeInteger(length) || length < 0 || cursor + length > preimage.length) {
    throw new Error(`Unsafe or invalid publication authority entry ${path}`);
  }
  authorityBytes.set(path, preimage.slice(cursor, cursor + length));
  parsedPaths.push(path);
  cursor += length;
}
if (JSON.stringify(parsedPaths) !== JSON.stringify(revision.authorityPaths)) throw new Error('Publication authority path order does not match metadata');

function publishedJson(path) {
  const content = authorityBytes.get(path);
  if (!content) throw new Error(`Verified publication does not contain ${path}`);
  return JSON.parse(decoder.decode(content));
}

const assetManifest = publishedJson('project/public/assets/asset-manifest.json');
const assets = new Map(assetManifest.assets.map((asset) => [asset.key, asset]));
const assetUrls = new Map(assetManifest.assets.map((asset) => {
  const content = authorityBytes.get(`project/public/${asset.url}`);
  if (!content) throw new Error(`Verified publication does not contain asset ${asset.key}`);
  return [asset.key, URL.createObjectURL(new Blob([content]))];
}));

for (const family of ['Fredoka One', 'Titan One']) {
  const asset = assets.get(family);
  if (!asset) throw new Error(`Published exact font ${family} is missing`);
  const face = new FontFace(family, `url(${assetUrls.get(family)})`, { style: 'normal', weight: '400' });
  await face.load();
  document.fonts.add(face);
}
revisionNode.textContent = `${revision.revision} · immutable saved-scene publication`;

function scaleScene() {
  const scale = device.clientWidth / 390;
  sceneRoot.style.transform = `scale(${scale})`;
}
new ResizeObserver(scaleScene).observe(device);
scaleScene();

function px(value, fallback = 0) { return `${Number.isFinite(value) ? value : fallback}px`; }
function place(element, object, dimensions) {
  const x = object.x ?? 0;
  const y = object.y ?? 0;
  const originX = object.originX ?? 0.5;
  const originY = object.originY ?? 0.5;
  element.style.left = px(x);
  element.style.top = px(y);
  if (dimensions) {
    element.style.width = px(dimensions.width);
    element.style.height = px(dimensions.height);
  }
  const transforms = [`translate(${-originX * 100}%, ${-originY * 100}%)`];
  if (object.rotation) transforms.push(`rotate(${object.rotation}rad)`);
  element.style.transform = transforms.join(' ');
  if (object.visible === false) element.style.display = 'none';
  if (object.alpha !== undefined) element.style.opacity = String(object.alpha);
  element.dataset.fabId = object['Semantic.fabSemanticId'];
  element.title = `${object.label} · ${object['Semantic.fabRole']} · ${object['Semantic.fabBinding']}`;
}

function renderObject(object, parent) {
  let element;
  if (object.type === 'Container') {
    element = document.createElement('div');
    element.className = 'container';
    place(element, { ...object, originX: 0, originY: 0 });
    for (const child of object.list ?? []) renderObject(child, element);
  } else if (object.type === 'Rectangle') {
    element = document.createElement('div');
    element.className = 'object rectangle';
    place(element, object, { width: object.width, height: object.height });
    element.style.background = object.isFilled ? object.fillColor : 'transparent';
    if (object.fillAlpha !== undefined) element.style.opacity = String(object.fillAlpha);
    if (object.isStroked) {
      element.style.borderWidth = px(object.lineWidth ?? 1);
      element.style.borderColor = object.strokeColor;
      element.style.borderStyle = 'solid';
    }
    if (object.rounded) element.style.borderRadius = px(object.rounded);
  } else if (object.type === 'Text') {
    element = document.createElement('div');
    element.className = 'object text';
    element.textContent = object.text;
    element.style.fontFamily = `"${object.fontFamily}", system-ui, sans-serif`;
    element.style.fontSize = object.fontSize;
    element.style.color = object.color;
    element.style.textAlign = object.align ?? 'left';
    element.style.fontWeight = '400';
    element.style.whiteSpace = 'pre';
    place(element, object);
  } else if (object.type === 'Image') {
    const asset = assets.get(object.texture?.key);
    if (!asset) throw new Error(`Unpublished texture ${object.texture?.key}`);
    element = document.createElement('img');
    element.className = 'object image';
    element.src = assetUrls.get(asset.key);
    element.alt = object.label;
    element.draggable = false;
    const [sourceWidth = 1, sourceHeight = 1] = asset.dimensions ?? [1, 1];
    place(element, object, { width: sourceWidth * (object.scaleX ?? 1), height: sourceHeight * (object.scaleY ?? 1) });
  } else {
    throw new Error(`Unsupported projection type ${object.type}`);
  }
  parent.append(element);
}

async function renderScene(name) {
  const scene = publishedJson(`project/src/scenes/${name}.scene`);
  sceneRoot.replaceChildren();
  sceneRoot.dataset.scene = name;
  for (const object of scene.displayList) renderObject(object, sceneRoot);
  const url = new URL(location.href);
  url.searchParams.set('scene', name);
  history.replaceState(null, '', url);
}

for (const name of active.scenes) picker.add(new Option(name, name));
const requested = new URL(location.href).searchParams.get('scene');
picker.value = active.scenes.includes(requested) ? requested : active.defaultScene;
picker.addEventListener('change', () => renderScene(picker.value).catch(showError));

function showError(error) {
  sceneRoot.replaceChildren();
  const message = document.createElement('div');
  message.className = 'error';
  message.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  sceneRoot.append(message);
}

renderScene(picker.value).catch(showError);
