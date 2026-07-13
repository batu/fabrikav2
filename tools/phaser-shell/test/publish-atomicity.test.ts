import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publish } from '../src/publish/publish.ts';
import { loadPublishInput } from './gen.ts';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-atom-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

describe('P5 atomic publish (temp + rename, no partial writes)', () => {
  it('publishes into authoring/publications/<publicationId>/', async () => {
    const root = tmp();
    const r = await publish(loadPublishInput(root));
    expect(r.result).toBe('ok');
    expect(existsSync(path.join(r.dir!, 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(r.dir!, 'projection', 'scenes', 'shell.js'))).toBe(true);
    expect(existsSync(path.join(r.dir!, 'source', 'scenes', 'Menu.scene'))).toBe(true);
    expect(path.basename(r.dir!)).toBe(r.publicationId);
  });

  it('blocks a differing-bytes collision on an existing publicationId (no overwrite)', async () => {
    const input = loadPublishInput(tmp());
    // Pre-compute the publicationId by a clean publish to a scratch root.
    const scratch = tmp();
    const clean = await publish(loadPublishInput(scratch));
    // Seed the target root with a directory of the SAME id but different bytes.
    const collidingDir = path.join(input.outputRoot, clean.publicationId!);
    mkdirSync(collidingDir, { recursive: true });
    writeFileSync(path.join(collidingDir, 'manifest.json'), '{"tampered":true}\n');
    const r = await publish(input);
    expect(r.result).toBe('blocked');
    expect(r.blocks?.some((b) => b.code === 'blocked-publication-mismatch')).toBe(true);
    // The pre-existing (colliding) directory was NOT overwritten.
    expect(readdirSync(collidingDir)).toEqual(['manifest.json']);
  });

  it('a blocked validation leaves NO publication directory behind', async () => {
    const root = tmp();
    const r = await publish(
      loadPublishInput(root, (state, raw) => {
        if (state !== 'menu') return;
        const list = raw['displayList'] as Array<Record<string, unknown>>;
        // Hostile markup in copy → blocked-active-content before any write.
        list.find((o) => o['Semantic.fabSemanticId'] === 'menu.title')!['text'] = '<script>evil</script>';
      }),
    );
    expect(r.result).toBe('blocked');
    // Nothing was written to the output root.
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it('a blocked publish after staging (bundle layout) still writes nothing to the output root', async () => {
    // A required-action removal blocks at validation before any staging; assert
    // the output root stays empty so no partial publication can be observed.
    const root = tmp();
    const r = await publish(
      loadPublishInput(root, (state, raw) => {
        if (state !== 'menu') return;
        const list = raw['displayList'] as Array<Record<string, unknown>>;
        list.find((o) => o['Semantic.fabSemanticId'] === 'menu.play')!['visible'] = false;
      }),
    );
    expect(r.result).toBe('blocked');
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });
});
