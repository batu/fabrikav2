import { beforeEach, describe, expect, it, vi } from 'vitest';

// SceneTransitionCover transitively imports Phaser, whose canvas-feature probe
// throws under happy-dom. The overlay only needs the cover as a side-effect on
// Next, so stub it to keep this suite free of the Phaser runtime.
vi.mock('../../src/ui/SceneTransitionCover', () => ({
  showSceneTransitionCover: () => {},
}));

// AudioManager instantiates an AudioContext, unavailable under happy-dom.
vi.mock('../../src/audio/AudioManager', () => ({
  playClaim: () => {},
  playLevelComplete: () => {},
  playLevelFail: () => {},
  playUITap: () => {},
}));

import { showLevelCompleteOverlay } from '../../src/ui/LevelCompleteOverlay';
import { showLevelFailedOverlay } from '../../src/ui/LevelFailedOverlay';
import { mountFinale } from '../../src/menu/finale';
import type { FailContinueOfferSet } from '../../src/shop/FailContinueOffers';

// Built inline (not via buildFailContinueOffers) so the suite doesn't import
// RemoteConfigService, whose module init reads window.localStorage.
const OFFERS: FailContinueOfferSet = {
  options: [
    { kind: 'coinContinue', status: 'available', coinPrice: 100, coinAmount: 0, productId: null, hintAmount: 0, reason: '' },
    { kind: 'retry', status: 'available', coinPrice: 0, coinAmount: 0, productId: null, hintAmount: 0, reason: '' },
  ],
};

function ribbonTitle(root: ParentNode): string | undefined {
  return root.querySelector('.fab-modal-ribbon-title')?.textContent ?? undefined;
}

