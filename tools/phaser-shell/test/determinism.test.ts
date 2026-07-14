import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publish } from '../src/publish/publish.ts';
import { loadPublishInput } from './gen.ts';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-det-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function walk(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    if (statSync(abs).isDirectory()) Object.assign(out, walk(abs, relPath));
    else out[relPath] = readFileSync(abs).toString('base64');
  }
  return out;
}

describe('P5 deterministic publisher', () => {
  it('two clean publications of unchanged input are byte-identical', async () => {
    const a = await publish(loadPublishInput(tmp()));
    const b = await publish(loadPublishInput(tmp()));
    expect(a.result).toBe('ok');
    expect(b.result).toBe('ok');
    expect(a.publicationId).toBe(b.publicationId);
    expect(walk(a.dir!)).toEqual(walk(b.dir!));
  });

  it('re-publishing unchanged input into the same root is a no-op', async () => {
    const root = tmp();
    const first = await publish(loadPublishInput(root));
    const second = await publish(loadPublishInput(root));
    expect(first.result).toBe('ok');
    expect(second.result).toBe('no-op');
    expect(second.publicationId).toBe(first.publicationId);
  });

  it('an edited authoring state yields a different publicationId and moves the derived shell.js', async () => {
    const p0 = await publish(loadPublishInput(tmp()));
    const edited = await publish(
      loadPublishInput(tmp(), (state, raw) => {
        if (state !== 'menu') return;
        const list = raw['displayList'] as Array<Record<string, unknown>>;
        list.find((o) => o['Semantic.fabSemanticId'] === 'menu.title')!['text'] = 'Alpha Shell';
      }),
    );
    expect(edited.result).toBe('ok');
    expect(edited.publicationId).not.toBe(p0.publicationId);
    // The runtime bundle is DERIVED from the generated graph, so the edit moves its bytes.
    const shellOf = (dir: string): Buffer => readFileSync(path.join(dir, 'projection', 'scenes', 'shell.js'));
    expect(shellOf(edited.dir!).equals(shellOf(p0.dir!))).toBe(false);
    expect(shellOf(edited.dir!).toString('utf8')).toContain('Alpha Shell');
  });
});
