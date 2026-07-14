// Read-only loopback review server for an immutable U5 publication.
//
// The same surface is consumed by the Playwright render proof and the human
// comparison session: it serves the publication's derived `scenes/shell.js`,
// local Phaser 4.2.1, raster pack, and retained fonts without exposing the
// licensed Phaser Editor server or any mutable authoring endpoint.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { shellPresentationContractV2 } from '@fabrikav2/kernel';
import { status as publicationStatus } from './publish/status.ts';
import { computeManifestDigest, sha256, type PortableManifest } from './publish/manifest.ts';

export const REVIEW_STATES = ['menu', 'level', 'shop', 'settings', 'pause', 'win', 'fail'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

const CLASS_BY_STATE: Record<ReviewState, string> = {
  menu: 'Menu',
  level: 'Level',
  shop: 'Shop',
  settings: 'Settings',
  pause: 'Pause',
  win: 'Win',
  fail: 'Fail',
};

const DEFAULT_PHASER = fileURLToPath(new URL('../node_modules/phaser/dist/phaser.js', import.meta.url));

export interface ReviewServerOptions {
  publicationDir: string;
  port?: number;
  host?: '127.0.0.1';
  phaserScript?: string;
}

export interface ReviewServer {
  url: string;
  port: number;
  publicationId: string;
  close(): Promise<void>;
}

type SceneNode = Record<string, unknown> & { list?: SceneNode[] };
interface ExpectedSceneFacts {
  ids: string[];
  textures: Record<string, string | null>;
  bindings: Record<string, string>;
  allTextures: string[];
  actions: ReviewActionRect[];
}

type ReviewActionEffect = 'navigate' | 'settings-back' | 'toggle' | 'preview';

interface ReviewActionSpec {
  semanticId: string;
  binding: string;
  actionId: string;
  companionId: string;
  effect: ReviewActionEffect;
  targetState?: ReviewState;
}

interface InertSemanticSpec {
  semanticId: string;
  binding: string;
  hidden?: boolean;
}

export interface ReviewActionRect extends ReviewActionSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  authoredWidth: number;
  authoredHeight: number;
}

const ACTION_SPECS: Record<ReviewState, readonly ReviewActionSpec[]> = {
  menu: [
    { semanticId: 'menu.shop', binding: 'flow.open-shop', actionId: 'menu.shop', companionId: 'menu.fab.shop-control', effect: 'navigate', targetState: 'shop' },
    { semanticId: 'menu.play', binding: 'flow.start-current', actionId: 'play', companionId: 'menu.fab.play-control', effect: 'navigate', targetState: 'level' },
    { semanticId: 'menu.node.current', binding: 'flow.start-current', actionId: 'play', companionId: 'menu.fab.node-current-halo', effect: 'navigate', targetState: 'level' },
    { semanticId: 'menu.settings', binding: 'flow.open-settings', actionId: 'menu.settings', companionId: 'menu.fab.settings-control', effect: 'navigate', targetState: 'settings' },
  ],
  level: [
    { semanticId: 'level.pause', binding: 'flow.pause', actionId: 'pause', companionId: 'level.fab.pause-control', effect: 'navigate', targetState: 'pause' },
    { semanticId: 'level.test-win', binding: 'flow.test-win', actionId: 'test-win', companionId: 'level.fab.test-win-control', effect: 'navigate', targetState: 'win' },
    { semanticId: 'level.test-lose', binding: 'flow.test-lose', actionId: 'test-lose', companionId: 'level.fab.test-lose-control', effect: 'navigate', targetState: 'fail' },
  ],
  shop: [
    { semanticId: 'shop.back', binding: 'flow.shop-back', actionId: 'shop-back', companionId: 'shop.fab.back-control', effect: 'navigate', targetState: 'menu' },
    { semanticId: 'shop.restore', binding: 'commerce.restore', actionId: 'shop-restore', companionId: 'shop.fab.restore-control', effect: 'preview' },
  ],
  settings: [
    { semanticId: 'settings.back', binding: 'flow.settings-back', actionId: 'settings-back', companionId: 'settings.fab.back-control', effect: 'settings-back' },
    { semanticId: 'settings.music', binding: 'settings.music', actionId: 'settings.music', companionId: 'settings.fab.toggle-music-track', effect: 'toggle' },
    { semanticId: 'settings.sfx', binding: 'settings.sfx', actionId: 'settings.sfx', companionId: 'settings.fab.toggle-sfx-track', effect: 'toggle' },
    { semanticId: 'settings.haptics', binding: 'settings.haptics', actionId: 'settings.haptics', companionId: 'settings.fab.toggle-haptics-track', effect: 'toggle' },
  ],
  pause: [
    { semanticId: 'pause.resume', binding: 'flow.resume', actionId: 'resume', companionId: 'pause.fab.resume-control', effect: 'navigate', targetState: 'level' },
    { semanticId: 'pause.settings', binding: 'flow.open-settings', actionId: 'pause.settings', companionId: 'pause.fab.settings-control', effect: 'navigate', targetState: 'settings' },
    { semanticId: 'pause.home', binding: 'flow.pause-home', actionId: 'pause-home', companionId: 'pause.fab.home-control', effect: 'navigate', targetState: 'menu' },
  ],
  win: [
    { semanticId: 'win.claim', binding: 'flow.claim', actionId: 'win-claim', companionId: 'win.fab.claim-control', effect: 'preview' },
    { semanticId: 'win.claim-double', binding: 'flow.claim-double', actionId: 'win-claim-double', companionId: 'win.fab.claim-double-control', effect: 'preview' },
  ],
  fail: [
    { semanticId: 'fail.continue-coins', binding: 'flow.continue-coins', actionId: 'fail-continue-coins', companionId: 'fail.fab.continue-control', effect: 'preview' },
    { semanticId: 'fail.retry', binding: 'flow.retry', actionId: 'fail-retry', companionId: 'fail.fab.retry-control', effect: 'navigate', targetState: 'level' },
  ],
};