describe('sugar result cards', () => {
  beforeEach(() => {
    // MRV2-11 U2: result cards now mount into the fixed #modal-root layer. Keep
    // #hud-overlay for the finale test (which mounts there explicitly).
    document.body.innerHTML =
      '<div id="hud-overlay" class="marble-ui"></div><div id="modal-root" class="marble-ui"></div>';
  });

  // MRV2-9 U8: v1 parity for the win coin reward — the schema default is 25 (was
  // 45). GameScene.winLevel reads this value into the overlay's baseCoins.
  it('defaults the level-complete coin reward to 25 (v1 parity)', async () => {
    const { REMOTE_CONFIG_DEFAULTS } = await import('../../src/config/remoteConfigSchema');
    expect(REMOTE_CONFIG_DEFAULTS.levelCompleteCoinReward).toBe(25);
  });

  it('renders +25 in the reward row when the win uses the default reward', async () => {
    const { REMOTE_CONFIG_DEFAULTS } = await import('../../src/config/remoteConfigSchema');
    void showLevelCompleteOverlay('lvl-default-reward', {
      timeSeconds: 8,
      newBest: false,
      baseCoins: REMOTE_CONFIG_DEFAULTS.levelCompleteCoinReward,
      coinBalance: REMOTE_CONFIG_DEFAULTS.levelCompleteCoinReward,
      claimX2Available: false,
    });
    const overlay = document.getElementById('level-complete-overlay');
    expect(overlay!.querySelector('.marble-reward-value')?.textContent).toBe('+25');
  });

  // MRV2-14 U4 (ref refs/win.png): the reward is a STACK — REWARD word-art on
  // top, then a coin+value row — not a single inline pill. Pin the DOM shape so a
  // regression back to the one-row pill is caught here.
  it('stacks the REWARD word-art above the coin+value row', () => {
    void showLevelCompleteOverlay('lvl-stack', {
      timeSeconds: 8,
      newBest: false,
      baseCoins: 25,
      coinBalance: 25,
      claimX2Available: false,
    });
    const row = document.querySelector('.marble-reward-row');
    expect(row).not.toBeNull();
    const children = Array.from(row!.children);
    expect(children[0]).toBe(row!.querySelector('.marble-reward-text'));
    const coinRow = row!.querySelector('.marble-reward-coinrow');
    expect(coinRow).not.toBeNull();
    expect(children[1]).toBe(coinRow);
    // The value lives inside the coin row, not directly on the reward wrapper.
    expect(coinRow!.querySelector('.marble-reward-value')?.textContent).toBe('+25');
  });

  // MRV2-10 U4: the Ribbon_Completed sprite already carries the baked-in
  // "COMPLETED" word, so the overlay must NOT also render a .fab-modal-ribbon-title
  // (the duplicate overlapping COMPLETED the device judge flagged). The Next
  // action is a green pill (no Txt_Next word-art sprite/label doubling), Claim 2x
  // is removed, and a blue wallet pill is rendered.
  it('win variant renders no duplicate title, a green Next pill, a coin pill, and no Claim 2x', () => {
    void showLevelCompleteOverlay('lvl-1', {
      timeSeconds: 12,
      newBest: false,
      baseCoins: 40,
      coinBalance: 140,
      claimX2Available: true,
      onClaimX2: async () => ({ granted: true, coinBalance: 180 }),
    });

    const overlay = document.getElementById('level-complete-overlay');
    expect(overlay).not.toBeNull();
    // Ribbon sprite present, but the overlaid title text is empty (single source).
    expect(overlay!.querySelector('.fab-modal-ribbon-image')).not.toBeNull();
    expect(ribbonTitle(overlay!)).toBe('');
    expect(overlay!.querySelector('.marble-reward-value')?.textContent).toBe('+40');
    const next = overlay!.querySelector<HTMLElement>('[data-fab-action="result-next"]');
    expect(next).not.toBeNull();
    // Green pill: no <img> sprite-label element inside the button.
    expect(next!.querySelector('img')).toBeNull();
    // Claim 2x is gone regardless of claimX2Available.
    expect(overlay!.querySelector('[data-fab-action="result-claim-x2"]')).toBeNull();
    // Blue wallet pill reflects the balance.
    expect(overlay!.querySelector('.marble-win-coin-pill .marble-win-coin-value')?.textContent).toBe('140');

    // MRV2-11 U5 (ref refs/win.png): three screen-level pieces. The coin pill and
    // the standalone Next live on the BACKDROP, NOT inside the compact card.
    const card = overlay!.querySelector('.fab-modal-card')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('.marble-win-coin-pill')).toBeNull();
    expect(card.querySelector('[data-fab-action="result-next"]')).toBeNull();
    // Exactly one Next, outside the card.
    expect(overlay!.querySelectorAll('[data-fab-action="result-next"]').length).toBe(1);
    // Single COMPLETED source: the ribbon sprite (its overlaid title text empty).
    expect(overlay!.querySelectorAll('.fab-modal-ribbon-image').length).toBe(1);
  });

  // MRV2-11 U5: the win scrim reverts from the wave-4 opaque purple gradient to a
  // TRANSLUCENT purple dim so the darkened board shows through (ref refs/win.png).
  it('win scrim CSS is translucent, not an opaque gradient', async () => {
    const { installShellArt } = await import('../../design/theme');
    document.getElementById('marble-shell-art')?.remove();
    installShellArt(document);
    const css = document.getElementById('marble-shell-art')?.textContent ?? '';
    const scrimBlock = css.slice(css.indexOf('.completion-mode .fab-modal-scrim'));
    expect(scrimBlock).toContain('rgba(');
    // The old opaque full-bleed gradient must be gone from the completion scrim.
    expect(scrimBlock.slice(0, scrimBlock.indexOf('}'))).not.toContain('linear-gradient');
  });

  it('lose variant mounts a Failed ribbon with Retry + coin-continue offers', () => {
    showLevelFailedOverlay('lvl-1', {
      getOffers: () => OFFERS,
      getCoinBalance: () => 999,
      getIapProducts: () => [],
      shouldRefreshOffers: () => false,
      onRetry: vi.fn(),
      onCoinContinue: async () => ({ resumed: false }),
      onEgoOffer: async () => ({ resumed: false }),
    });

    const overlay = document.getElementById('level-failed-overlay');
    expect(overlay).not.toBeNull();
    expect(ribbonTitle(overlay!)).toBe('Failed');
    expect(overlay!.querySelector('#retry-btn')).not.toBeNull();
    expect(overlay!.querySelector('#coin-continue-btn')).not.toBeNull();
    expect(overlay!.querySelector('.fab-result-message')?.textContent).toBe('No hearts left!');
  });

  it('finale mounts an orange Complete ribbon and an Awesome action', () => {
    const root = document.getElementById('hud-overlay')!;
    const onDone = vi.fn();
    mountFinale({ mountInto: root, onDone });

    expect(ribbonTitle(root)).toBe('Complete');
    expect(root.textContent).toContain('All marbles sorted!');
    const awesome = root.querySelector<HTMLButtonElement>('[data-fab-action="finale-done"]');
    expect(awesome).not.toBeNull();
    awesome!.click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
