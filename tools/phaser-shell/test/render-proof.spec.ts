// Offline real-browser proof for the immutable U5 Phaser publications.
//
// This is deliberately the same read-only review surface Batu receives: local
// Phaser 4.2.1 loads the source-derived `scenes/shell.js`, drives every state,
// verifies the exact semantic object set, decoded textures, and retained fonts,
// then captures one 390x844 canvas reference per state. No accepted input means
// a failing gate, never a skip or a synthetic substitute.
import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReviewServer, REVIEW_STATES } from '../src/reviewServer.ts';
import { parseAcceptedHandoff, validateAcceptedHandoff, type HandoffRole } from '../src/publish/handoff.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTHORING = path.join(REPO_ROOT, 'games', 'shell_proof_phaser', 'authoring');
const PUBLICATIONS = path.join(AUTHORING, 'publications');
const ACCEPTED = path.join(PUBLICATIONS, 'accepted.json');

interface InputPublication {
  role: HandoffRole | 'manual';
  publicationId: string;
  dir: string;
}

function inputs(): InputPublication[] {
  const override = process.env.U5_PUBLICATION_DIR;
  if (override) {
    const dir = path.resolve(override);
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { publicationId: string };
    return [{ role: 'manual', publicationId: manifest.publicationId, dir }];
  }
  if (!existsSync(ACCEPTED)) return [];
  const handoff = parseAcceptedHandoff(JSON.parse(readFileSync(ACCEPTED, 'utf8')));
  return (['p0', 'a', 'b'] as const).map((role) => ({
    role,
    publicationId: handoff.roles[role].publicationId,
    dir: path.join(PUBLICATIONS, handoff.roles[role].publicationId),
  }));
}

const publications = inputs();

