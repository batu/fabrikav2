// Load the committed authoring project (scenes + catalog + editor pack) for the
// editor-free CLI verbs. Generated `.ts`, the runtime `scenes/shell.js` bundle,
// and the accepted P0/A/B publications are produced by the vendor-gated GUI leg
// (P6) and are NOT loaded here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSceneDoc, type SceneDoc } from './authoring/sceneModel.ts';
import { parseCatalog, type Catalog } from './authoring/catalog.ts';
import { STATE_IDS } from './authoring/extractV2.ts';
import type { AuthoringProject } from './publish/validate.ts';
import type { ShellStateIdV2 } from '@fabrikav2/kernel';

/** Repo root, three levels above this module (`tools/phaser-shell/src`). */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTHORING = path.join(REPO_ROOT, 'games', 'shell_proof_phaser', 'authoring');
const EDITOR = path.join(AUTHORING, 'phaser-editor');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Load the committed authoring project as a validatable AuthoringProject. */
export function loadCommittedProject(): AuthoringProject {
  const catalog = parseCatalog(JSON.parse(readFileSync(path.join(AUTHORING, 'catalog', 'catalog.json'), 'utf8'))) as Catalog;
  const scenes = new Map<ShellStateIdV2, SceneDoc>();
  for (const state of STATE_IDS) {
    const raw = JSON.parse(readFileSync(path.join(EDITOR, 'src', 'scenes', `${cap(state)}.scene`), 'utf8'));
    scenes.set(state, parseSceneDoc(raw));
  }
  const editorPack = JSON.parse(readFileSync(path.join(EDITOR, 'public', 'assets', 'asset-pack.json'), 'utf8'));
  return { scenes, catalog, editorPack };
}
