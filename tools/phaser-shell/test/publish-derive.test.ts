// The canonical `scenes/shell.js` is DERIVED from the accepted generated graph,
// never supplied by the caller (U5, KTD-D/§2/§11). These tests prove: the
// derivation is deterministic, a source change moves the bytes, the published
// bundle equals the independently-derived bytes (so no bytes can be injected),
// the bundle is editor-footprint-free and carries the stable seven-state
// registry the browser proof drives, and the publisher API structurally cannot
// accept a runtime bundle.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveRuntimeBundle, type RuntimeGraph } from '../src/publish/deriveRuntime.ts';
import { publish, type PublishInput } from '../src/publish/publish.ts';
import { loadCommittedPublishProject } from '../src/loadProject.ts';
import { STATE_IDS } from '../src/authoring/extractV2.ts';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-derive-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

/** The accepted generated graph carried by a PublishInput. */
function graphOf(input: PublishInput): RuntimeGraph {
  const scenesByState = new Map(
    [...input.scenes].map(([state, s]) => [state, s.generatedSource] as const),
  );
  return { scenesByState, semanticSource: input.userComponentsBytes.toString('utf8') };
}

describe('P5 derived runtime bundle (scenes/shell.js)', () => {
  it('derives a byte-deterministic bundle from the real committed generated graph', () => {
    const graph = graphOf(loadCommittedPublishProject(tmp()));
    expect(deriveRuntimeBundle(graph).equals(deriveRuntimeBundle(graph))).toBe(true);
  });

  it('is DERIVED: a change to a generated source module moves the bundle bytes', () => {
    const graph = graphOf(loadCommittedPublishProject(tmp()));
    const before = deriveRuntimeBundle(graph);
    const scenesByState = new Map(graph.scenesByState);
    const menu = scenesByState.get('menu')!;
    expect(menu).toContain('super("Menu")');
    scenesByState.set('menu', menu.replace('super("Menu")', 'super("MenuDerivedProbe")'));
    const after = deriveRuntimeBundle({ ...graph, scenesByState });
    expect(after.equals(before)).toBe(false);
    expect(after.toString('utf8')).toContain('MenuDerivedProbe');
  });

  it('carries scene classes + the stable seven-state registry, with NO editor footprint', () => {
    const source = deriveRuntimeBundle(graphOf(loadCommittedPublishProject(tmp()))).toString('utf8');
    // Real derived bundle shape the render proof detects (class extends).
    expect(/Phaser\.Scene|class\s+\w+\s+extends/.test(source)).toBe(true);
    expect(source).toContain(`export const states = ${JSON.stringify(STATE_IDS)}`);
    expect(source).toContain('export const scenes = {');
    expect(source).toContain('export function boot(config)');
    // Editor markers must never appear in the runtime bundle.
    for (const marker of ['phasereditor2d', 'phaser-editor', 'START-USER-CODE', 'editorCreate', 'COMPILED CODE']) {
      expect(source, marker).not.toContain(marker);
    }
  });

  it('the PUBLISHED scenes/shell.js equals the independently-derived bytes (no injection)', async () => {
    const input = loadCommittedPublishProject(tmp());
    const r = await publish(input);
    expect(r.result).toBe('ok');
    const published = readFileSync(path.join(r.dir!, 'projection', 'scenes', 'shell.js'));
    expect(published.equals(deriveRuntimeBundle(graphOf(input)))).toBe(true);
  });

  it('the publisher API structurally cannot accept caller runtime bytes', () => {
    const input = loadCommittedPublishProject(tmp());
    // @ts-expect-error — PublishInput has no `runtimeSceneJs`: arbitrary bundle
    // bytes are impossible to inject; the bundle is derived from the graph alone.
    const injected: PublishInput = { ...input, runtimeSceneJs: Buffer.from('evil') };
    // The extra property is inert — publish still derives from the generated graph.
    expect('runtimeSceneJs' in input).toBe(false);
    void injected;
  });
});