test.describe('U5 immutable Phaser publication render proof', () => {
  test('the accepted P0/A/B handoff is present and byte-bound', async () => {
    if (process.env.U5_PUBLICATION_DIR) {
      expect(publications).toHaveLength(1);
      return;
    }
    expect(existsSync(ACCEPTED), 'accepted.json must exist before the U5 render gate runs').toBe(true);
    const handoff = parseAcceptedHandoff(JSON.parse(readFileSync(ACCEPTED, 'utf8')));
    expect(await validateAcceptedHandoff(handoff, PUBLICATIONS)).toEqual([]);
    expect(new Set(publications.map((entry) => entry.publicationId)).size).toBe(3);
  });

  test('direct non-menu hash boots do not load the shared texture pack concurrently', async ({ page }) => {
    const publication = publications[0];
    expect(publication, 'a publication is required for the direct-state startup proof').toBeDefined();
    const server = await startReviewServer({ publicationDir: publication.dir });
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));

    try {
      for (const pathname of ['/', '/player']) {
        browserErrors.length = 0;
        await page.goto(`${server.url}${pathname}#win`, { waitUntil: 'load' });
        await page.waitForFunction(() => {
          const review = (globalThis as typeof globalThis & {
            __FABRIKA_PHASER_REVIEW__?: { ready: boolean; error: string | null; currentState: string | null };
          }).__FABRIKA_PHASER_REVIEW__;
          if (review?.error) throw new Error(review.error);
          return review?.ready === true && review.currentState === 'win';
        });

        expect(browserErrors, `${pathname} direct-state startup errors`).toEqual([]);
      }
    } finally {
      await server.close();
    }
  });

  for (const publication of publications) {
    test(`${publication.role} renders all seven states from ${publication.publicationId}`, async ({ page }, testInfo) => {
      const server = await startReviewServer({ publicationDir: publication.dir });
      const browserErrors: string[] = [];
      const nonLoopbackRequests: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('request', (request) => {
        const url = new URL(request.url());
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') {
          nonLoopbackRequests.push(request.url());
        }
      });

      try {
        await page.setViewportSize({ width: 760, height: 1040 });
        await page.goto(server.url, { waitUntil: 'load' });
        await page.waitForFunction(() => {
          const review = (globalThis as typeof globalThis & {
            __FABRIKA_PHASER_REVIEW__?: { ready: boolean; error: string | null };
          }).__FABRIKA_PHASER_REVIEW__;
          if (review?.error) throw new Error(review.error);
          return review?.ready === true;
        });

        expect(server.publicationId).toBe(publication.publicationId);
        expect(await page.evaluate(() => (globalThis as typeof globalThis & { Phaser: { VERSION: string } }).Phaser.VERSION))
          .toBe('4.2.1');
        expect(await page.evaluate(() => Promise.all([
          document.fonts.check('28px kenney_future'),
          document.fonts.check('28px kenney_future_narrow'),
        ]))).toEqual([true, true]);

        for (const state of REVIEW_STATES) {
          await test.step(state, async () => {
            const proof = await page.evaluate(async (nextState) => {
              const review = (globalThis as typeof globalThis & {
                __FABRIKA_PHASER_REVIEW__: {
                  setState(state: string): Promise<Array<{ id: string; texture: string | null }>>;
                  expectedByState: Record<string, { ids: string[]; textures: Record<string, string | null>; allTextures: string[] }>;
                  currentState: string;
                  game: {
                    scene: {
                      getScenes(activeOnly: boolean): Array<{
                        children?: { list?: unknown[] };
                      }>;
                    };
                    textures: {
                      exists(key: string): boolean;
                      get(key: string): { getSourceImage(): { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } };
                    };
                  };
                };
              }).__FABRIKA_PHASER_REVIEW__;
              const facts = await review.setState(nextState);
              const expectedTextures = review.expectedByState[nextState].textures;
              const decoded = facts
                .filter((fact) => expectedTextures[fact.id] !== null)
                .map((fact) => {
                  const key = fact.texture!;
                  const exists = review.game.textures.exists(key);
                  const image = exists ? review.game.textures.get(key).getSourceImage() : null;
                  return {
                    key,
                    expectedKey: expectedTextures[fact.id],
                    exists,
                    width: image?.naturalWidth ?? image?.width ?? 0,
                    height: image?.naturalHeight ?? image?.height ?? 0,
                  };
                });
              const allDecoded = review.expectedByState[nextState].allTextures.map((key) => {
                const exists = review.game.textures.exists(key);
                const image = exists ? review.game.textures.get(key).getSourceImage() : null;
                return {
                  key,
                  exists,
                  width: image?.naturalWidth ?? image?.width ?? 0,
                  height: image?.naturalHeight ?? image?.height ?? 0,
                };
              });
              const visibleTextFonts: Array<{ label: string; fontFamily: string | null }> = [];
              const visited = new Set<object>();
              const walkVisible = (items: unknown[] | undefined, ancestorsVisible = true) => {
                for (const raw of items ?? []) {
                  if (!raw || typeof raw !== 'object' || visited.has(raw)) continue;
                  visited.add(raw);
                  const item = raw as {
                    type?: string;
                    visible?: boolean;
                    name?: string;
                    text?: string;
                    style?: { fontFamily?: unknown };
                    list?: unknown[];
                    __Semantic?: { fabSemanticId?: string };
                  };
                  const visible = ancestorsVisible && item.visible !== false;
                  if (visible && item.type === 'Text') {
                    visibleTextFonts.push({
                      label: item.__Semantic?.fabSemanticId || item.name || item.text || '(unnamed Text)',
                      fontFamily: typeof item.style?.fontFamily === 'string' ? item.style.fontFamily : null,
                    });
                  }
                  walkVisible(item.list, visible);
                }
              };
              for (const scene of review.game.scene.getScenes(true)) walkVisible(scene.children?.list);
              return {
                currentState: review.currentState,
                ids: facts.map((fact) => fact.id).sort(),
                expected: [...review.expectedByState[nextState].ids].sort(),
                decoded,
                allDecoded,
                visibleTextFonts,
              };
            }, state);

            expect(proof.currentState).toBe(state);
            expect(proof.ids).toEqual(proof.expected);
            for (const texture of proof.decoded) {
              expect(texture.key, `${state}:${texture.expectedKey} bound key`).toBe(texture.expectedKey);
              expect(texture.exists, `${state}:${texture.key} exists`).toBe(true);
              expect(texture.width, `${state}:${texture.key} decoded width`).toBeGreaterThan(0);
              expect(texture.height, `${state}:${texture.key} decoded height`).toBeGreaterThan(0);
            }
            for (const texture of proof.allDecoded) {
              expect(texture.exists, `${state}:${texture.key} exists`).toBe(true);
              expect(texture.width, `${state}:${texture.key} decoded width`).toBeGreaterThan(0);
              expect(texture.height, `${state}:${texture.key} decoded height`).toBeGreaterThan(0);
            }
            expect(proof.visibleTextFonts.length, `${state} visible Phaser Text objects`).toBeGreaterThan(0);
            expect(
              proof.visibleTextFonts.filter(({ fontFamily }) => (
                fontFamily !== 'kenney_future' && fontFamily !== 'kenney_future_narrow'
              )),
              `${state} visible Phaser Text objects must use a retained Kenney font`,
            ).toEqual([]);

            const refRoot = process.env.U5_CAPTURE_REFS === '1'
              ? path.join(AUTHORING, 'refs', 'authoring', publication.publicationId)
              : testInfo.outputPath(publication.publicationId);
            mkdirSync(refRoot, { recursive: true });
            await page.locator('#phone').screenshot({ path: path.join(refRoot, `${state}.png`) });
          });
        }

        expect(nonLoopbackRequests).toEqual([]);
        expect(browserErrors).toEqual([]);
      } finally {
        await server.close();
      }
    });
  }
});
