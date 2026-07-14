// Test helper: synthesize generated scene code that matches the scene authority
// (stands in for the vendor-gated GUI CompileProject step, P6) and assemble a
// full PublishInput from the committed authoring project. The publisher DERIVES
// `scenes/shell.js` from the (synthesized) generated graph, so no runtime bundle
// is supplied here.
import { parseSceneDoc, type SceneDoc } from '../src/authoring/sceneModel.ts';
import { STATE_IDS } from '../src/authoring/extractV2.ts';
import { loadCommittedPublishProject } from '../src/loadProject.ts';
import type { PublishInput, SceneInput } from '../src/publish/publish.ts';
import type { ShellStateIdV2 } from '@fabrikav2/kernel';

/** Emit Phaser Editor-style generated code whose facts match `doc`. */
export function synthGeneratedSource(doc: SceneDoc): string {
  type FlatObject = { raw: Record<string, unknown>; parent: number | null };
  const flat: FlatObject[] = [];
  const walk = (list: unknown, parent: number | null): void => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object') continue;
      const raw = entry as Record<string, unknown>;
      const index = flat.push({ raw, parent }) - 1;
      walk(raw['list'], index);
    }
  };
  walk(doc.raw['displayList'], null);
  const semanticByUuid = new Map(doc.objects.map((obj) => [obj.uuid, obj]));
  const number = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const colorNumber = (value: unknown): unknown => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? Number.parseInt(value.slice(1), 16)
    : value;
  const lines: string[] = [
    'import Phaser from "phaser";',
    'import Semantic from "../components/Semantic";',
    `export default class ${doc.sceneKey} extends Phaser.Scene {`,
    '  editorCreate(): void {',
  ];
  flat.forEach(({ raw }, i) => {
    const v = `o${i}`;
    const type = typeof raw['type'] === 'string' ? raw['type'] : 'Container';
    const x = number(raw['x'], 0);
    const y = number(raw['y'], 0);
    const texture = raw['texture'] && typeof raw['texture'] === 'object'
      ? (raw['texture'] as Record<string, unknown>)['key']
      : null;
    if (type === 'Image' && typeof texture === 'string') {
      lines.push(`    const ${v} = this.add.image(${x}, ${y}, ${JSON.stringify(texture)});`);
    } else if (type === 'Text') {
      lines.push(`    const ${v} = this.add.text(${x}, ${y}, "", {});`);
    } else if (type === 'Rectangle') {
      lines.push(`    const ${v} = this.add.rectangle(${x}, ${y}, ${number(raw['width'], 0)}, ${number(raw['height'], 0)});`);
    } else {
      lines.push(`    const ${v} = this.add.container(${x}, ${y});`);
    }
    const defaultOrigin = type === 'Text' || type === 'BitmapText' ? 0 : 0.5;
    const originX = number(raw['originX'], defaultOrigin);
    const originY = number(raw['originY'], defaultOrigin);
    const scaleX = number(raw['scaleX'], 1);
    const scaleY = number(raw['scaleY'], 1);
    if (originX !== defaultOrigin || originY !== defaultOrigin) {
      lines.push(`    ${v}.setOrigin(${originX}, ${originY});`);
    }
    if (scaleX !== 1) lines.push(`    ${v}.scaleX = ${scaleX};`);
    if (scaleY !== 1) lines.push(`    ${v}.scaleY = ${scaleY};`);
    if (raw['visible'] === false) lines.push(`    ${v}.visible = false;`);
    if (type === 'Text') {
      if (typeof raw['text'] === 'string') lines.push(`    ${v}.text = ${JSON.stringify(raw['text'])};`);
      const style = Object.fromEntries(
        ['color', 'fontFamily', 'fontSize']
          .filter((key) => typeof raw[key] === 'string')
          .map((key) => [key, raw[key]]),
      );
      if (Object.keys(style).length > 0) lines.push(`    ${v}.setStyle(${JSON.stringify(style)});`);
    } else if (raw['tint'] !== undefined) {
      lines.push(`    ${v}.tint = ${JSON.stringify(colorNumber(raw['tint']))};`);
    }
    for (const property of ['fillAlpha', 'fillColor', 'isFilled', 'isStroked', 'lineWidth', 'strokeColor'] as const) {
      if (raw[property] !== undefined) lines.push(`    ${v}.${property} = ${JSON.stringify(colorNumber(raw[property]))};`);
    }
    if (typeof raw['rounded'] === 'number') lines.push(`    ${v}.setRounded(${raw['rounded']});`);

    const uuid = typeof raw['id'] === 'string' ? raw['id'] : '';
    const obj = semanticByUuid.get(uuid);
    if (!obj) return;
    const c = obj.carrier;
    lines.push(`    const ${v}Semantic = new Semantic(${v});`);
    lines.push(`    ${v}Semantic.fabSemanticId = ${JSON.stringify(c.fabSemanticId)};`);
    if (c.fabRole) lines.push(`    ${v}Semantic.fabRole = ${JSON.stringify(c.fabRole)};`);
    if (c.fabBinding) lines.push(`    ${v}Semantic.fabBinding = ${JSON.stringify(c.fabBinding)};`);
    if (c.fabSlot) lines.push(`    ${v}Semantic.fabSlot = ${JSON.stringify(c.fabSlot)};`);
    if (c.fabVariant) lines.push(`    ${v}Semantic.fabVariant = ${JSON.stringify(c.fabVariant)};`);
  });
  flat.forEach((entry, i) => {
    if (entry.parent !== null) lines.push(`    o${entry.parent}.add(o${i});`);
  });
  lines.push('  }', '}', '');
  return lines.join('\n');
}

/**
 * Assemble a full PublishInput from the committed authoring project, replacing
 * the accepted generated `.ts` with a synthesized module that matches each scene
 * (so A/B edit bundles are producible without the GUI compiler). `mutate` may
 * edit a raw scene (keyed by state) before parsing, to produce A/B bundles.
 */
export function loadPublishInput(
  outputRoot: string,
  mutate?: (state: ShellStateIdV2, raw: Record<string, unknown>) => void,
): PublishInput {
  const base = loadCommittedPublishProject(outputRoot);
  const scenes = new Map<ShellStateIdV2, SceneInput>();
  for (const state of STATE_IDS) {
    const raw = JSON.parse(base.scenes.get(state)!.sceneBytes.toString('utf8')) as Record<string, unknown>;
    mutate?.(state, raw);
    const doc = parseSceneDoc(raw);
    const sceneBytes = Buffer.from(JSON.stringify(raw), 'utf8');
    scenes.set(state, { doc, sceneBytes, generatedSource: synthGeneratedSource(doc) });
  }
  return { ...base, scenes };
}
