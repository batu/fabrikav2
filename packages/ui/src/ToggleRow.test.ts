import { describe, expect, it, vi } from 'vitest';
import { buildSettingsModel, mountToggleRows } from './index.ts';

function host(): HTMLElement {
  document.body.innerHTML = '<div id="host"></div>';
  return document.getElementById('host')!;
}

describe('mountToggleRows', () => {
  it('renders one row per injected row with its injected label', () => {
    const handle = mountToggleRows({
      mountInto: host(),
      rows: [
        { key: 'music', label: 'Music', value: true },
        { key: 'sfx', label: 'Sound', value: false },
      ],
      onToggle: () => {},
    });
    const rows = handle.el.querySelectorAll('.fab-toggle-row');
    expect(rows).toHaveLength(2);
    expect(Array.from(handle.el.querySelectorAll('.fab-toggle-row-label')).map((el) => el.textContent)).toEqual([
      'Music',
      'Sound',
    ]);
    expect((rows[0] as HTMLElement).dataset.fabToggleKey).toBe('music');
  });

  it('reflects each row value in its checkbox', () => {
    const handle = mountToggleRows({
      mountInto: host(),
      rows: [
        { key: 'music', label: 'Music', value: true },
        { key: 'haptics', label: 'Haptics', value: false },
      ],
      onToggle: () => {},
    });
    const inputs = handle.el.querySelectorAll<HTMLInputElement>('.fab-toggle-input');
    expect(inputs[0].checked).toBe(true);
    expect(inputs[1].checked).toBe(false);
  });

  it('fires onToggle with the row key and next value on change', () => {
    const onToggle = vi.fn();
    const handle = mountToggleRows({
      mountInto: host(),
      rows: [{ key: 'music', label: 'Music', value: false }],
      onToggle,
    });
    const input = handle.el.querySelector<HTMLInputElement>('.fab-toggle-input')!;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(onToggle).toHaveBeenCalledWith('music', true);
  });

  it('renders an injected icon only when provided, and never a literal path', () => {
    const handle = mountToggleRows({
      mountInto: host(),
      rows: [
        { key: 'music', label: 'Music', value: true, icon: 'https://cdn.example/music-icon' },
        { key: 'sfx', label: 'Sound', value: true },
      ],
      onToggle: () => {},
    });
    const icons = handle.el.querySelectorAll<HTMLImageElement>('.fab-toggle-row-icon');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('src')).toBe('https://cdn.example/music-icon');
    expect(icons[0].getAttribute('aria-hidden')).toBe('true');
  });
});

describe('buildSettingsModel', () => {
  it('builds the music/sfx/haptics toggle shape from injected labels', () => {
    const model = buildSettingsModel({
      music: true,
      sfx: false,
      haptics: true,
      labels: { music: 'Music', sfx: 'Sound', haptics: 'Haptics' },
    });
    expect(model.toggles).toEqual([
      { key: 'music', label: 'Music', value: true },
      { key: 'sfx', label: 'Sound', value: false },
      { key: 'haptics', label: 'Haptics', value: true },
    ]);
  });

  it('feeds directly into mountToggleRows', () => {
    const model = buildSettingsModel({
      music: false,
      sfx: true,
      haptics: false,
      labels: { music: 'Music', sfx: 'Sound', haptics: 'Haptics' },
    });
    const handle = mountToggleRows({ mountInto: host(), rows: model.toggles, onToggle: () => {} });
    expect(handle.el.querySelectorAll('.fab-toggle-row')).toHaveLength(3);
  });
});
