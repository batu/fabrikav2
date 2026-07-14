import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { get, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { publish } from '../src/publish/publish.ts';
import {
  deriveReviewActionRects,
  startReviewServer,
  type ReviewServer,
} from '../src/reviewServer.ts';
import { loadPublishInput } from './gen.ts';

const roots: string[] = [];
const servers: ReviewServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function requestBuffer(
  url: string,
  headers: OutgoingHttpHeaders = {},
): Promise<{ status: number; body: Buffer; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    get(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks),
        headers: response.headers,
      }));
    }).once('error', reject);
  });
}

async function requestText(url: string): Promise<{ status: number; body: string }> {
  const response = await requestBuffer(url);
  return { status: response.status, body: response.body.toString('utf8') };
}

function sceneSnapshot(root: string): Map<string, Buffer> {
  const input = loadPublishInput(root);
  return new Map([...input.scenes.entries()].map(([state, scene]) => [
    `source/scenes/${state[0]!.toUpperCase()}${state.slice(1)}.scene`,
    scene.sceneBytes,
  ]));
}

function mutateScene(
  files: Map<string, Buffer>,
  name: string,
  mutate: (displayList: Array<Record<string, unknown>>) => void,
): void {
  const rel = `source/scenes/${name}.scene`;
  const raw = JSON.parse(files.get(rel)!.toString('utf8')) as { displayList: Array<Record<string, unknown>> };
  mutate(raw.displayList);
  files.set(rel, Buffer.from(JSON.stringify(raw), 'utf8'));
}

function findById(
  items: Array<Record<string, unknown>>,
  id: string,
): Record<string, unknown> | undefined {
  for (const item of items) {
    if (item['id'] === id) return item;
    const nested = Array.isArray(item['list'])
      ? findById(item['list'] as Array<Record<string, unknown>>, id)
      : undefined;
    if (nested) return nested;
  }
  return undefined;
}

describe('immutable publication review server routes', () => {
  it('keeps reviewer controls at / and serves only the 390x844 game surface at /player', { timeout: 30_000 }, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'u5-review-route-'));
    roots.push(root);
    const publication = await publish(loadPublishInput(root));
    expect(publication.result).toBe('ok');

    const server = await startReviewServer({ publicationDir: publication.dir! });
    servers.push(server);

    const reviewer = await requestText(`${server.url}/`);
    expect(reviewer.status).toBe(200);
    expect(reviewer.body).toContain('<header>');
    expect(reviewer.body).toContain('<nav aria-label="Shell state">');
    expect(reviewer.body).toContain(`<div id="meta">${server.publicationId}</div>`);
    expect(reviewer.body).toContain('<div id="status" role="status">');

    const player = await requestText(`${server.url}/player`);
    expect(player.status).toBe(200);
    expect(player.body).toContain('<div id="stage"><div id="game"></div></div>');
    expect(player.body).toContain('height: 100dvh;');
    expect(player.body).toContain('container-type: size;');
    expect(player.body).toContain('padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);');
    expect(player.body).toContain('width: min(390px, 100cqw, 46.2085308057cqh);');
    expect(player.body).toContain('aspect-ratio: 390 / 844;');
    expect(player.body).toContain('#game, #game canvas { width: 100% !important; height: 100% !important;');
    expect(player.body).not.toContain('html, body { margin: 0; width: 390px; height: 844px;');
    expect(player.body).not.toContain('<header>');
    expect(player.body).not.toContain('<nav');
    expect(player.body).not.toContain('data-state=');
    expect(player.body).not.toContain('id="meta"');
    expect(player.body).not.toContain('id="status"');
    expect(player.body).not.toContain('id="phone"');
    expect(player.body).not.toContain(server.publicationId);

    const playerSlash = await requestText(`${server.url}/player/`);
    expect(playerSlash).toEqual(player);

    const namedReviewer = await requestText(`${server.url}/review`);
    expect(namedReviewer).toEqual(reviewer);

    const compressedPhaser = await requestBuffer(`${server.url}/phaser.js`, {
      'accept-encoding': 'gzip',
    });
    expect(compressedPhaser.status).toBe(200);
    expect(compressedPhaser.headers['content-encoding']).toBe('gzip');
    expect(compressedPhaser.headers['vary']).toBe('accept-encoding');
    expect(gunzipSync(compressedPhaser.body).toString('utf8')).toContain('Phaser');

    const compressedShell = await requestBuffer(`${server.url}/shell.js`, {
      'accept-encoding': 'br, gzip',
    });
    expect(compressedShell.status).toBe(200);
    expect(compressedShell.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(compressedShell.body).toString('utf8')).toContain('class Menu');
  });
});

