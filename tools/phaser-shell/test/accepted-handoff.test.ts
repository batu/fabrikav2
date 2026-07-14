import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publish, type PublishResult } from '../src/publish/publish.ts';
import {
  buildAcceptedHandoff,
  validateAcceptedHandoff,
  parseAcceptedHandoff,
  type HandoffEntry,
} from '../src/publish/handoff.ts';
import { status } from '../src/publish/status.ts';
import { startReviewServer } from '../src/reviewServer.ts';
import { loadPublishInput } from './gen.ts';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-hand-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function entryFor(r: PublishResult): HandoffEntry {
  const manifest = JSON.parse(readFileSync(path.join(r.dir!, 'manifest.json'), 'utf8'));
  return { publicationId: r.publicationId!, manifestDigest: manifest.digest };
}

/** Publish P0 (unedited), A (title=Alpha Shell), B (title=Beta Shell) into one root. */
async function publishP0AB(root: string) {
  const editTitle = (text: string) => (state: 'menu' | string, raw: Record<string, unknown>) => {
    if (state !== 'menu') return;
    const list = raw['displayList'] as Array<Record<string, unknown>>;
    list.find((o) => o['Semantic.fabSemanticId'] === 'menu.title')!['text'] = text;
  };
  const p0 = await publish(loadPublishInput(root));
  const a = await publish(loadPublishInput(root, editTitle('Alpha Shell') as never));
  const b = await publish(loadPublishInput(root, editTitle('Beta Shell') as never));
  return { p0, a, b };
}

describe('P5 U5→U6 handoff (three accepted immutable publications P0/A/B)', () => {
  it('publishes three distinct, gate-proven publications and validates the handoff record', async () => {
    const root = tmp();
    const { p0, a, b } = await publishP0AB(root);
    expect([p0.result, a.result, b.result]).toEqual(['ok', 'ok', 'ok']);
    // All three are distinct (A != B specifically; U6 applies B twice).
    expect(new Set([p0.publicationId, a.publicationId, b.publicationId]).size).toBe(3);

    const handoff = buildAcceptedHandoff({ p0: entryFor(p0), a: entryFor(a), b: entryFor(b) });
    const issues = await validateAcceptedHandoff(handoff, root);
    expect(issues).toEqual([]);

    // Each accepted publication verifies against its own manifest (status: ready).
    for (const r of [p0, a, b]) expect((await status(r.dir!)).outcome).toBe('ready');
  });

  it('rejects a handoff where A == B (U6 could not apply a distinct B twice)', async () => {
    const root = tmp();
    const { p0, a } = await publishP0AB(root);
    const handoff = buildAcceptedHandoff({ p0: entryFor(p0), a: entryFor(a), b: entryFor(a) });
    const issues = await validateAcceptedHandoff(handoff, root);
    expect(issues.some((i) => i.code === 'a-equals-b')).toBe(true);
  });

  it('rejects a handoff pointing at a missing publication', async () => {
    const root = tmp();
    const { p0, a, b } = await publishP0AB(root);
    const handoff = buildAcceptedHandoff({
      p0: entryFor(p0),
      a: entryFor(a),
      b: { publicationId: 'sha256-does-not-exist', manifestDigest: 'sha256-x' },
    });
    void b;
    const issues = await validateAcceptedHandoff(handoff, root);
    expect(issues.some((i) => i.code === 'missing-publication')).toBe(true);
  });

  it('rejects a handoff whose recorded digest drifts from the committed publication', async () => {
    const root = tmp();
    const { p0, a, b } = await publishP0AB(root);
    const handoff = buildAcceptedHandoff({
      p0: entryFor(p0),
      a: { publicationId: a.publicationId!, manifestDigest: 'sha256-tampered' },
      b: entryFor(b),
    });
    const issues = await validateAcceptedHandoff(handoff, root);
    expect(issues.some((i) => i.code === 'manifest-digest-drift')).toBe(true);
  });

  it('rejects a handoff after any accepted publication file is tampered on disk', async () => {
    const root = tmp();
    const { p0, a, b } = await publishP0AB(root);
    const handoff = buildAcceptedHandoff({ p0: entryFor(p0), a: entryFor(a), b: entryFor(b) });
    appendFileSync(path.join(p0.dir!, 'projection', 'scenes', 'shell.js'), '\n// tampered\n');
    const issues = await validateAcceptedHandoff(handoff, root);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'p0', code: 'publication-tampered' }),
    ]));
    await expect(startReviewServer({ publicationDir: p0.dir! })).rejects.toThrow(/not immutable-ready/);
  });

  it('serves only the verified startup snapshot after post-start disk tampering', async () => {
    const publication = await publish(loadPublishInput(tmp()));
    expect(publication.result).toBe('ok');
    const server = await startReviewServer({ publicationDir: publication.dir! });
    try {
      const before = await (await fetch(`${server.url}/shell.js`)).text();
      appendFileSync(path.join(publication.dir!, 'projection', 'scenes', 'shell.js'), '\n// post-start-tamper\n');
      expect((await status(publication.dir!)).outcome).toBe('tampered');
      const after = await (await fetch(`${server.url}/shell.js`)).text();
      expect(after).toBe(before);
      expect(after).not.toContain('post-start-tamper');
    } finally {
      await server.close();
    }
  });

  it('the accepted.json shape round-trips through the parser', () => {
    const handoff = buildAcceptedHandoff({
      p0: { publicationId: 'sha256-a', manifestDigest: 'sha256-1' },
      a: { publicationId: 'sha256-b', manifestDigest: 'sha256-2' },
      b: { publicationId: 'sha256-c', manifestDigest: 'sha256-3' },
    });
    const parsed = parseAcceptedHandoff(JSON.parse(JSON.stringify(handoff)));
    expect(parsed.roles.p0.publicationId).toBe('sha256-a');
  });
});
