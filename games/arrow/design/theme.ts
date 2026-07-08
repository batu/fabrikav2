/**
 * Design-owned runtime asset URLs. This file lives under design/ so shell code
 * can consume assets without embedding paths in the no-literals zone.
 */
import ribbonWin from './assets/ribbon_win.svg';
import ribbonLose from './assets/ribbon_lose.svg';
import gear from './assets/gear.svg';

export const assetUrls = {
  gear,
  ribbonWin,
  ribbonLose,
} as const;
