/**
 * Design-owned runtime asset URLs. This file lives under design/ so shell code
 * can consume assets without embedding paths in the no-literals zone.
 */
import ribbonWin from './assets/ribbon_win.svg';
import ribbonLose from './assets/ribbon_lose.svg';
import gear from './assets/gear.svg';
import headerRoute from './assets/header_route.svg';
import nodeDefault from './assets/level_node_default.svg';
import nodeLocked from './assets/level_node_locked.svg';
import nodeCurrent from './assets/level_node_current.svg';
import nodeCompleted from './assets/level_node_completed.svg';

export const assetUrls = {
  gear,
  ribbonWin,
  ribbonLose,
} as const;

/**
 * Install Vite-resolved saga art on the nested @fabrikav2/ui LevelMap root.
 * The shared kit resets `--fab-levelmap-art-*` on each `.fab-ui` screen, so the
 * game-owned asset URLs have to land on `.fab-levelmap` itself.
 */
export function installLevelMapArt(doc: Document = document): void {
  const id = 'arrow-levelmap-art';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = `.fab-levelmap {
  --fab-levelmap-art-default: url(${nodeDefault});
  --fab-levelmap-art-locked: url(${nodeLocked});
  --fab-levelmap-art-current: url(${nodeCurrent});
  --fab-levelmap-art-completed: url(${nodeCompleted});
  --fab-levelmap-path-width: min(244px, 72vw);
  --fab-levelmap-node-gap: 12px;
  --fab-levelmap-offset: 43px;
  --fab-levelmap-node-size: 60px;
  --fab-levelmap-node-current-size: 88px;
  --fab-levelmap-node-font: 20px;
  --fab-levelmap-node-current-font: 34px;
  --fab-levelmap-node-color: #343858;
  --fab-levelmap-dot-color: #343858;
  --fab-levelmap-locked-color: #676b91;
  --fab-levelmap-locked-dot-color: #676b91;
  --fab-levelmap-completed-color: #ffffff;
  --fab-levelmap-current-color: #ffffff;
  --fab-levelmap-line-top: #d8d4c8;
  --fab-levelmap-line-mid: #9da1d3;
  --fab-levelmap-line-bottom: #6d86f5;
  --fab-levelmap-line-glow: 0 0 0 3px rgba(255, 255, 255, 0.7), 7px 0 0 -2px rgba(236, 119, 152, 0.52), -7px 0 0 -2px rgba(93, 187, 117, 0.44), 0 10px 24px rgba(109, 134, 245, 0.22);
  --fab-levelmap-far-opacity: 0.86;
  --fab-levelmap-distant-opacity: 0.68;
}
.fab-levelmap-path::before {
  top: 18px;
  bottom: 34px;
  width: 11px;
  border: 2px solid rgba(52, 56, 88, 0.18);
}
.fab-levelmap-node {
  min-width: var(--fab-levelmap-node-current-size);
  min-height: var(--fab-levelmap-node-current-size);
}
.fab-levelmap-node-dot {
  filter: drop-shadow(0 8px 10px rgba(52, 56, 88, 0.16));
}
.fab-levelmap-node.current .fab-levelmap-node-dot {
  filter: drop-shadow(0 14px 18px rgba(109, 134, 245, 0.26));
}
.fab-levelmap-node.locked .fab-levelmap-node-dot {
  filter: drop-shadow(0 5px 8px rgba(103, 107, 145, 0.12));
}
.arrow-menu-header {
  position: relative;
  isolation: isolate;
  min-height: 124px;
}
.arrow-menu-header::before {
  content: '';
  position: absolute;
  inset: 10px 0 0;
  z-index: 0;
  pointer-events: none;
  background: url(${headerRoute}) center / 100% 100% no-repeat;
  opacity: 0.98;
}
.arrow-menu-header > * {
  position: relative;
  z-index: 1;
}`;
  doc.head.appendChild(style);
}
