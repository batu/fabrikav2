import type { ThemeTokens } from '../v1core/ui';

/**
 * Find the Dog's complete ../v1core/ui skin. Core's defaults are intentionally
 * brand-neutral; FTD owns these values so production surfaces stay unchanged.
 */
export const FTD_UI_THEME: ThemeTokens = {
  '--fab-color-surface': '#ffffff',
  '--fab-color-overlay-scrim': 'rgba(0, 0, 0, 0.4)',
  '--fab-color-text': '#3d3d3d',
  '--fab-color-text-muted': '#555555',
  '--fab-color-accent': '#FF8C42',
  '--fab-color-on-accent': '#ffffff',
  '--fab-color-secondary-surface': '#f0f0f0',
  '--fab-color-on-secondary': '#333333',
  '--fab-color-secondary-border': '#cccccc',

  /* Modal shell: FTD's production rate prompt predates the core shell's
     safe-area padding and tinted gradient layers — pin the shipped render
     (plain scrim, edge-to-edge backdrop). */
  '--fab-modal-backdrop-padding': '0',
  '--fab-modal-backdrop-bg': 'var(--fab-color-overlay-scrim)',
  /* `none`, not 0ms: a finished fill-mode:both animation still leaves an
     identity transform that re-rasterizes the card as a composited layer
     (subpixel-shifts every glyph vs the shipped render). */
  '--fab-modal-backdrop-animation': 'none',
  '--fab-modal-card-animation': 'none',
  /* Shipped buttons predate the shell's 1.1 line-height. */
  '--fab-btn-line-height': 'normal',

  /* Interaction-state + latent shell tokens, pinned to A2's warm values
     (what main renders today). These states are invisible to the static 0px
     gate; the shipped pre-A2 app kept each button's OWN shadow while pressed
     and had no disabled treatment at all, which one global token cannot
     express — that deviation is A2 fallout, owned by card p0qUk4yL. Pinning
     warm here keeps FTD's next build identical to current main instead of
     silently going gray. */
  '--fab-shadow-button':
    'inset 0 2px 0 rgba(255, 255, 255, 0.32), 0 3px 0 rgba(112, 69, 27, 0.16), 0 9px 18px rgba(31, 18, 6, 0.17)',
  '--fab-shadow-button-active':
    'inset 0 2px 0 rgba(255, 255, 255, 0.26), 0 1px 0 rgba(112, 69, 27, 0.16), 0 5px 11px rgba(31, 18, 6, 0.16)',
  '--fab-shadow-button-disabled':
    'inset 0 1px 0 rgba(255, 255, 255, 0.32), 0 1px 0 rgba(112, 69, 27, 0.08)',
  '--fab-btn-secondary-shadow':
    'inset 0 1px 0 rgba(255, 255, 255, 0.46), 0 1px 0 rgba(112, 69, 27, 0.08), 0 5px 10px rgba(31, 18, 6, 0.09)',
  '--fab-btn-icon-color': '#9a6a3e',
  '--fab-btn-icon-shadow':
    'inset 0 1px 0 rgba(255, 255, 255, 0.42), 0 1px 0 rgba(112, 69, 27, 0.06), 0 3px 7px rgba(31, 18, 6, 0.06)',
  '--fab-modal-card-bg':
    'linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 249, 239, 0.96)), var(--fab-color-surface)',
  '--fab-modal-card-shadow':
    'inset 0 2px 0 rgba(255, 255, 255, 0.76), 0 5px 0 rgba(112, 69, 27, 0.12), var(--fab-shadow-modal)',

  '--fab-levelmap-node-color': '#4b382c',
  '--fab-levelmap-dot-color': '#7e7166',
  '--fab-levelmap-locked-color': '#9b8a7d',
  '--fab-levelmap-locked-dot-color': '#8f8174',
  '--fab-levelmap-completed-color': '#3b2a21',
  '--fab-levelmap-current-color': '#ffffff',
  '--fab-levelmap-line': 'linear-gradient(180deg, rgba(255, 196, 107, 0.3), #ffc46b 28%, #f08b51 100%)',
  '--fab-levelmap-line-glow': '0 0 0 3px rgba(255, 255, 255, 0.26), 0 0 18px rgba(255, 194, 61, 0.24)',
  '--fab-levelmap-loading-bg': 'rgba(255, 255, 255, 0.56)',
  '--fab-levelmap-loading-border': 'rgba(201, 185, 170, 0.7)',
  '--fab-levelmap-loading-shadow': '0 8px 18px rgba(128, 80, 27, 0.12)',
  '--fab-levelmap-loading-current-bg': 'rgba(255, 89, 97, 0.56)',

  '--fab-complete-reward-reveal-delay-ms': '4200ms',
  '--fab-complete-card-bg':
    'radial-gradient(circle at 50% -6%, rgba(255, 231, 154, 0.98), rgba(255, 255, 255, 0.94) 42%), linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(255, 244, 228, 0.96))',
  '--fab-complete-card-text': '#3d2a17',
  '--fab-complete-reward-bg':
    'radial-gradient(circle at 50% 0%, rgba(255, 236, 178, 0.8), transparent 58%), linear-gradient(180deg, #fffdf4, #ffecd0)',
  '--fab-complete-reward-border': '#ffd274',
  '--fab-complete-reward-text': '#3d2d20',
  '--fab-complete-message-color': '#2f2116',

  '--fab-rate-card-border': 'rgba(255, 228, 166, 0.9)',
  '--fab-rate-card-bg':
    'radial-gradient(circle at 50% -18%, rgba(255, 238, 176, 0.98), rgba(255, 255, 255, 0.98) 52%), linear-gradient(180deg, #fffdf4 0%, #fff1d7 100%)',
  '--fab-rate-card-shadow':
    'inset 0 2px 0 rgba(255, 255, 255, 0.86), 0 8px 0 rgba(137, 86, 30, 0.18), 0 22px 44px rgba(31, 18, 6, 0.34)',
  '--fab-rate-title-color': '#3d2a17',
  '--fab-rate-subtitle-color': 'rgba(61, 42, 23, 0.72)',
  '--fab-rate-primary-border': 'rgba(255, 239, 210, 0.95)',
  '--fab-rate-primary-bg':
    'radial-gradient(circle at 30% 12%, rgba(255, 255, 255, 0.36), transparent 30%), linear-gradient(180deg, #ff9f55 0%, #ff7a38 100%)',
  '--fab-rate-primary-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.34), 0 5px 0 rgba(166, 78, 24, 0.3), 0 12px 22px rgba(166, 78, 24, 0.24)',
  '--fab-rate-primary-text': '#ffffff',
  '--fab-rate-secondary-border': 'rgba(218, 190, 143, 0.62)',
  '--fab-rate-secondary-bg': 'linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 250, 240, 0.7))',
  '--fab-rate-secondary-shadow': 'inset 0 3px 0 rgba(255, 255, 255, 0.78), 0 4px 0 rgba(145, 105, 58, 0.12)',
  '--fab-rate-secondary-text': 'rgba(61, 42, 23, 0.82)',

  '--fab-complete-overlay-bg':
    'radial-gradient(circle at 50% 45%, rgba(255, 218, 134, 0.26), transparent 34%), rgba(39, 24, 14, 0.52)',
  '--fab-complete-balance-text': '#4b382c',
  '--fab-complete-balance-bg': 'rgba(255, 255, 255, 0.9)',
  '--fab-complete-balance-border': 'rgba(255, 255, 255, 0.74)',
  '--fab-complete-balance-shadow': '0 10px 24px rgba(54, 31, 12, 0.24)',
  '--fab-complete-balance-icon-filter': 'drop-shadow(0 2px 2px rgba(90, 55, 20, 0.16))',
  '--fab-complete-title-filter': 'drop-shadow(0 10px 10px rgba(112, 55, 12, 0.28))',
  '--fab-complete-card-border': 'rgba(255, 255, 255, 0.9)',
  '--fab-complete-card-shadow':
    'inset 0 5px 0 rgba(255, 255, 255, 0.62), 0 9px 0 rgba(177, 100, 38, 0.22), 0 24px 70px rgba(66, 38, 13, 0.34)',
  '--fab-complete-mascot-filter': 'drop-shadow(0 18px 28px rgba(91, 52, 20, 0.22))',
  '--fab-complete-reward-burst-bg':
    'repeating-conic-gradient(from 10deg, rgba(255, 213, 99, 0.7) 0 8deg, transparent 8deg 18deg), radial-gradient(circle, rgba(255, 255, 255, 0.72), rgba(255, 209, 84, 0.3) 44%, rgba(255, 196, 82, 0.1) 64%, transparent 76%)',
  '--fab-complete-reward-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.7), 0 7px 0 rgba(190, 112, 41, 0.18), 0 14px 30px rgba(105, 58, 20, 0.18)',
  '--fab-complete-reward-label-text': '#7a4515',
  '--fab-complete-reward-label-bg': 'rgba(255, 216, 112, 0.34)',
  '--fab-complete-reward-label-border': 'rgba(255, 190, 72, 0.42)',
  '--fab-complete-reward-icon-filter': 'drop-shadow(0 4px 8px rgba(175, 111, 24, 0.22))',
  '--fab-complete-next-text': '#ffffff',
  '--fab-complete-next-border': 'rgba(255, 232, 199, 0.9)',
  '--fab-complete-next-bg':
    'radial-gradient(circle at 28% 10%, rgba(255, 255, 255, 0.34), transparent 30%), linear-gradient(180deg, #ff9d55 0%, #ff7635 48%, #e86024 100%)',
  '--fab-complete-next-shadow':
    'inset 0 4px 0 rgba(255, 255, 255, 0.34), inset 0 -4px 0 rgba(157, 65, 20, 0.18), 0 6px 0 rgba(161, 76, 25, 0.34), 0 15px 26px rgba(161, 76, 25, 0.24)',
  '--fab-complete-next-text-shadow': '0 2px 0 rgba(128, 58, 21, 0.22)',
  '--fab-complete-next-disabled-text': '#fff6e8',
  '--fab-complete-next-disabled-bg':
    'radial-gradient(circle at 28% 10%, rgba(255, 255, 255, 0.28), transparent 30%), linear-gradient(180deg, #f58b45 0%, #dc642c 48%, #c8521f 100%)',
  '--fab-complete-next-disabled-shadow':
    'inset 0 4px 0 rgba(255, 255, 255, 0.24), inset 0 -4px 0 rgba(103, 47, 18, 0.18), 0 6px 0 rgba(120, 61, 25, 0.3), 0 14px 24px rgba(120, 61, 25, 0.2)',
  '--fab-complete-claim-text': '#ffffff',
  '--fab-complete-claim-bg':
    'radial-gradient(circle at 30% 12%, rgba(255, 255, 255, 0.34), transparent 30%), linear-gradient(180deg, #52cf76 0%, #23a954 100%)',
  '--fab-complete-claim-border': 'rgba(232, 255, 221, 0.9)',
  '--fab-complete-claim-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.3), 0 5px 0 rgba(24, 116, 58, 0.34), 0 12px 24px rgba(24, 116, 58, 0.22)',
  '--fab-complete-claim-x2-text': '#5f2f0a',
  '--fab-complete-claim-x2-bg':
    'radial-gradient(circle at 28% 8%, rgba(255, 255, 255, 0.78), transparent 28%), linear-gradient(180deg, #fff1a6 0%, #ffbd3f 54%, #f28a2d 100%)',
  '--fab-complete-claim-x2-border': 'rgba(255, 246, 196, 0.95)',
  '--fab-complete-claim-x2-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.54), 0 5px 0 rgba(168, 83, 19, 0.34), 0 12px 24px rgba(110, 56, 18, 0.24)',
  '--fab-complete-claim-x2-inner-border': 'rgba(255, 255, 255, 0.46)',
  '--fab-complete-claim-x2-subtext': 'rgba(95, 47, 10, 0.76)',
  '--fab-complete-claim-x2-pulse-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.54), 0 5px 0 rgba(168, 83, 19, 0.34), 0 12px 24px rgba(110, 56, 18, 0.24)',
  '--fab-complete-claim-x2-pulse-shadow-peak':
    'inset 0 3px 0 rgba(255, 255, 255, 0.6), 0 7px 0 rgba(168, 83, 19, 0.28), 0 16px 30px rgba(110, 56, 18, 0.28), 0 0 0 7px rgba(255, 210, 76, 0.18)',
};