const INERT_SEMANTICS: Partial<Record<ReviewState, readonly InertSemanticSpec[]>> = {
  shop: [
    { semanticId: 'shop.item.available', binding: 'state.shop-items' },
    { semanticId: 'shop.item.owned', binding: 'state.shop-items' },
    { semanticId: 'shop.item.locked', binding: 'state.shop-items' },
  ],
  win: [
    { semanticId: 'win.next', binding: 'flow.next', hidden: true },
    { semanticId: 'win.home', binding: 'flow.result-home', hidden: true },
  ],
  fail: [
    { semanticId: 'fail.bundle', binding: 'commerce.bundle' },
  ],
};

const CANVAS = { width: 390, height: 844 } as const;
const MIN_ACTION_SIZE = 48;

interface IndexedSceneNode {
  raw: SceneNode;
  depth: number;
}

function indexSceneNodes(nodes: unknown): Map<string, IndexedSceneNode> {
  const byId = new Map<string, IndexedSceneNode>();
  const walk = (items: unknown, depth: number): void => {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const node = raw as SceneNode;
      if (typeof node['id'] === 'string' && node['id'].length > 0) {
        if (byId.has(node['id'])) throw new Error(`duplicate scene object id: ${node['id']}`);
        byId.set(node['id'], { raw: node, depth });
      }
      walk(node.list, depth + 1);
    }
  };
  walk(nodes, 0);
  return byId;
}

function finiteNumber(node: SceneNode, property: string, fallback?: number): number {
  const value = node[property];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`action companion has invalid ${property}`);
  }
  return value;
}

function actionRect(spec: ReviewActionSpec, indexed: IndexedSceneNode): ReviewActionRect {
  const node = indexed.raw;
  if (indexed.depth !== 0) throw new Error(`action companion ${spec.companionId} must be at scene root`);
  if (node['type'] !== 'Rectangle' || node['visible'] === false || node['isFilled'] !== true) {
    throw new Error(`action companion ${spec.companionId} is not a visible filled Rectangle`);
  }
  if (finiteNumber(node, 'rotation', 0) !== 0 || finiteNumber(node, 'angle', 0) !== 0) {
    throw new Error(`action companion ${spec.companionId} must be axis-aligned`);
  }
  const scaleX = finiteNumber(node, 'scaleX', 1);
  const scaleY = finiteNumber(node, 'scaleY', 1);
  if (scaleX <= 0 || scaleY <= 0) throw new Error(`action companion ${spec.companionId} has invalid scale`);
  const authoredWidth = finiteNumber(node, 'width') * scaleX;
  const authoredHeight = finiteNumber(node, 'height') * scaleY;
  if (authoredWidth <= 0 || authoredHeight <= 0) {
    throw new Error(`action companion ${spec.companionId} has invalid geometry`);
  }
  const originX = finiteNumber(node, 'originX', 0.5);
  const originY = finiteNumber(node, 'originY', 0.5);
  const authoredX = finiteNumber(node, 'x') + (0.5 - originX) * authoredWidth;
  const authoredY = finiteNumber(node, 'y') + (0.5 - originY) * authoredHeight;
  const width = Math.max(authoredWidth, MIN_ACTION_SIZE);
  const height = Math.max(authoredHeight, MIN_ACTION_SIZE);
  if (width > CANVAS.width || height > CANVAS.height) {
    throw new Error(`action companion ${spec.companionId} exceeds scene bounds`);
  }
  const x = Math.min(CANVAS.width - width / 2, Math.max(width / 2, authoredX));
  const y = Math.min(CANVAS.height - height / 2, Math.max(height / 2, authoredY));
  return { ...spec, x, y, width, height, authoredWidth, authoredHeight };
}

