import { describe, expect, it, vi } from 'vitest';
import { mountSettingsPage, type SettingsModelInput } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

const SETTINGS: SettingsModelInput = {
  music: true,
  sfx: false,
  haptics: true,
  labels: { music: 'Music', sfx: 'Sound', haptics: 'Haptics' },
};

describe('mountSettingsPage', () => {
  it('renders toggle rows from buildSettingsModel with injected labels + state', () => {
    const handle = mountSettingsPage({
      mountInto: host(),
      settings: SETTINGS,
      onToggle: () => {},
      id: 'settings',
    });
    const rows = handle.el.querySelectorAll<HTMLElement>('.fab-toggle-row');
    expect(rows).toHaveLength(3);
    expect(Array.from(rows).map((r) => r.querySelector('.fab-toggle-row-label')?.textContent)).toEqual([
      'Music',
      'Sound',
      'Haptics',
    ]);
    const inputs = handle.el.querySelectorAll<HTMLInputElement>('.fab-toggle-input');
    expect([inputs[0].checked, inputs[1].checked, inputs[2].checked]).toEqual([true, false, true]);
  });

  it('fires onToggle with the setting key and next value', () => {
    const onToggle = vi.fn();
    const handle = mountSettingsPage({ mountInto: host(), settings: SETTINGS, onToggle, id: 'settings' });
    const sfxInput = handle.el.querySelectorAll<HTMLInputElement>('.fab-toggle-input')[1];
    sfxInput.click();
    expect(onToggle).toHaveBeenCalledWith('sfx', true);
  });

  it('renders legal links that fire onOpenLink(url) — never a baked href', () => {
    const onOpenLink = vi.fn();
    const handle = mountSettingsPage({
      mountInto: host(),
      settings: SETTINGS,
      onToggle: () => {},
      legalLinks: [
        { label: 'Privacy', url: 'https://example.com/privacy' },
        { label: 'Terms', url: 'https://example.com/terms' },
      ],
      onOpenLink,
      id: 'settings',
    });
    const links = handle.el.querySelectorAll<HTMLButtonElement>('.fab-settings-legal-link');
    expect(links).toHaveLength(2);
    // Buttons, not anchors — no navigable href in the DOM.
    expect(handle.el.querySelector('a[href]')).toBeNull();
    links[0].click();
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/privacy');
  });

  it('renders an optional privacy choice with in-place pending state', async () => {
    let resolveInvoke: (() => void) | undefined;
    const onInvoke = vi.fn(() => new Promise<void>((r) => (resolveInvoke = r)));
    const handle = mountSettingsPage({
      mountInto: host(),
      settings: SETTINGS,
      onToggle: () => {},
      privacyChoice: { label: 'Privacy options', onInvoke, pendingLabel: 'Opening…' },
      id: 'settings',
    });
    const btn = handle.el.querySelector<HTMLButtonElement>('.fab-settings-privacy-btn')!;
    expect(btn.textContent).toBe('Privacy options');
    btn.click();
    expect(onInvoke).toHaveBeenCalledOnce();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Opening…');
    resolveInvoke!();
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Privacy options');
  });

  it('omits the privacy row when no choice is supplied', () => {
    const handle = mountSettingsPage({ mountInto: host(), settings: SETTINGS, onToggle: () => {}, id: 'settings' });
    expect(handle.el.querySelector('.fab-settings-privacy')).toBeNull();
  });
});
