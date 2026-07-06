/**
 * Runtime binding layer for the design/ sheet (hand-authored seed; the
 * design-sheets round-trip owns tokens.css/copy.ts/assets.ts, this thin
 * companion resolves the committed asset bytes to Vite URLs and packs the
 * level-map art tokens the SagaMap consumes). Lives under design/ (outside the
 * tools/audit no-literals scope), so the asset-path imports + url() token
 * values are legal here and never leak literals into src/shell.
 */
import banner from './assets/marble-run-banner.webp';
import coin from './assets/icon-marble-coin.png';
import gear from './assets/icon-gear.png';
import replay from './assets/icon-replay.png';
import ribbonFail from './assets/ribbon-fail.webp';
import nodeDefault from './assets/level-node-default.webp';
import nodeLocked from './assets/level-node-locked.webp';
import nodeCurrent from './assets/level-node-current.webp';
import nodeCompleted from './assets/level-node-completed.webp';
import back from './assets/icon-back.svg';

/** Injected asset URLs the shell hands to @fabrikav2/ui components. */
export const assetUrls = {
  banner,
  coin,
  gear,
  replay,
  back,
  ribbonFail,
  nodeDefault,
  nodeLocked,
  nodeCurrent,
  nodeCompleted,
} as const;

/**
 * Install the level-map node art (Vite-resolved urls, so they can't live in the
 * design-sheet tokens.css). The SagaMap mounts its own `.fab-ui` root whose
 * `@layer` default re-sets `--fab-levelmap-art-*: none`, shadowing any value
 * inherited from an ancestor — so an inline `applyTheme` on the composing
 * HomeMenu never reaches the nested rail. An UNLAYERED `.fab-levelmap` rule
 * beats that layered default on the node's own element, covering both the
 * composed home saga and the standalone level-select. Idempotent.
 */
export function installLevelMapArt(doc: Document = document): void {
  const id = 'mr-levelmap-art';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = `.fab-levelmap {
  --fab-levelmap-art-default: url(${nodeDefault});
  --fab-levelmap-art-locked: url(${nodeLocked});
  --fab-levelmap-art-current: url(${nodeCurrent});
  --fab-levelmap-art-completed: url(${nodeCompleted});
}`;
  doc.head.appendChild(style);
}