function rectanglesOverlap(a: ReviewActionRect, b: ReviewActionRect): boolean {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width
    && Math.abs(a.y - b.y) * 2 < a.height + b.height;
}

function validateActionSpecContract(): void {
  const contractActions = shellPresentationContractV2.instances
    .filter((instance) => typeof instance.actionId === 'string' && instance.actionId.length > 0)
    .map((instance) => ({
      state: instance.stateId,
      semanticId: instance.id,
      binding: instance.bindingId,
      actionId: instance.actionId!,
    }))
    .sort((a, b) => `${a.state}:${a.semanticId}`.localeCompare(`${b.state}:${b.semanticId}`));
  const reviewActions = REVIEW_STATES.flatMap((state) => ACTION_SPECS[state].map((spec) => ({
    state,
    semanticId: spec.semanticId,
    binding: spec.binding,
    actionId: spec.actionId,
  }))).sort((a, b) => `${a.state}:${a.semanticId}`.localeCompare(`${b.state}:${b.semanticId}`));
  if (JSON.stringify(contractActions) !== JSON.stringify(reviewActions)) {
    throw new Error('review action specification drifted from the kernel actionId union');
  }
}

/** Derive the closed review action union from manifest-sealed scene JSON only. */
export function deriveReviewActionRects(files: ReadonlyMap<string, Buffer>): Record<ReviewState, ReviewActionRect[]> {
  validateActionSpecContract();
  const actions = {} as Record<ReviewState, ReviewActionRect[]>;
  const actionBindings = new Set(REVIEW_STATES.flatMap((state) => ACTION_SPECS[state].map((spec) => spec.binding)));
  for (const state of REVIEW_STATES) {
    const rel = `source/scenes/${CLASS_BY_STATE[state]}.scene`;
    const bytes = files.get(rel);
    if (!bytes) throw new Error(`publication snapshot is missing ${rel}`);
    const scene = JSON.parse(bytes.toString('utf8')) as { displayList?: unknown };
    const nodes = indexSceneNodes(scene.displayList);
    const semanticNodes = new Map<string, SceneNode>();
    for (const { raw } of nodes.values()) {
      const semanticId = raw['Semantic.fabSemanticId'];
      if (typeof semanticId !== 'string' || semanticId.length === 0) continue;
      if (semanticNodes.has(semanticId)) throw new Error(`duplicate semantic id in ${state}: ${semanticId}`);
      semanticNodes.set(semanticId, raw);
    }

    const specs = ACTION_SPECS[state];
    const expectedIds = new Set(specs.map((spec) => spec.semanticId));
    for (const [semanticId, node] of semanticNodes) {
      const binding = node['Semantic.fabBinding'];
      if (typeof binding === 'string' && actionBindings.has(binding) && !expectedIds.has(semanticId)) {
        throw new Error(`unexpected action semantic in ${state}: ${semanticId}`);
      }
    }
    for (const inert of INERT_SEMANTICS[state] ?? []) {
      const node = semanticNodes.get(inert.semanticId);
      if (!node) throw new Error(`missing inert semantic in ${state}: ${inert.semanticId}`);
      if (node['Semantic.fabBinding'] !== inert.binding) {
        throw new Error(`${inert.semanticId} must carry binding ${inert.binding}`);
      }
      if (inert.hidden && node['visible'] !== false) {
        throw new Error(`${inert.semanticId} must remain hidden and inert`);
      }
    }

    const rects = specs.map((spec) => {
      const semantic = semanticNodes.get(spec.semanticId);
      if (!semantic) throw new Error(`missing action semantic in ${state}: ${spec.semanticId}`);
      if (semantic['Semantic.fabBinding'] !== spec.binding) {
        throw new Error(`${spec.semanticId} must carry binding ${spec.binding}`);
      }
      const companion = nodes.get(spec.companionId);
      if (!companion) throw new Error(`missing action companion in ${state}: ${spec.companionId}`);
      return actionRect(spec, companion);
    });
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        if (rectanglesOverlap(rects[i]!, rects[j]!)) {
          throw new Error(`overlapping action rectangles in ${state}: ${rects[i]!.semanticId} and ${rects[j]!.semanticId}`);
        }
      }
    }
    actions[state] = rects;
  }
  return actions;
}

