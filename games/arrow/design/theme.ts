/**
 * Design-owned runtime asset URLs. This file lives under design/ so shell code
 * can consume assets without embedding paths in the no-literals zone.
 */
import ribbonWin from './assets/ribbon_win.svg';
import ribbonLose from './assets/ribbon_lose.svg';
import gear from './assets/gear.svg';
import headerRoute from './assets/header_route.svg';

export const assetUrls = {
  gear,
  ribbonWin,
  ribbonLose,
} as const;

/**
 * Install non-token saga accents on the nested @fabrikav2/ui LevelMap root.
 * Design tokens, including node art URLs, live in design/tokens.css so the
 * composed CSS surface is deterministic and auditable.
 */
export function installLevelMapArt(doc: Document = document): void {
  const id = 'arrow-levelmap-art';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = `.fab-levelmap {
  isolation: isolate;
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
}
.arrow-ui .fab-home-menu {
  box-sizing: border-box;
  min-height: 100dvh;
  padding: 0 20px calc(16px + env(safe-area-inset-bottom, 0px));
}
.arrow-ui .fab-home-menu-content {
  flex: 1 1 auto;
  min-height: 0;
  align-items: center;
}
.arrow-ui .fab-home-menu-actions {
  width: min(72vw, 260px);
  margin: 0 auto;
}
.arrow-play-button {
  min-height: 58px;
  border: 2px solid var(--arrow-panel-border);
  border-radius: 999px;
  background: linear-gradient(180deg, var(--active-blue), var(--fab-color-accent));
  color: var(--fab-color-on-accent);
  font-size: 22px;
  font-weight: 900;
  box-shadow: 0 9px 0 var(--arrow-panel-border), 0 18px 28px var(--arrow-panel-shadow);
  text-transform: uppercase;
}`;
  doc.head.appendChild(style);
}
