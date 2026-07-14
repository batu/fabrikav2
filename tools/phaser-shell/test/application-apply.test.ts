import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ApplicationError,
  applyPublication,
  preflightPublication,
  readSelectedProjection,
} from '../src/application/projector.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const publicationRoot = path.join(repoRoot, 'games/shell_proof_phaser/authoring/publications');
const accepted = JSON.parse(await readFile(path.join(publicationRoot, 'accepted.json'), 'utf8')) as {
  roles: Record<'p0' | 'a' | 'b', { publicationId: string }>;
};
const temporaryRoots: string[] = [];

async function tempGame(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-apply-'));
  temporaryRoots.push(root);
  return root;
}

async function tempPublications(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phaser-publications-'));
  temporaryRoots.push(root);
  await cp(publicationRoot, root, { recursive: true });
  return root;
}

async function snapshot(root: string): Promise<Array<[string, string, number]>> {
  const result: Array<[string, string, number]> = [];
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target, relative);
      else if (entry.isFile()) result.push([relative, await readFile(target, 'hex'), (await stat(target)).mtimeMs]);
    }
  }
  await walk(root);
  return result.sort(([left], [right]) => left.localeCompare(right));
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('phaser-native immutable application', () => {
  it('applies distinct accepted P0, A, and B projections and makes the second B a true filesystem no-op', async () => {
    const gameRoot = await tempGame();
    const common = { publicationRoot, gameRoot };

    const p0 = await applyPublication({ ...common, publicationId: accepted.roles.p0.publicationId });
    const a = await applyPublication({ ...common, publicationId: accepted.roles.a.publicationId });
    const b = await applyPublication({ ...common, publicationId: accepted.roles.b.publicationId });
    expect(p0).toMatchObject({ outcome: 'applied', publicationId: accepted.roles.p0.publicationId });
    expect(a).toMatchObject({ outcome: 'applied', publicationId: accepted.roles.a.publicationId });
    expect(b).toMatchObject({ outcome: 'applied', publicationId: accepted.roles.b.publicationId });
    expect(new Set([p0.projectionId, a.projectionId, b.projectionId]).size).toBe(3);

    const before = await snapshot(path.join(gameRoot, 'design'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondB = await applyPublication({ ...common, publicationId: accepted.roles.b.publicationId });
    expect(secondB).toMatchObject({ outcome: 'no-op', projectionId: b.projectionId });
    expect(await snapshot(path.join(gameRoot, 'design'))).toEqual(before);

    await expect(readSelectedProjection(common)).resolves.toEqual({
      state: 'selected',
      projectionId: b.projectionId,
      publicationId: accepted.roles.b.publicationId,
    });
  });

  it('preflights without writing and rejects non-accepted or unsupported intent', async () => {
    const gameRoot = await tempGame();
    const common = { publicationRoot, gameRoot };
    await expect(preflightPublication({ ...common, publicationId: accepted.roles.p0.publicationId })).resolves.toMatchObject({
      outcome: 'applied',
      publicationId: accepted.roles.p0.publicationId,
    });
    await expect(stat(path.join(gameRoot, 'design'))).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(preflightPublication({ ...common, publicationId: `sha256-${'0'.repeat(64)}` })).rejects.toMatchObject({
      outcome: 'invalid-revision',
    });
    await expect(preflightPublication({
      ...common,
      publicationId: accepted.roles.p0.publicationId,
      rendererProfile: 'dom-css',
    })).rejects.toMatchObject({ outcome: 'unsupported-intent' });
  });

  it('blocks selected-byte drift and preserves the active pointer', async () => {
    const gameRoot = await tempGame();
    const common = { publicationRoot, gameRoot };
    const selected = await applyPublication({ ...common, publicationId: accepted.roles.a.publicationId });
    const pointerPath = path.join(gameRoot, 'design/revision.json');
    const pointerBefore = await readFile(pointerPath, 'utf8');
    await writeFile(
      path.join(gameRoot, selected.revisionPath, 'scenes/shell.js'),
      '// tampered\n',
      'utf8',
    );

    await expect(applyPublication({ ...common, publicationId: accepted.roles.b.publicationId })).rejects.toSatisfy(
      (error: unknown) => error instanceof ApplicationError && error.outcome === 'blocked-drift',
    );
    expect(await readFile(pointerPath, 'utf8')).toBe(pointerBefore);
    await expect(readSelectedProjection(common)).resolves.toEqual({ state: 'drifted' });
  });

  it('keeps an intact selected projection valid across accepted-set rotation', async () => {
    const gameRoot = await tempGame();
    const rotatedPublicationRoot = await tempPublications();
    const common = { publicationRoot: rotatedPublicationRoot, gameRoot };
    const selected = await applyPublication({ ...common, publicationId: accepted.roles.b.publicationId });

    const rotated = structuredClone(accepted);
    // Rotate B out of the current accepted set while preserving a structurally
    // valid P0/A/B handoff (the handoff contract only requires A != B).
    rotated.roles.b = rotated.roles.p0;
    await writeFile(
      path.join(rotatedPublicationRoot, 'accepted.json'),
      `${JSON.stringify(rotated, null, 2)}\n`,
      'utf8',
    );

    await expect(readSelectedProjection(common)).resolves.toEqual({
      state: 'selected',
      projectionId: selected.projectionId,
      publicationId: accepted.roles.b.publicationId,
    });

    await expect(applyPublication({ ...common, publicationId: accepted.roles.a.publicationId })).resolves.toMatchObject({
      outcome: 'applied',
      publicationId: accepted.roles.a.publicationId,
    });
    await expect(applyPublication({ ...common, publicationId: accepted.roles.b.publicationId })).rejects.toMatchObject({
      outcome: 'invalid-revision',
    });
  });
});