function collectSceneFacts(
  nodes: unknown,
  out: Array<{ id: string; texture: string | null; binding: string }>,
  allTextures: Set<string>,
): void {
  if (!Array.isArray(nodes)) return;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as SceneNode;
    const semanticId = node['Semantic.fabSemanticId'];
    const texture = node['texture'];
    if (texture && typeof texture === 'object' && typeof (texture as { key?: unknown }).key === 'string') {
      allTextures.add(String((texture as { key: string }).key));
    }
    if (typeof semanticId === 'string' && semanticId.length > 0) {
      out.push({
        id: semanticId,
        binding: typeof node['Semantic.fabBinding'] === 'string' ? node['Semantic.fabBinding'] : '',
        texture: texture && typeof texture === 'object' && typeof (texture as { key?: unknown }).key === 'string'
          ? String((texture as { key: string }).key)
          : null,
      });
    }
    collectSceneFacts(node.list, out, allTextures);
  }
}

function expectedSemanticFacts(files: ReadonlyMap<string, Buffer>): Record<ReviewState, ExpectedSceneFacts> {
  const entries = {} as Record<ReviewState, ExpectedSceneFacts>;
  const actions = deriveReviewActionRects(files);
  for (const state of REVIEW_STATES) {
    const rel = `source/scenes/${CLASS_BY_STATE[state]}.scene`;
    const bytes = files.get(rel);
    if (!bytes) throw new Error(`publication snapshot is missing ${rel}`);
    const scene = JSON.parse(bytes.toString('utf8')) as { displayList?: unknown };
    const facts: Array<{ id: string; texture: string | null; binding: string }> = [];
    const allTextures = new Set<string>();
    collectSceneFacts(scene.displayList, facts, allTextures);
    if (facts.length === 0) throw new Error(`publication scene ${state} has no semantic objects`);
    facts.sort((a, b) => a.id.localeCompare(b.id));
    entries[state] = {
      ids: facts.map((fact) => fact.id),
      textures: Object.fromEntries(facts.map((fact) => [fact.id, fact.texture])),
      bindings: Object.fromEntries(facts.map((fact) => [fact.id, fact.binding])),
      allTextures: [...allTextures].sort(),
      actions: actions[state],
    };
  }
  return entries;
}

/** Snapshot and verify every manifest file before opening the listening socket. */
async function sealedSnapshot(publicationDir: string, manifest: PortableManifest): Promise<Map<string, Buffer>> {
  if (computeManifestDigest(manifest.files) !== manifest.digest) {
    throw new Error('publication manifest digest is invalid');
  }
  const files = new Map<string, Buffer>();
  for (const entry of manifest.files) {
    if (!entry.path || path.posix.isAbsolute(entry.path) || entry.path.split('/').includes('..') || files.has(entry.path)) {
      throw new Error(`invalid publication manifest path: ${entry.path}`);
    }
    const bytes = await readFile(path.join(publicationDir, ...entry.path.split('/')));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`publication changed while snapshotting: ${entry.path}`);
    }
    files.set(entry.path, bytes);
  }
  return files;
}

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  headers: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    ...headers,
  });
  res.end(body);
}

function sendCompressible(
  req: IncomingMessage,
  res: ServerResponse,
  type: string,
  body: Buffer,
  gzip: Buffer,
): void {
  const accepted = req.headers['accept-encoding'] ?? '';
  if (accepted.split(',').some((entry) => entry.trim().startsWith('gzip'))) {
    send(res, 200, type, gzip, { 'content-encoding': 'gzip', vary: 'accept-encoding' });
    return;
  }
  send(res, 200, type, body, { vary: 'accept-encoding' });
}

