const picker = document.querySelector('#scene-picker');
const sceneRoot = document.querySelector('#scene');
const revisionNode = document.querySelector('#revision');
const device = document.querySelector('.device');

const active = await fetch('./active.json', { cache: 'no-store' }).then((response) => {
  if (!response.ok) throw new Error(`Preview is unpublished (${response.status}). Run tools.mjs publish.`);
  return response.json();
});
const revision = await fetch(`${active.publication}/revision.json`, { cache: 'no-store' }).then((response) => response.json());
const assetManifest = await fetch(`${active.publication}/source/project/public/assets/asset-manifest.json`).then((response) => response.json());
const assets = new Map(assetManifest.assets.map((asset) => [asset.key, asset]));
const publicRoot = `${active.publication}/source/project/public/`;

document.documentElement.style.setProperty('--fredoka-url', `url(${publicRoot}assets/fonts/FredokaOne.woff2)`);
document.documentElement.style.setProperty('--titan-url', `url(${publicRoot}assets/fonts/TitanOne.ttf)`);
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
    place(element, object);
  } else if (object.type === 'Image') {
    const asset = assets.get(object.texture?.key);
    if (!asset) throw new Error(`Unpublished texture ${object.texture?.key}`);
    element = document.createElement('img');
    element.className = 'object image';
    element.src = `${publicRoot}${asset.url}`;
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
  const response = await fetch(`${active.publication}/source/project/src/scenes/${name}.scene`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Scene ${name} missing from ${active.revision}`);
  const scene = await response.json();
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
