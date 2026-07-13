// Test helper: synthesize generated scene code that matches the scene authority
// (stands in for the vendor-gated GUI CompileProject step, P6) and assemble a
// full PublishInput from the committed authoring project.
import { readFileSync } from 'node:fs';
import { parseSceneDoc, type SceneDoc } from '../src/authoring/sceneModel.ts';
import { parseCatalog, indexById, type Catalog } from '../src/authoring/catalog.ts';
import { STATE_IDS } from '../src/authoring/extractV2.ts';
import type { PublishInput, SceneInput } from '../src/publish/publish.ts';
import type { ShellStateIdV2 } from '@fabrikav2/kernel';
import { repoPath } from './helpers.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const AUTHORING = ['games', 'shell_proof_phaser', 'authoring'];
const EDITOR = [...AUTHORING, 'phaser-editor'];

/** Emit Phaser Editor-style generated code whose facts match `doc`. */
export function synthGeneratedSource(doc: SceneDoc): string {
  const lines: string[] = [
    'import Phaser from "phaser";',
    'import Semantic from "../components/Semantic";',
    `export default class ${doc.sceneKey} extends Phaser.Scene {`,
    '  editorCreate(): void {',
  ];
  doc.objects.forEach((obj, i) => {
    const v = `o${i}`;
    const { x, y } = obj.geometry;
    if (obj.textureKey) {
      lines.push(`    const ${v} = this.add.image(${x}, ${y}, ${JSON.stringify(obj.textureKey)});`);
    } else if (obj.copy !== null) {
      lines.push(`    const ${v} = this.add.text(${x}, ${y}, "", {});`);
      lines.push(`    ${v}.text = ${JSON.stringify(obj.copy)};`);
    } else {
      lines.push(`    const ${v} = this.add.container(${x}, ${y});`);
    }
    const c = obj.carrier;
    lines.push(`    const ${v}Semantic = new Semantic(${v});`);
    lines.push(`    ${v}Semantic.fabSemanticId = ${JSON.stringify(c.fabSemanticId)};`);
    if (c.fabRole) lines.push(`    ${v}Semantic.fabRole = ${JSON.stringify(c.fabRole)};`);
    if (c.fabBinding) lines.push(`    ${v}Semantic.fabBinding = ${JSON.stringify(c.fabBinding)};`);
    if (c.fabSlot) lines.push(`    ${v}Semantic.fabSlot = ${JSON.stringify(c.fabSlot)};`);
    if (c.fabVariant) lines.push(`    ${v}Semantic.fabVariant = ${JSON.stringify(c.fabVariant)};`);
  });
  lines.push('  }', '}', '');
  return lines.join('\n');
}

/** A minimal but valid `scenes/shell.js` runtime bundle stand-in (fixture). */
export const RUNTIME_SHELL_JS = Buffer.from(
  '// scenes/shell.js — phaser-native runtime projection (fixture stand-in for the\n' +
    '// GUI-compiled bundle; the real bundle is produced by the vendor-gated P6 leg).\n' +
    'export const states = ["menu","level","shop","settings","pause","win","fail"];\n',
  'utf8',
);

/**
 * Assemble a full PublishInput from the committed authoring project. `mutate`
 * may edit a raw scene (keyed by state) before parsing, to produce A/B bundles.
 */
export function loadPublishInput(
  outputRoot: string,
  mutate?: (state: ShellStateIdV2, raw: Record<string, unknown>) => void,
): PublishInput {
  const catalog = parseCatalog(JSON.parse(readFileSync(repoPath(...AUTHORING, 'catalog', 'catalog.json'), 'utf8'))) as Catalog;
  const scenes = new Map<ShellStateIdV2, SceneInput>();
  for (const state of STATE_IDS) {
    const scenePath = repoPath(...EDITOR, 'src', 'scenes', `${cap(state)}.scene`);
    const raw = JSON.parse(readFileSync(scenePath, 'utf8')) as Record<string, unknown>;
    mutate?.(state, raw);
    const doc = parseSceneDoc(raw);
    const sceneBytes = Buffer.from(JSON.stringify(raw), 'utf8');
    scenes.set(state, { doc, sceneBytes, generatedSource: synthGeneratedSource(doc) });
  }
  const assetBytesById = new Map<string, Buffer>();
  for (const entry of indexById(catalog).values()) {
    assetBytesById.set(entry.id, readFileSync(repoPath('games', 'shell_proof_phaser', 'design', entry.path)));
  }
  return {
    scenes,
    catalog,
    editorPack: JSON.parse(readFileSync(repoPath(...EDITOR, 'public', 'assets', 'asset-pack.json'), 'utf8')),
    editorPackBytes: readFileSync(repoPath(...EDITOR, 'public', 'assets', 'asset-pack.json')),
    editorConfigBytes: readFileSync(repoPath(...EDITOR, 'phasereditor2d.config.json')),
    userComponentsBytes: readFileSync(repoPath(...EDITOR, 'src', 'components', 'Semantic.ts')),
    runtimeSceneJs: RUNTIME_SHELL_JS,
    assetBytesById,
    outputRoot,
  };
}