async function requiredFile(filePath: string): Promise<string> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`required review input is not a file: ${path.basename(filePath)}`);
  return filePath;
}

function reviewHtml(publicationId: string): string {
  const buttons = REVIEW_STATES.map(
    (state) => `<button type="button" data-state="${state}">${CLASS_BY_STATE[state]}</button>`,
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Fabrikav2 Phaser Publication Review</title>
  <style>
    @font-face { font-family: kenney_future; src: url('/fonts/kenney-future.ttf') format('truetype'); font-display: block; }
    @font-face { font-family: kenney_future_narrow; src: url('/fonts/kenney-future-narrow.ttf') format('truetype'); font-display: block; }
    :root { color-scheme: dark; font-family: kenney_future, system-ui, sans-serif; background: #0c0c13; color: #f8f7ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 50% 0%, #27233b 0, #0c0c13 55%); }
    header { position: sticky; top: 0; z-index: 3; padding: 12px; background: rgba(12, 12, 19, .94); border-bottom: 1px solid #39354b; backdrop-filter: blur(10px); }
    h1 { margin: 0 0 8px; font-size: 15px; letter-spacing: .04em; }
    #meta { color: #aaa5ba; font: 11px ui-monospace, SFMono-Regular, monospace; overflow-wrap: anywhere; }
    nav { display: flex; gap: 6px; margin-top: 10px; overflow-x: auto; padding-bottom: 2px; }
    button { flex: 0 0 auto; min-height: 40px; padding: 0 13px; border: 1px solid #4a455f; border-radius: 9px; background: #242033; color: #f8f7ff; font: inherit; cursor: pointer; }
    button[aria-pressed="true"] { background: #7559e8; border-color: #a995ff; }
    main { display: grid; place-items: start center; padding: 18px 12px 34px; }
    #phone { width: 390px; height: 844px; max-width: 100%; overflow: hidden; border: 1px solid #4a455f; border-radius: 26px; background: #171422; box-shadow: 0 28px 80px rgba(0,0,0,.55); }
    #game, #game canvas { width: 100% !important; height: 100% !important; display: block; }
    #status { margin: 12px auto 0; width: min(390px, 100%); color: #bcb6cc; font: 12px ui-monospace, SFMono-Regular, monospace; }
    #status[data-result="error"] { color: #ff909b; }
  </style>
</head>
<body>
  <header>
    <h1>Phaser publication review</h1>
    <div id="meta">${publicationId}</div>
    <nav aria-label="Shell state">${buttons}</nav>
  </header>
  <main>
    <div id="phone"><div id="game"></div></div>
    <div id="status" role="status">Loading local Phaser 4.2.1…</div>
  </main>
  <script src="/phaser.js"></script>
  <script type="module" src="/review.js"></script>
</body>
</html>
`;
}

function playerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Fabrikav2 Phaser Player</title>
  <style>
    @font-face { font-family: kenney_future; src: url('/fonts/kenney-future.ttf') format('truetype'); font-display: block; }
    @font-face { font-family: kenney_future_narrow; src: url('/fonts/kenney-future-narrow.ttf') format('truetype'); font-display: block; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #171422; }
    body {
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
      display: grid;
      place-items: center;
      container-type: size;
    }
    #stage {
      width: min(390px, 100cqw, 46.2085308057cqh);
      aspect-ratio: 390 / 844;
      overflow: hidden;
      background: #171422;
    }
    #game, #game canvas { width: 100% !important; height: 100% !important; display: block; }
  </style>
</head>
<body>
  <div id="stage"><div id="game"></div></div>
  <script src="/phaser.js"></script>
  <script type="module" src="/review.js"></script>
</body>
</html>
`;
}

function reviewScript(publicationId: string, expected: Record<ReviewState, ExpectedSceneFacts>): string {
  const stateJson = JSON.stringify(REVIEW_STATES);
  const classJson = JSON.stringify(CLASS_BY_STATE);
  const expectedJson = JSON.stringify(expected);
  const publicationJson = JSON.stringify(publicationId);
  return `import * as shell from '/shell.js';

const states = ${stateJson};
const classByState = ${classJson};
const expectedByState = ${expectedJson};
const publicationId = ${publicationJson};
const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('[data-state]')];

function reportStatus(result, message) {
  if (!status) return;
  status.dataset.result = result;
  status.textContent = message;
}

const review = {
  ready: false,
  error: null,
  publicationId,
  currentState: null,
  semanticIds: [],
  semanticFacts: [],
  expectedByState,
  activeActionRects: [],
  lastAction: null,
  settingsOrigin: 'menu',
  toggleState: {
    'settings.music': true,
    'settings.sfx': true,
    'settings.haptics': true,
  },
  transitioning: false,
  game: null,
  setState: async () => { throw new Error('review is not ready'); },
};
globalThis.__FABRIKA_PHASER_REVIEW__ = review;

function semanticFacts(scene) {
  const facts = [];
  const walk = (items) => {
    for (const item of items ?? []) {
      const semantic = item?.__Semantic;
      if (semantic?.fabSemanticId) {
        facts.push({
          id: semantic.fabSemanticId,
          x: item.x,
          y: item.y,
          visible: item.visible,
          text: typeof item.text === 'string' ? item.text : null,
          texture: item.texture?.key ?? null,
          binding: semantic.fabBinding ?? '',
        });
      }
      if (Array.isArray(item?.list)) walk(item.list);
    }
  };
  walk(scene?.children?.list);
  return facts.sort((a, b) => a.id.localeCompare(b.id));
}

async function waitForState(state) {
  const key = classByState[state];
  const expected = expectedByState[state];
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    const scene = review.game.scene.getScene(key);
    const facts = semanticFacts(scene);
    const ids = facts.map((fact) => fact.id);
    const texturesReady = facts.every((fact) => {
      const texture = expected.textures[fact.id];
      return texture === null || texture === fact.texture;
    }) && expected.allTextures.every((key) => review.game.textures.exists(key));
    const bindingsReady = facts.every((fact) => expected.bindings[fact.id] === fact.binding);
    if (scene?.sys?.isActive?.() && expected.ids.every((id) => ids.includes(id)) && texturesReady && bindingsReady) return facts;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('state did not become semantically ready: ' + state);
}

let actionZones = [];
let toggleOverlays = [];
let transientObjects = [];
let transientTimer = null;

function destroyObjects(objects) {
  for (const object of objects.splice(0)) object?.destroy?.();
}

function clearActionZones() {
  destroyObjects(actionZones);
  review.activeActionRects = [];
}

function clearTransient() {
  transientTimer?.remove?.(false);
  transientTimer = null;
  destroyObjects(transientObjects);
}

function clearToggleOverlays() {
  destroyObjects(toggleOverlays);
}

function showAcknowledgement(message) {
  clearTransient();
  const scene = review.game.scene.getScene(classByState[review.currentState]);
  const card = scene.add.rectangle(195, 92, 340, 52, 0x173042, 0.96);
  card.setRounded?.(16);
  card.setDepth(9998);
  const label = scene.add.text(195, 92, message, {
    color: '#ffffff',
    fontFamily: 'kenney_future_narrow',
    fontSize: '14px',
    align: 'center',
    wordWrap: { width: 316 },
  });
  label.setOrigin(0.5, 0.5);
  label.setDepth(9999);
  transientObjects.push(card, label);
  reportStatus('ok', message);
  transientTimer = scene.time.delayedCall(1400, () => {
    destroyObjects(transientObjects);
    transientTimer = null;
    reportStatus('ok', classByState[review.currentState] + ' ready · ' + review.semanticIds.length + ' semantic objects');
  });
}

function renderToggleOverlays() {
  clearToggleOverlays();
  if (review.currentState !== 'settings') return;
  const scene = review.game.scene.getScene(classByState.settings);
  for (const action of expectedByState.settings.actions.filter((entry) => entry.effect === 'toggle')) {
    const enabled = review.toggleState[action.semanticId] !== false;
    const track = scene.add.rectangle(
      action.x,
      action.y,
      action.authoredWidth,
      action.authoredHeight,
      enabled ? 0x2f9f75 : 0x9aabb0,
      1,
    );
    track.setRounded?.(action.authoredHeight / 2);
    track.setDepth(9996);
    const thumbSize = Math.min(22, action.authoredHeight - 8);
    const travel = action.authoredWidth / 2 - thumbSize / 2 - 4;
    const thumb = scene.add.rectangle(action.x + (enabled ? travel : -travel), action.y, thumbSize, thumbSize, 0xffffff, 1);
    thumb.setRounded?.(thumbSize / 2);
    thumb.setDepth(9997);
    toggleOverlays.push(track, thumb);
  }
}

const previewMessages = {
  'shop.restore': 'Preview only · Restore was not sent',
  'win.claim': 'Preview only · Reward was not claimed',
  'win.claim-double': 'Preview only · Ad was not started',
  'fail.continue-coins': 'Preview only · Coins were not spent',
};

async function performAction(action) {
  if (review.transitioning || review.currentState === null) return;
  review.transitioning = true;
  const sourceState = review.currentState;
  try {
    if (action.effect === 'navigate') {
      review.lastAction = {
        semanticId: action.semanticId,
        binding: action.binding,
        actionId: action.actionId,
        sourceState,
        targetState: action.targetState,
        outcome: 'navigated',
      };
      await setState(action.targetState, {
        settingsOrigin: action.targetState === 'settings' && sourceState === 'pause' ? 'pause' : 'menu',
      });
      return;
    }
    if (action.effect === 'settings-back') {
      const targetState = review.settingsOrigin === 'pause' ? 'pause' : 'menu';
      review.lastAction = {
        semanticId: action.semanticId,
        binding: action.binding,
        actionId: action.actionId,
        sourceState,
        targetState,
        outcome: 'navigated',
      };
      await setState(targetState);
      return;
    }
    if (action.effect === 'toggle') {
      const enabled = review.toggleState[action.semanticId] === false;
      review.toggleState[action.semanticId] = enabled;
      review.lastAction = {
        semanticId: action.semanticId,
        binding: action.binding,
        actionId: action.actionId,
        sourceState,
        targetState: sourceState,
        outcome: 'ephemeral-toggle',
        enabled,
      };
      renderToggleOverlays();
      showAcknowledgement(action.semanticId.split('.')[1] + ' preview · ' + (enabled ? 'On' : 'Off'));
      return;
    }
    review.lastAction = {
      semanticId: action.semanticId,
      binding: action.binding,
      actionId: action.actionId,
      sourceState,
      targetState: sourceState,
      outcome: 'preview-only',
      sdkExecuted: false,
    };
    showAcknowledgement(previewMessages[action.semanticId] ?? 'Preview only · No SDK action was sent');
  } finally {
    review.transitioning = false;
  }
}

function installActionZones(state) {
  clearActionZones();
  const scene = review.game.scene.getScene(classByState[state]);
  const actions = expectedByState[state].actions;
  for (const action of actions) {
    const zone = scene.add.zone(action.x, action.y, action.width, action.height);
    zone.setOrigin(0.5, 0.5);
    zone.setDepth(10000);
    zone.setInteractive({ useHandCursor: true });
    zone.on('pointerup', () => void performAction(action));
    actionZones.push(zone);
  }
  review.activeActionRects = actions.map((action) => ({ ...action }));
}

async function setState(state, options = {}) {
  if (!states.includes(state)) throw new Error('unknown shell state: ' + state);
  const previousState = review.currentState;
  if (state === 'settings') {
    review.settingsOrigin = options.settingsOrigin === 'pause' || previousState === 'pause' ? 'pause' : 'menu';
  }
  clearActionZones();
  clearTransient();
  clearToggleOverlays();
  for (const other of states) {
    const key = classByState[other];
    if (review.game.scene.isActive(key)) review.game.scene.stop(key);
  }
  review.game.scene.start(classByState[state]);
  const facts = await waitForState(state);
  review.currentState = state;
  review.semanticIds = facts.map((fact) => fact.id);
  review.semanticFacts = facts;
  location.hash = state;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.state === state));
  renderToggleOverlays();
  installActionZones(state);
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  reportStatus('ok', classByState[state] + ' ready · ' + facts.length + ' semantic objects');
  return facts;
}

try {
  if (!globalThis.Phaser?.VERSION?.startsWith('4.2.1')) throw new Error('local Phaser 4.2.1 did not load');
  if (JSON.stringify(shell.states) !== JSON.stringify(states)) throw new Error('publication state registry drift');
  for (const state of states) if (typeof shell.scenes?.[state] !== 'function') throw new Error('missing scene class: ' + state);
  await Promise.all([
    document.fonts.load('28px kenney_future'),
    document.fonts.load('28px kenney_future_narrow'),
  ]);
  if (!document.fonts.check('28px kenney_future') || !document.fonts.check('28px kenney_future_narrow')) {
    throw new Error('publication fonts did not load');
  }
  review.game = shell.boot({ parent: 'game', backgroundColor: '#171422', render: { antialias: true } });
  review.setState = setState;
  const requested = location.hash.slice(1);
  const initialState = states.includes(requested) ? requested : 'menu';
  if (initialState !== 'menu') await waitForState('menu');
  await setState(initialState);
  review.ready = true;
  for (const button of buttons) button.addEventListener('click', () => void setState(button.dataset.state));
} catch (error) {
  review.error = error instanceof Error ? error.message : String(error);
  reportStatus('error', review.error);
  throw error;
}
`;
}

/** Start a static, mutation-free review surface bound strictly to loopback. */
export async function startReviewServer(options: ReviewServerOptions): Promise<ReviewServer> {
  const publicationDir = path.resolve(options.publicationDir);
  const verified = await publicationStatus(publicationDir);
  if (verified.outcome !== 'ready') {
    throw new Error(`publication is not immutable-ready: ${verified.outcome}`);
  }
  const manifestPath = await requiredFile(path.join(publicationDir, 'manifest.json'));
  const phaserPath = await requiredFile(options.phaserScript ?? DEFAULT_PHASER);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as PortableManifest;
  if (typeof manifest.publicationId !== 'string' || !/^sha256-[0-9a-f]{64}$/.test(manifest.publicationId)) {
    throw new Error('publication manifest has no valid publicationId');
  }
  const snapshot = await sealedSnapshot(publicationDir, manifest);
  const verifiedAfterSnapshot = await publicationStatus(publicationDir);
  const manifestAfterSnapshot = await readFile(manifestPath);
  if (verifiedAfterSnapshot.outcome !== 'ready' || !manifestAfterSnapshot.equals(manifestBytes)) {
    throw new Error('publication changed while opening the review server');
  }
  const expected = expectedSemanticFacts(snapshot);
  const publicationId = manifest.publicationId;
  const phaserBytes = await readFile(phaserPath);
  const phaserGzip = gzipSync(phaserBytes, { level: 9 });
  const shellBytes = snapshot.get('projection/scenes/shell.js')!;
  const shellGzip = gzipSync(shellBytes, { level: 9 });
  const reviewPage = reviewHtml(publicationId);
  const playerPage = playerHtml();
  const client = reviewScript(publicationId, expected);

  const server: Server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed\n');
      if (pathname === '/' || pathname === '/review' || pathname === '/review/') {
        return send(res, 200, 'text/html; charset=utf-8', reviewPage);
      }
      if (pathname === '/player' || pathname === '/player/') {
        return send(res, 200, 'text/html; charset=utf-8', playerPage);
      }
      if (pathname === '/review.js') return send(res, 200, 'text/javascript; charset=utf-8', client);
      if (pathname === '/phaser.js') {
        return sendCompressible(req, res, 'text/javascript; charset=utf-8', phaserBytes, phaserGzip);
      }
      if (pathname === '/shell.js') {
        return sendCompressible(req, res, 'text/javascript; charset=utf-8', shellBytes, shellGzip);
      }
      if (pathname === '/asset-pack.json') return send(res, 200, 'application/json; charset=utf-8', snapshot.get('projection/asset-pack.json')!);
      if (pathname === '/scene-manifest.json') return send(res, 200, 'application/json; charset=utf-8', snapshot.get('projection/scene-manifest.json')!);
      if (pathname === '/health.json') {
        return send(res, 200, 'application/json; charset=utf-8', `${JSON.stringify({ ok: true, publicationId })}\n`);
      }
      const asset = /^\/assets\/([A-Za-z0-9._-]+\.png)$/.exec(pathname);
      if (asset) {
        const bytes = snapshot.get(`projection/assets/${asset[1]}`);
        return bytes ? send(res, 200, 'image/png', bytes) : send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
      }
      const font = /^\/fonts\/(kenney-future(?:-narrow)?\.ttf)$/.exec(pathname);
      if (font) {
        const bytes = snapshot.get(`source/public/fonts/${font[1]}`);
        return bytes ? send(res, 200, 'font/ttf', bytes) : send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
      }
      return send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
    } catch {
      return send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
    }
  });

  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('review server did not bind a TCP port');
  }
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    publicationId,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
