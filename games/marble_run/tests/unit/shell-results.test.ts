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
    document.body.innerHTML = '<div id="hud-overlay" class="marble-ui"></div>';
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

  it('win variant mounts a Completed ribbon, reward row, and a Next action', () => {
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
    expect(ribbonTitle(overlay!)).toBe('Completed');
    expect(overlay!.querySelector('.marble-reward-value')?.textContent).toBe('+40');
    expect(overlay!.querySelector('[data-fab-action="result-next"]')).not.toBeNull();
    expect(overlay!.querySelector('[data-fab-action="result-claim-x2"]')).not.toBeNull();
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
