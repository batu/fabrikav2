import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio/AudioManager', () => ({
  playUITap: vi.fn(),
  playHint: vi.fn(),
  setMusicEnabled: vi.fn(),
  setSoundEffectsEnabled: vi.fn(),
}));

vi.mock('../../src/audio/AmbientManager', () => ({
  syncAmbientMusicPreference: vi.fn(),
}));

vi.mock('../../src/config/RemoteConfigService', () => ({
  remoteConfigService: {
    value: vi.fn(),
    snapshot: vi.fn(() => ({ values: {} })),
  },
}));

vi.mock('../../src/shop/HintBoosterOffers', () => ({
  buildHintBoosterOffers: vi.fn(() => ({ options: [] })),
}));

vi.mock('../../src/shop/ProductCatalog', () => ({
  buildFullShopCatalog: vi.fn(() => ({ products: [] })),
  buildShopCatalog: vi.fn(() => ({ products: [] })),
}));

vi.mock('../../src/shop/IapService', () => ({
  iapService: {
    snapshot: vi.fn(() => ({
      state: 'unavailable',
      products: [],
      nativeOperationInProgress: false,
      restoreInProgress: false,
    })),
  },
}));

import { gameState } from '../../src/core/GameState';
import { initHUD, openPage } from '../../src/ui/HUD';

describe('Marble Run no-shop surfaces', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="hud-overlay"></div><div id="modal-root"></div>';
    gameState.setHintsForTest(0);
    gameState.setCoinsForTest(0);
  });

  it('does not open a booster or purchase modal when the empty legacy hint control is tapped', () => {
    initHUD();

    document.querySelector<HTMLButtonElement>('#hint-btn')?.click();

    expect(document.querySelector('#hint-booster-modal')).toBeNull();
    expect(document.querySelector('.home-page-shop')).toBeNull();
  });

  it('does not expose Restore Purchases from settings', () => {
    openPage('settings');

    expect(document.querySelector('#settings-restore-btn')).toBeNull();
    expect(document.body.textContent).not.toContain('Restore Purchases');
  });
});
