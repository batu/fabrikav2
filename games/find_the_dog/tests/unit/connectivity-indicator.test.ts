import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initConnectivityIndicator, resetConnectivityIndicatorForTest } from '../../src/ui/HUD';

describe('native-safe connectivity indicator', () => {
  beforeEach(() => resetConnectivityIndicatorForTest());
  afterEach(() => resetConnectivityIndicatorForTest());

  it('stays neutral on native startup and retains real connectivity transitions across HUD rebuilds', () => {
    document.body.innerHTML = `
      <div id="hud-overlay"></div>
      <div id="offline-indicator" class="offline-indicator hidden"></div>
    `;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    initConnectivityIndicator(true);

    const indicator = document.getElementById('offline-indicator');
    expect(indicator?.classList.contains('hidden')).toBe(true);

    window.dispatchEvent(new Event('offline'));
    expect(indicator?.classList.contains('hidden')).toBe(false);

    document.body.innerHTML = `
      <div id="hud-overlay"></div>
      <div id="offline-indicator" class="offline-indicator hidden"></div>
    `;
    initConnectivityIndicator(true);
    const rebuiltIndicator = document.getElementById('offline-indicator');
    expect(rebuiltIndicator?.classList.contains('hidden')).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(rebuiltIndicator?.classList.contains('hidden')).toBe(true);
  });

  it('shows an offline web load immediately', () => {
    document.body.innerHTML = '<div id="offline-indicator" class="offline-indicator hidden"></div>';
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    initConnectivityIndicator(false);

    expect(document.getElementById('offline-indicator')?.classList.contains('hidden')).toBe(false);
  });
});
