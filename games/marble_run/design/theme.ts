/**
 * Runtime binding layer for the design/ sheet (hand-authored seed; the
 * design-sheets round-trip owns tokens.css/copy.ts/assets.ts, this thin
 * companion resolves the committed asset bytes to Vite URLs and packs the
 * level-map art tokens the SagaMap consumes). Lives under design/ (outside the
 * tools/audit no-literals scope), so the asset-path imports + url() token
 * values are legal here and never leak literals into src/shell.
 */
import type { ThemeTokens } from '@fabrikav2/ui';
import banner from './assets/marble-run-banner.webp';
import coin from './assets/icon-marble-coin.png';
import gear from './assets/icon-gear.png';
import replay from './assets/icon-replay.png';
import ribbonFail from './assets/ribbon-fail.webp';
import nodeDefault from './assets/level-node-default.webp';
import nodeLocked from './assets/level-node-locked.webp';
import nodeCurrent from './assets/level-node-current.webp';
import nodeCompleted from './assets/level-node-completed.webp';

/** Injected asset URLs the shell hands to @fabrikav2/ui components. */
export const assetUrls = {
  banner,
  coin,
  gear,
  replay,
  ribbonFail,
  nodeDefault,
  nodeLocked,
  nodeCurrent,
  nodeCompleted,
} as const;

/** Level-map art tokens (need Vite-resolved urls, so they live here not in tokens.css). */
export const levelMapTheme: ThemeTokens = {
  '--fab-levelmap-art-default': `url(${nodeDefault})`,
  '--fab-levelmap-art-locked': `url(${nodeLocked})`,
  '--fab-levelmap-art-current': `url(${nodeCurrent})`,
  '--fab-levelmap-art-completed': `url(${nodeCompleted})`,
};
