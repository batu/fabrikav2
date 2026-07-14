import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSceneDoc, sceneCreationFacts } from '../src/authoring/sceneModel.ts';
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
    let displayObjects = 0;
    for (const state of STATE_IDS) {
      const name = state.charAt(0).toUpperCase() + state.slice(1);
      const base = ['games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes'];
      const scene = parseSceneDoc(JSON.parse(readFileSync(repoPath(...base, `${name}.scene`), 'utf8')));
      const generated = readFileSync(repoPath(...base, `${name}.ts`), 'utf8');
      const extracted = extractGeneratedFacts(generated);
      expect(extracted.creationFacts.size, name).toBe(sceneCreationFacts(scene).size);
      displayObjects += extracted.creationFacts.size;
      expect(verifyGeneratedModule(generated, scene), name).toEqual([]);
    }
    expect(displayObjects).toBe(243);
  });

  it('binds nonsemantic companion textures and positions to scene authority', () => {
    const base = ['games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes'];
    const scene = parseSceneDoc(JSON.parse(readFileSync(repoPath(...base, 'Menu.scene'), 'utf8')));
    const generated = readFileSync(repoPath(...base, 'Menu.ts'), 'utf8');
    const textureDrift = generated.replace(
      'this.add.image(195, 798, "button_surface_primary")',
      'this.add.image(195, 798, "definitely_missing")',
    );
    expect(verifyGeneratedModule(textureDrift, scene)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-drift', where: 'Menu:menu.fab.play-surface', detail: expect.stringContaining('textureKey') }),
    ]));
    const positionDrift = generated.replace(
      'this.add.image(195, 798, "button_surface_primary")',
      'this.add.image(205, 798, "button_surface_primary")',
    );
    expect(verifyGeneratedModule(positionDrift, scene)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-drift', where: 'Menu:menu.fab.play-surface', detail: expect.stringContaining('generated x') }),
    ]));
  });

  it('uses container attachment order as the generated tree address', () => {
    const nestedScene = parseSceneDoc({
      settings: { sceneKey: 'Menu', borderWidth: 390, borderHeight: 844 },
      displayList: [
        {
          type: 'Container', id: 'root', x: 10, y: 20, list: [
            { type: 'Image', id: 'a', label: 'child-a', x: 1, y: 2, texture: { key: 'a' } },
            { type: 'Image', id: 'b', label: 'child-b', x: 3, y: 4, texture: { key: 'b' } },
          ],
        },
        { type: 'Rectangle', id: 'tail', x: 5, y: 6, width: 10, height: 12 },
      ],
    });
    const nested = `
import Phaser from "phaser";
import Semantic from "../components/Semantic";
export default class Menu extends Phaser.Scene {
  editorCreate(): void {
    const root = this.add.container(10, 20);
    const a = this.add.image(1, 2, "a");
    const b = this.add.image(3, 4, "b");
    const tail = this.add.rectangle(5, 6, 10, 12);
    root.add(a);
    root.add(b);
  }
}
`;
    expect(verifyGeneratedModule(nested, nestedScene)).toEqual([]);
    const reordered = nested.replace('root.add(a);\n    root.add(b);', 'root.add(b);\n    root.add(a);');
    expect(verifyGeneratedModule(reordered, nestedScene)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-drift', where: 'Menu:child-a' }),
      expect.objectContaining({ code: 'blocked-drift', where: 'Menu:child-b' }),
    ]));
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

  it('blocks executable expressions hidden in otherwise valid object calls', () => {
    const payload = GENERATED.replace(
      'title.setOrigin(0.5, 0.5);',
      'title.setOrigin((globalThis.__U5_AUDIT_PWNED__ = true, 0.5), 0.5);',
    );
    expect(verifyGeneratedModule(payload, scene())).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-user-code' }),
    ]));

    const arbitraryMethod = GENERATED.replace(
      'title.setOrigin(0.5, 0.5);',
      'title.setName((globalThis.__U5_AUDIT_PWNED__ = true, "title"));',
    );
    expect(verifyGeneratedModule(arbitraryMethod, scene())).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-user-code' }),
    ]));
  });

  it('blocks a renamed scene class and extra top-level side effects', () => {
    const renamed = GENERATED.replace('class Menu extends', 'class NotMenu extends');
    expect(verifyGeneratedModule(renamed, scene())).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-drift' }),
    ]));

    const sideEffect = `${GENERATED}\nglobalThis.compromised = true;\n`;
    expect(verifyGeneratedModule(sideEffect, scene())).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-user-code' }),
    ]));
  });

  it('blocks local imports until the publisher retains and closes that graph', () => {
    const withPrefab = GENERATED.replace(
      'import Semantic from "../components/Semantic";',
      'import Semantic from "../components/Semantic";\nimport Counter from "./Counter";',
    );
    expect(verifyGeneratedModule(withPrefab, scene())).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-unsafe-import' }),
    ]));
  });
});