describe('sealed review action rectangles', () => {
  it('derives only contract actions from authored companion rectangles and expands narrow toggles', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'u5-review-actions-'));
    roots.push(root);
    const actions = deriveReviewActionRects(sceneSnapshot(root));

    expect(Object.fromEntries(Object.entries(actions).map(([state, rects]) => [state, rects.length]))).toEqual({
      menu: 4,
      level: 3,
      shop: 2,
      settings: 4,
      pause: 3,
      win: 2,
      fail: 2,
    });
    expect(actions.settings.find(({ semanticId }) => semanticId === 'settings.music')).toMatchObject({
      binding: 'settings.music',
      actionId: 'settings.music',
      companionId: 'settings.fab.toggle-music-track',
      width: 58,
      height: 48,
    });
    expect(actions.fail.map(({ semanticId }) => semanticId)).not.toContain('fail.bundle');
    expect(actions.win.map(({ semanticId }) => semanticId)).not.toEqual(expect.arrayContaining(['win.next', 'win.home']));
    expect(actions.shop.map(({ semanticId }) => semanticId)).not.toEqual(expect.arrayContaining([
      'shop.item.available',
      'shop.item.owned',
      'shop.item.locked',
    ]));
    for (const rects of Object.values(actions)) {
      for (const rect of rects) {
        expect(rect.width).toBeGreaterThanOrEqual(48);
        expect(rect.height).toBeGreaterThanOrEqual(48);
      }
    }
  });

  it('fails closed on a mismatched binding or missing authored companion', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'u5-review-actions-invalid-'));
    roots.push(root);
    const mismatch = sceneSnapshot(root);
    mutateScene(mismatch, 'Menu', (items) => {
      findById(items, 'menu.play')!['Semantic.fabBinding'] = 'flow.open-shop';
    });
    expect(() => deriveReviewActionRects(mismatch)).toThrow(/menu\.play.*flow\.start-current/);

    const missing = sceneSnapshot(root);
    mutateScene(missing, 'Menu', (items) => {
      const index = items.findIndex((item) => item['id'] === 'menu.fab.play-control');
      items.splice(index, 1);
    });
    expect(() => deriveReviewActionRects(missing)).toThrow(/menu\.fab\.play-control/);
  });

  it('fails closed on unexpected action semantics and overlapping expanded rectangles', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'u5-review-actions-ambiguous-'));
    roots.push(root);
    const extra = sceneSnapshot(root);
    mutateScene(extra, 'Menu', (items) => {
      const clone = structuredClone(findById(items, 'menu.play')!);
      clone['id'] = 'menu.unexpected';
      clone['Semantic.fabSemanticId'] = 'menu.unexpected';
      items.push(clone);
    });
    expect(() => deriveReviewActionRects(extra)).toThrow(/unexpected action semantic.*menu\.unexpected/);

    const overlap = sceneSnapshot(root);
    mutateScene(overlap, 'Menu', (items) => {
      const settings = findById(items, 'menu.fab.settings-control')!;
      settings['x'] = 195;
      settings['y'] = 754;
    });
    expect(() => deriveReviewActionRects(overlap)).toThrow(/overlapping action rectangles.*menu\.play.*menu\.settings/);
  });
});
