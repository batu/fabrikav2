import { describe, it, expect } from 'vitest';
import { parseSceneDoc, type SceneDoc } from '../src/authoring/sceneModel.ts';
import { parseCatalog, type Catalog } from '../src/authoring/catalog.ts';
import { loadEditorAssets } from '../src/authoring/editorAssets.ts';
import { STATE_IDS } from '../src/authoring/extractV2.ts';
import { validateProject } from '../src/publish/validate.ts';
import { isActiveContent, isRemoteContent } from '../src/publish/safety.ts';
import { readJson, repoPath } from './helpers.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const scenePath = (state: string) => [
  'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes', `${cap(state)}.scene`,
];
const catalog = parseCatalog(
  readJson('games', 'shell_proof_phaser', 'authoring', 'catalog', 'catalog.json'),
) as Catalog;
const pack = readJson(
  'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public', 'assets', 'asset-pack.json',
);
const assets = loadEditorAssets(repoPath(
  'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public',
), pack);

/** Validate the committed project after setting menu.title copy to `copy`. */
function validateWithTitleCopy(copy: string) {
  const scenes = new Map<(typeof STATE_IDS)[number], SceneDoc>();
  for (const state of STATE_IDS) {
    const raw = readJson(...scenePath(state)) as Record<string, unknown>;
    if (state === 'menu') {
      const list = raw['displayList'] as Array<Record<string, unknown>>;
      list.find((o) => o['Semantic.fabSemanticId'] === 'menu.title')!['text'] = copy;
    }
    scenes.set(state, parseSceneDoc(raw));
  }
  return validateProject({
    scenes,
    catalog,
    editorPack: pack,
    editorAssetBytesByUrl: assets.bytesByUrl,
    editorAssetSymlinks: assets.symlinkUrls,
  });
}

describe('P4 hostile strings — inert data passes, active/remote/markup blocks', () => {
  // Compiler-escaping-safe punctuation the Phaser Editor emits as inert string
  // literals (matches U2's proven escaping): quotes, backticks, template braces,
  // comment markers, newlines. These must round-trip as ordinary copy, NOT block.
  it('accepts inert hostile punctuation as ordinary copy', () => {
    const inert = 'H\' H" H` ${x} {y} */ // end\nline2';
    expect(isActiveContent(inert)).toBe(false);
    expect(isRemoteContent(inert)).toBe(false);
    expect(validateWithTitleCopy(inert).result).toBe('ok');
  });

  it('blocks HTML/script markup as active content', () => {
    expect(validateWithTitleCopy('<script>alert(1)</script>').result).toBe('blocked');
  });

  it('blocks javascript: active schemes', () => {
    const result = validateWithTitleCopy('javascript:alert(document.cookie)');
    expect(result.result).toBe('blocked');
    expect(result.blocks.some((b) => b.code === 'blocked-active-content')).toBe(true);
  });

  it('blocks data: / remote URLs the kernel copy check alone would allow', () => {
    expect(validateWithTitleCopy('data:text/html;base64,PHNjcmlwdD4=').result).toBe('blocked');
    const remote = validateWithTitleCopy('open http://tracker.example.com/pixel');
    expect(remote.result).toBe('blocked');
    expect(remote.blocks.some((b) => b.code === 'blocked-remote-content')).toBe(true);
  });
});
